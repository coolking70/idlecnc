/**
 * save.js —— 存档系统（localStorage）
 *
 * 阶段1：保存并恢复资源、时间、建筑、日志、设置；
 * 阶段6：在此基础上补充离线结算的资源/建设/训练/维修推进。
 *
 * 容错原则：任何非法存档都不能让游戏崩溃，最坏情况回退到新游戏。
 */

import { SAVE_KEY, MANUAL_SAVE_KEY, SAVE_VERSION, TIME, BUILDINGS, BUILDING_STATUS, UNITS } from './config.js';
import { createInitialState, getState, setState } from './state.js';
import { recalcDerived } from './economy.js';
import { sanitizeConstruction } from './construction.js';
import { sanitizeProduction } from './production.js';
import { sanitizeFormations } from './formations.js';
import { sanitizeTheaters, sanitizeActiveBattle, sanitizeBattles } from './theater.js';
import { sanitizeRepairs } from './repairs.js';
import { sanitizeResearch } from './research.js';
import { sanitizeOperations } from './operations.js';
import { sanitizeUnits } from './units.js';
import { calculateOfflineSeconds, settleOfflineProgress } from './offline.js';
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { safeNumber, deepClone, formatDuration } from './utils.js';
import { damageStateOfUnit } from './unit-status.js';

export { SAVE_KEY, MANUAL_SAVE_KEY };

/** localStorage 是否可用（隐私模式可能抛异常） */
function storageAvailable() {
  try {
    const probe = '__ic_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch (err) {
    console.warn('[save] localStorage 不可用：', err);
    return false;
  }
}

/** 序列化当前状态为可存储对象 */
export function serialize(state) {
  const data = deepClone(state);
  if (!data) return null;
  data.version = SAVE_VERSION;
  data.savedAt = Date.now();
  return data;
}

/**
 * 保存到 localStorage
 * @returns {boolean} 是否成功
 */
export function saveGame(state, { silent = false } = {}) {
  if (!storageAvailable()) return false;
  const data = serialize(state);
  if (!data) return false;
  try {
    const raw = JSON.stringify(data);
    // 静默写入只更新自动续接槽位；显式“保存”同时更新手动槽位。
    // 这样战斗结算、生产完成和关闭页面的自动保存不会覆盖玩家的战前存档。
    window.localStorage.setItem(SAVE_KEY, raw);
    if (!silent) window.localStorage.setItem(MANUAL_SAVE_KEY, raw);
    state.savedAt = data.savedAt;
    if (!silent) logEvent(state, '基地数据已保存。', LOG_LEVEL.INFO);
    emit('save:written', { savedAt: data.savedAt, silent });
    return true;
  } catch (err) {
    console.error('[save] 保存失败：', err);
    if (!silent) logEvent(state, '保存失败：浏览器存储不可写。', LOG_LEVEL.DANGER);
    return false;
  }
}

/** 读取原始存档文本 */
export function readRaw(key = SAVE_KEY) {
  if (!storageAvailable()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    console.warn('[save] 读取存档失败：', err);
    return null;
  }
}

/** 是否存在存档 */
export function hasSave() {
  return Boolean(readRaw(SAVE_KEY) || readRaw(MANUAL_SAVE_KEY));
}

/**
 * 存档基础字段校验
 * @returns {{ok:boolean, reason?:string}}
 */
export function validateSave(data) {
  if (!data || typeof data !== 'object') return { ok: false, reason: '存档不是有效对象' };
  if (!Number.isFinite(Number(data.version))) return { ok: false, reason: '缺少版本号' };
  if (Number(data.version) > SAVE_VERSION) return { ok: false, reason: '存档版本高于当前游戏版本' };
  if (!data.resources || typeof data.resources !== 'object') return { ok: false, reason: '缺少资源数据' };
  const nums = ['supply', 'alloy', 'intel'];
  if (!nums.every((k) => Number.isFinite(Number(data.resources[k])))) {
    return { ok: false, reason: '资源数值非法' };
  }
  if (!data.time || !Number.isFinite(Number(data.time.game))) return { ok: false, reason: '时间数据非法' };
  if (!Array.isArray(data.buildings)) return { ok: false, reason: '建筑数据非法' };
  return { ok: true };
}

/**
 * 解析“暂停前的速度”。
 * 规则：优先取存档中的 lastSpeed；它非法时退而取存档中正在使用的 speed；
 *       两者都不是合法的正常速度（1 / 2 / 4）时才回退 TIME.defaultSpeed。
 * 注意：0（暂停）不是合法的 lastSpeed，否则按空格会“继续到暂停”。
 */
export function resolveLastSpeed(timeData) {
  const valid = TIME.speeds.filter((s) => s > 0);
  const last = Number(timeData && timeData.lastSpeed);
  if (valid.includes(last)) return last;
  const speed = Number(timeData && timeData.speed);
  if (valid.includes(speed)) return speed;
  return TIME.defaultSpeed;
}

/**
 * 把存档数据合并进一份全新的初始状态。
 * 好处：老存档缺少的新字段会自动补齐，不会出现 undefined 崩溃。
 * @param {object} data 原始存档数据
 * @param {object} [report] 出参：容错修复情况 { constructionRepaired:boolean, notes:string[] }
 */
export function migrate(data, report = {}) {
  const fresh = createInitialState();
  const merged = { ...fresh };

  merged.version = SAVE_VERSION;
  merged.createdAt = safeNumber(data.createdAt, fresh.createdAt);
  merged.savedAt = safeNumber(data.savedAt, 0);

  merged.time = {
    game: safeNumber(data.time && data.time.game, fresh.time.game),
    played: safeNumber(data.time && data.time.played, 0),
    speed: TIME.speeds.includes(Number(data.time && data.time.speed))
      ? Number(data.time.speed) : TIME.defaultSpeed,
    // 恢复“暂停前的速度”：只接受 1 / 2 / 4，缺失或非法时回退默认速度。
    // 这样读档后按空格继续，会回到玩家暂停前使用的档位，而不是永远变回 1×。
    lastSpeed: resolveLastSpeed(data.time)
  };
  merged.resources = {
    supply: safeNumber(data.resources.supply, fresh.resources.supply),
    alloy: safeNumber(data.resources.alloy, fresh.resources.alloy),
    intel: safeNumber(data.resources.intel, fresh.resources.intel)
  };

  if (Array.isArray(data.buildings) && data.buildings.length > 0) {
    const repairedBuildings = [];
    merged.buildings = data.buildings
      .filter((b) => {
        if (!b || typeof b.type !== 'string') return false;
        if (!BUILDINGS[b.type]) {           // 未知建筑类型：整条丢弃
          repairedBuildings.push('存档含未知建筑类型');
          return false;
        }
        return true;
      })
      .map((b) => {
        const def = BUILDINGS[b.type];
        let status = b.status;
        if (status !== BUILDING_STATUS.OPERATIONAL
          && status !== BUILDING_STATUS.UNDER_CONSTRUCTION
          && status !== BUILDING_STATUS.OFFLINE) {
          repairedBuildings.push('建筑状态字段非法');
          status = BUILDING_STATUS.OPERATIONAL;
        }
        let progress = safeNumber(b.progress, 1);
        if (!(progress >= 0) || progress > 1) progress = status === BUILDING_STATUS.OPERATIONAL ? 1 : 0;
        return {
          ...b,
          id: b.id || `bld_restored_${b.type}`,
          status,
          progress,
          level: safeNumber(b.level, 1),
          builtAt: safeNumber(b.builtAt, 0),
          fx: { spawn: 0 },
          slot: b.slot || (def && def.slot ? { ...def.slot } : null)
            || (fresh.buildings.find((f) => f.type === b.type) || {}).slot
            || { gx: 0, gy: 0, w: 2, h: 2, height: 24 }
        };
      });
    if (repairedBuildings.length) {
      report.notes = (report.notes || []).concat(repairedBuildings);
    }
  }

  merged.construction = data.construction && typeof data.construction === 'object'
    ? {
      current: data.construction.current || null,
      queue: Array.isArray(data.construction.queue) ? data.construction.queue : []
    }
    : { current: null, queue: [] };

  // 施工数据容错：损坏的任务不会白屏或抛异常，只会被清除 / 自动修复。
  // 已扣过的资源不会重复扣，也不会因为修复而重复返还。
  const conFix = sanitizeConstruction(merged);
  if (conFix.repaired) {
    report.notes = (report.notes || []).concat(conFix.notes);
  }
  report.constructionRepaired = conFix.repaired;

  merged.production = data.production && typeof data.production === 'object'
    ? { current: data.production.current || null, queue: Array.isArray(data.production.queue) ? data.production.queue : [] }
    : fresh.production;

  merged.units = Array.isArray(data.units) ? data.units : [];
  // 编队必须在生产容错之前挂载：sanitizeProduction 会规范化单位实例，
  // 随后 sanitizeFormations 才能基于“已清洗的单位表”校验编队归属。
  merged.formations = Array.isArray(data.formations) ? data.formations : [];

  // 先按存档中记录的解锁合并（过滤非法单位 ID），随后由 reconcileUnlocksFromBuildings
  // 依据已建成建筑补齐，二者取并集，避免覆盖建筑已结算出的解锁。
  merged.unlocks = {
    units: Array.isArray(data.unlocks && data.unlocks.units) ? data.unlocks.units.filter((u) => UNITS[u]) : [],
    techs: Array.isArray(data.unlocks && data.unlocks.techs) ? data.unlocks.techs : []
  };
  merged.research = data.research && typeof data.research === 'object'
    ? {
      current: data.research.current || null,
      queue: Array.isArray(data.research.queue) ? data.research.queue : [],
      completed: Array.isArray(data.research.completed) ? data.research.completed : (Array.isArray(merged.unlocks.techs) ? merged.unlocks.techs : []),
      revision: data.research.revision,
      history: Array.isArray(data.research.history) ? data.research.history : []
    }
    : { current: null, queue: [], completed: Array.isArray(merged.unlocks.techs) ? merged.unlocks.techs : [], revision: 0, history: [] };
  const researchFix = sanitizeResearch(merged);
  if (researchFix.repaired) report.notes = (report.notes || []).concat(researchFix.notes);
  report.researchRepaired = researchFix.repaired;

  // 根据已建成建筑重新校准解锁：读档后建筑已结算，这里把 operational 建筑
  // 声明的单位补齐进 unlocks（过滤非法单位 ID、去重）。
  reconcileUnlocksFromBuildings(merged);

  // 生产数据容错（解锁已校正，可安全校验当前/等待任务的单位类型）
  const prodFix = sanitizeProduction(merged);
  if (prodFix.repaired) {
    report.notes = (report.notes || []).concat(prodFix.notes);
  }
  report.productionRepaired = prodFix.repaired;
  (merged.units || []).forEach((unit) => { unit.damage = damageStateOfUnit(unit); });
  const unitFix = sanitizeUnits(merged);
  if (unitFix.repaired) report.notes = (report.notes || []).concat(unitFix.notes);

  merged.repairs = Array.isArray(data.repairs) ? data.repairs : [];
  merged.operations = data.operations && typeof data.operations === 'object' ? data.operations : fresh.operations;
  const operationFix = sanitizeOperations(merged);
  if (operationFix.repaired) report.notes = (report.notes || []).concat(operationFix.notes);
  merged.offlineLedger = data.offlineLedger && typeof data.offlineLedger === 'object'
    ? {
      lastToken: typeof data.offlineLedger.lastToken === 'string' ? data.offlineLedger.lastToken : null,
      lastSourceSavedAt: safeNumber(data.offlineLedger.lastSourceSavedAt, 0),
      lastSettledAt: safeNumber(data.offlineLedger.lastSettledAt, 0)
    }
    : { lastToken: null, lastSourceSavedAt: 0, lastSettledAt: 0 };
  merged.log = Array.isArray(data.log) ? data.log.slice(-30) : [];

  /* ---------- 阶段5：战区 / 战报 / 活动战斗 ---------- */

  merged.theaters = { ...fresh.theaters };
  if (data.theaters && typeof data.theaters === 'object') {
    Object.keys(merged.theaters).forEach((id) => {
      if (data.theaters[id] && typeof data.theaters[id] === 'object') {
        merged.theaters[id] = { ...merged.theaters[id], ...data.theaters[id] };
      }
    });
  }
  const theaterFix = sanitizeTheaters(merged);
  if (theaterFix.repaired) {
    report.notes = (report.notes || []).concat(theaterFix.notes);
  }
  report.theaterRepaired = theaterFix.repaired;

  merged.battles = Array.isArray(data.battles) ? data.battles : [];
  const battlesFix = sanitizeBattles(merged);
  if (battlesFix.repaired) {
    report.notes = (report.notes || []).concat(battlesFix.notes);
  }

  // 活动战斗必须在编队容错之前处理：它会告诉编队容错「哪支编队正在打仗」，
  // 否则那支编队会被当成非法状态复位为待命，读档后战斗就断了。
  merged.activeBattle = data.activeBattle && typeof data.activeBattle === 'object'
    ? data.activeBattle : null;
  const battleFix = sanitizeActiveBattle(merged);
  if (battleFix.repaired) {
    report.notes = (report.notes || []).concat(battleFix.notes);
  }
  report.battleRepaired = Boolean(battleFix.repaired || battlesFix.repaired);

  // 维修队列必须在编队容错之前处理：它会把「维修中的单位」从编队里摘出来并
  // 释放归属，随后 sanitizeFormations 才能算出正确的指挥容量占用。
  // （merged.repairs 已在生产容错后从存档挂载）
  const repairFix = sanitizeRepairs(merged);
  if (repairFix.repaired) {
    report.notes = (report.notes || []).concat(repairFix.notes);
  }
  report.repairRepaired = repairFix.repaired;

  // 编队数据容错（单位表已清洗，可安全校验成员存在性与双向归属）
  const formFix = sanitizeFormations(merged, { activeFormationId: battleFix.activeFormationId });
  if (formFix.repaired) {
    report.notes = (report.notes || []).concat(formFix.notes);
  }
  report.formationRepaired = formFix.repaired;
  report.repaired = Boolean(
    conFix.repaired || prodFix.repaired || formFix.repaired
    || theaterFix.repaired || battlesFix.repaired || battleFix.repaired
    || repairFix.repaired || researchFix.repaired || operationFix.repaired || unitFix.repaired
  );

  if (safeNumber(data.version, 0) < SAVE_VERSION) {
    report.notes = (report.notes || []).concat(
      [`存档已从 v${safeNumber(data.version, 0)} 升级到 v${SAVE_VERSION}。`]
    );
    report.upgraded = true;
  }

  merged.settings = { ...fresh.settings, ...(data.settings || {}) };
  merged.stats = { ...fresh.stats, ...(data.stats || {}) };
  merged.offline = null;

  return merged;
}

/**
 * 根据已建成建筑重新校准单位解锁。
 * 规则：读取所有 status 为 operational 的建筑 → 汇总它们在 BUILDINGS[type].unlocks
 * 中声明的单位 → 过滤不存在于 UNITS 的非法单位 → 保留已有合法解锁并补充缺失 → 去重。
 * 用于读档迁移后、施工完成后、导入存档后，确保解锁与已建成建筑一致。
 */
export function reconcileUnlocksFromBuildings(state) {
  if (!state || !state.buildings || !state.unlocks) return;
  if (!Array.isArray(state.unlocks.units)) state.unlocks.units = [];

  const shouldUnlock = new Set();
  state.buildings.forEach((b) => {
    if (b.status !== BUILDING_STATUS.OPERATIONAL) return;
    const def = BUILDINGS[b.type];
    if (!def || !Array.isArray(def.unlocks)) return;
    def.unlocks.forEach((u) => {
      if (UNITS[u]) shouldUnlock.add(u);   // 过滤非法单位 ID
    });
  });

  const kept = state.unlocks.units.filter((u) => UNITS[u]);
  const merged = new Set([...kept, ...shouldUnlock]);
  state.unlocks.units = Array.from(merged);
}

/**
 * 读档并应用到全局状态
 * @returns {{ok:boolean, state?:object, reason?:string, offlineSeconds?:number}}
 */
export function loadGame({ preferManual = false } = {}) {
  const keys = preferManual ? [MANUAL_SAVE_KEY, SAVE_KEY] : [SAVE_KEY, MANUAL_SAVE_KEY];
  let parsed = null;
  let sourceKey = null;
  let lastReason = '没有找到存档';
  for (const key of keys) {
    const raw = readRaw(key);
    if (!raw) continue;
    try {
      const candidate = JSON.parse(raw);
      const check = validateSave(candidate);
      if (!check.ok) { lastReason = check.reason; continue; }
      parsed = candidate;
      sourceKey = key;
      break;
    } catch (err) {
      console.error('[save] 存档解析失败：', err);
      lastReason = '存档内容损坏';
    }
  }
  if (!parsed) return { ok: false, reason: lastReason };

  const report = {};
  let migrated = null;
  try {
    migrated = migrate(parsed, report);
  } catch (err) {
    // 迁移阶段的任何意外都不允许白屏：直接回退到新游戏
    console.error('[save] 存档迁移失败，已回退新游戏：', err);
    return { ok: false, reason: '存档数据异常，无法恢复' };
  }

  // 阶段6：真实离线结算 —— 按事件步进推进资源 / 施工 / 生产 / 维修
  const sourceSavedAt = migrated.savedAt;
  const settledAt = Date.now();
  const offlineInfo = calculateOfflineSeconds(sourceSavedAt, settledAt, TIME.offlineMaxHours);
  const offlineSeconds = offlineInfo.seconds;

  setState(migrated);
  recalcDerived(migrated);

  let offlineReport = null;
  const offlineToken = `load:${sourceSavedAt}:${settledAt}`;
  const alreadySettled = migrated.offlineLedger && migrated.offlineLedger.lastToken === offlineToken;
  if (offlineSeconds > 0 && !alreadySettled) {
    try {
      offlineReport = settleOfflineProgress(migrated, offlineSeconds, {
        token: offlineToken, sourceSavedAt, settledAt,
        createReport: offlineSeconds >= TIME.offlineReportMinSeconds
      });
      offlineReport.capped = offlineInfo.capped;
      offlineReport.rawSeconds = offlineInfo.rawSeconds;
      offlineReport.maxSeconds = offlineInfo.maxSeconds;
    } catch (err) {
      // 离线结算失败不能让读档失败：退化为「只显示时长」
      console.error('[save] 离线结算失败：', err);
      offlineReport = {
        seconds: offlineSeconds,
        text: formatDuration(offlineSeconds),
        gains: {},
        buildingsCompleted: [],
        unitsProduced: [],
        repairsCompleted: [],
        steps: 0,
        lines: ['离线结算发生异常，本次未发放离线进度。'],
        settled: false,
        shown: false,
        capped: offlineInfo.capped,
        rawSeconds: offlineInfo.rawSeconds,
        maxSeconds: offlineInfo.maxSeconds
      };
      migrated.offline = offlineReport;
    }
    recalcDerived(migrated);
  } else if (alreadySettled) {
    migrated.offline = null;
  } else {
    migrated.offline = null;
  }

  // 结算完成后立刻刷新时间戳，避免同一段离线时间被重复结算
  migrated.savedAt = settledAt;
  // 载入阶段的离线结算必须立即落盘，不能依赖稍后才注册的事件监听器。
  setState(migrated);
  recalcDerived(migrated);
  saveGame(migrated, { silent: true });

  emit('save:loaded', { offlineSeconds, repaired: Boolean(report.repaired) });
  return {
    ok: true,
    state: migrated,
    source: sourceKey === MANUAL_SAVE_KEY ? 'manual' : 'auto',
    offlineSeconds,
    offlineReport,
    repaired: Boolean(report.repaired),
    constructionRepaired: Boolean(report.constructionRepaired),
    productionRepaired: Boolean(report.productionRepaired),
    formationRepaired: Boolean(report.formationRepaired),
    theaterRepaired: Boolean(report.theaterRepaired),
    battleRepaired: Boolean(report.battleRepaired),
    repairQueueRepaired: Boolean(report.repairRepaired),
    upgraded: Boolean(report.upgraded),
    repairNotes: report.notes || []
  };
}

/** 新游戏：清空存档并重置状态 */
export function newGame({ keepStorage = false } = {}) {
  if (!keepStorage && storageAvailable()) {
    try {
      window.localStorage.removeItem(SAVE_KEY);
      window.localStorage.removeItem(MANUAL_SAVE_KEY);
    } catch (err) {
      console.warn('[save] 清除存档失败：', err);
    }
  }
  const fresh = createInitialState();
  setState(fresh);
  recalcDerived(fresh);
  emit('save:new', null);
  return fresh;
}

/** 导出存档为 JSON 文本（阶段6在界面接入） */
export function exportSave(state = getState()) {
  const data = serialize(state);
  return data ? JSON.stringify(data, null, 2) : '';
}

/** 从 JSON 文本导入存档（阶段6在界面接入） */
export function importSave(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(text));
  } catch (err) {
    return { ok: false, reason: 'JSON 格式错误' };
  }
  const check = validateSave(parsed);
  if (!check.ok) return { ok: false, reason: check.reason };
  const report = {};
  let migrated = null;
  try {
    migrated = migrate(parsed, report);
  } catch (err) {
    console.error('[save] 导入失败：', err);
    return { ok: false, reason: '存档数据异常，无法导入' };
  }
  // 阶段6：导入的存档不得触发离线结算 —— 否则可以靠反复导入同一份旧存档刷资源
  migrated.savedAt = Date.now();
  migrated.offline = null;

  setState(migrated);
  recalcDerived(migrated);
  saveGame(migrated, { silent: true });
  // 导入是用户主动选择的恢复点，也要成为下一次“读取”的手动快照。
  try { window.localStorage.setItem(MANUAL_SAVE_KEY, JSON.stringify(serialize(migrated))); } catch (err) { /* 已由自动槽位承接 */ }
  emit('save:imported', null);
  return { ok: true, state: migrated, repaired: Boolean(report.repaired) };
}

/**
 * 自动保存计时器（使用真实时间，与游戏速度无关）
 * 由 main.js 每帧调用。
 */
export function createAutoSaver(intervalSeconds = TIME.autoSaveInterval) {
  let acc = 0;
  return function tickAutoSave(state, dtReal) {
    if (!state || !state.settings || !state.settings.autoSave) return false;
    acc += dtReal;
    if (acc < intervalSeconds) return false;
    acc = 0;
    return saveGame(state, { silent: true });
  };
}
