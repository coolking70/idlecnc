/**
 * construction.js —— 建设系统（阶段2主体）
 *
 * 职责边界：
 *  - 只处理业务逻辑：资格检查、扣费、创建施工任务、推进、完成结算、取消返还、进度查询、存档容错；
 *  - 不查询 DOM、不操作 Canvas、不弹窗，UI 相关一律由 ui.js / main.js 负责。
 */

import {
  BUILDINGS, BUILDING_STATUS, CONSTRUCTION, CONSTRUCTION_UI, RESOURCE_DEFS
} from './config.js';
import { createBuilding, hasBuilding, findBuilding } from './state.js';
import { canAfford, spend, grant, recalcDerived } from './economy.js';
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { safeNumber, formatCost, formatInt, formatDuration, clamp } from './utils.js';

const R = CONSTRUCTION_UI.reason;

/* ============================================================
 * 资格检查
 * ========================================================== */

/**
 * 判断某建筑当前能否开工。
 * @returns {{ok:boolean, code:string, reasons:string[], reason:string}}
 *   code 用于 UI 选择按钮文字：ready / unknown / not_buildable / exists /
 *        building_self / busy / prereq / resource / power
 */
export function canBuild(state, typeId) {
  const def = BUILDINGS[typeId];
  if (!def) return { ok: false, code: 'unknown', reasons: [R.unknown], reason: R.unknown };
  if (!state) return { ok: false, code: 'unknown', reasons: [R.unknown], reason: R.unknown };

  const reasons = [];
  let code = 'ready';

  const pushReason = (text, thisCode) => {
    reasons.push(text);
    if (code === 'ready') code = thisCode;
  };

  if (!def.buildable) pushReason(R.notBuildable, 'not_buildable');

  if (findBuilding(state, typeId)) {
    const inst = findBuilding(state, typeId);
    if (inst.status === BUILDING_STATUS.UNDER_CONSTRUCTION) pushReason(R.busySelf, 'building_self');
    else pushReason(R.exists, 'exists');
  }

  const job = state.construction && state.construction.current;
  if (job && job.type !== typeId) pushReason(R.busyOther, 'busy');

  (def.requires || []).forEach((req) => {
    if (!hasBuilding(state, req)) {
      const reqDef = BUILDINGS[req];
      pushReason(R.needPrereq(reqDef ? reqDef.name : req), 'prereq');
    }
  });

  // 资源缺口（“合金不足，缺少150”）
  Object.keys(def.cost || {}).forEach((key) => {
    const need = safeNumber(def.cost[key], 0);
    if (need <= 0) return;
    const have = safeNumber(state.resources && state.resources[key], 0);
    if (have < need) {
      const name = RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key;
      pushReason(R.lackResource(name, formatInt(Math.ceil(need - have))), 'resource');
    }
  });

  // 电力缺口（“电力不足：需要8，当前剩余4”）
  const needPower = safeNumber(def.power && def.power.consume, 0);
  const free = safeNumber(state.power && state.power.produced, 0)
    - safeNumber(state.power && state.power.used, 0);
  if (needPower > free) pushReason(R.lackPower(formatInt(needPower), formatInt(Math.max(0, free))), 'power');

  const ok = reasons.length === 0;
  return { ok, code: ok ? 'ready' : code, reasons, reason: ok ? '' : reasons[0] };
}

/* ============================================================
 * 开工
 * ========================================================== */

/**
 * 提交建设申请（玩家点击“批准建设”）。
 * 内部会再做一次 canBuild()，因此对连点、并发调用是安全的。
 * @returns {{ok:boolean, reason?:string, code?:string, typeId?:string, buildingId?:string}}
 */
export function requestBuild(state, typeId) {
  const check = canBuild(state, typeId);
  if (!check.ok) return { ok: false, reason: check.reason, code: check.code };

  const def = BUILDINGS[typeId];

  // 双保险：任何情况下都不允许出现第二条施工任务
  if (state.construction && state.construction.current) {
    return { ok: false, reason: R.busyOther, code: 'busy' };
  }

  if (!spend(state, def.cost)) return { ok: false, reason: '资源扣除失败', code: 'resource' };

  // 建筑实例立刻进入基地画面，处于“施工中”状态
  const building = createBuilding(typeId, BUILDING_STATUS.UNDER_CONSTRUCTION);
  building.progress = 0;
  state.buildings.push(building);

  state.construction.current = {
    id: building.id,
    type: typeId,
    elapsed: 0,
    duration: Math.max(0.05, safeNumber(def.buildTime, 1)),
    startedAt: Date.now()
  };

  logEvent(
    state,
    `${def.name}开始施工（${formatCost(def.cost, RESOURCE_DEFS)}，预计${def.buildTime}秒）。`,
    LOG_LEVEL.INFO
  );
  emit('construction:started', { typeId, buildingId: building.id });
  recalcDerived(state);
  return { ok: true, typeId, buildingId: building.id };
}

/* ============================================================
 * 推进与完成
 * ========================================================== */

/**
 * 施工推进（固定步长调用）。
 * @param {number} dt 游戏秒；暂停时 main.js 不会调用，速度只影响步数
 */
export function tickConstruction(state, dt) {
  const job = state && state.construction && state.construction.current;
  if (!job || !(dt > 0)) return;
  if (job.done) return;                       // 已结算过的任务不再推进

  job.elapsed = safeNumber(job.elapsed, 0) + dt;
  const duration = safeNumber(job.duration, 0);
  // 浮点累计可能让 elapsed 永远差一丝达不到 duration（如固定 0.05 步长累加），
  // 在接近完成时直接吸附到 duration，避免建筑卡在 99.99% 永远不落成。
  if (duration > 0 && job.elapsed >= duration - 1e-6) job.elapsed = duration;
  const progress = duration > 0 ? Math.min(1, job.elapsed / duration) : 1;

  const building = state.buildings.find((b) => b.id === job.id);
  if (!building) {
    // 建筑实例丢失（异常存档）：直接清任务，避免死循环推进
    state.construction.current = null;
    return;
  }
  building.progress = progress;

  if (progress >= 1) completeConstruction(state, job);
}

/**
 * 施工完成结算。
 * 通过 job.done 标记 + 立即清空 current，保证同一任务只结算一次：
 * 不会重复增加 buildingsBuilt、不会重复解锁、不会重复写日志或重复派发事件。
 */
export function completeConstruction(state, job) {
  if (!state || !job || job.done) return false;
  // 只允许结算当前任务，防止旧引用被二次调用
  if (state.construction && state.construction.current && state.construction.current !== job) return false;

  job.done = true;
  job.elapsed = safeNumber(job.duration, 0);
  state.construction.current = null;

  const def = BUILDINGS[job.type];
  const building = state.buildings.find((b) => b.id === job.id);
  if (building) {
    building.status = BUILDING_STATUS.OPERATIONAL;
    building.progress = 1;
    building.builtAt = Date.now();
    building.fx = building.fx || {};
    building.fx.spawn = 1.2;   // 渲染器播放落成动画
  }
  state.stats.buildingsBuilt = safeNumber(state.stats.buildingsBuilt, 0) + 1;

  // 解锁该建筑带来的单位（去重）
  (def && def.unlocks ? def.unlocks : []).forEach((unitId) => {
    if (!state.unlocks.units.includes(unitId)) state.unlocks.units.push(unitId);
  });

  recalcDerived(state);
  logEvent(state, `${def ? def.name : '建筑'}施工完成，已投入运行。`, LOG_LEVEL.GOOD);
  const unlockNames = (def && def.unlocks ? def.unlocks : []).length;
  if (unlockNames > 0) {
    logEvent(state, `${def.name}已解锁新的单位类型（生产功能将在阶段3开放）。`, LOG_LEVEL.INFO);
  }
  emit('construction:completed', { typeId: job.type, buildingId: job.id });

  // 若有排队项目，自动开工（阶段2不产生排队数据，此处为阶段3+预留）
  if (CONSTRUCTION.maxConcurrent === 1 && state.construction.queue.length > 0) {
    const next = state.construction.queue.shift();
    if (next) requestBuild(state, next);
  }
  return true;
}

/* ============================================================
 * 进度查询
 * ========================================================== */

/** 当前施工进度（0~1），无项目返回 null */
export function currentProgress(state) {
  const job = state && state.construction && state.construction.current;
  if (!job) return null;
  const duration = safeNumber(job.duration, 0);
  return duration > 0 ? Math.min(1, safeNumber(job.elapsed, 0) / duration) : 1;
}

/**
 * 完整的施工进度信息，供 UI / 调试接口使用。
 * @returns {null|{typeId:string,name:string,buildingId:string,elapsed:number,
 *   duration:number,remaining:number,progress:number,percent:number,
 *   elapsedText:string,remainingText:string}}
 */
export function getConstructionProgress(state) {
  const job = state && state.construction && state.construction.current;
  if (!job) return null;
  const def = BUILDINGS[job.type];
  const duration = Math.max(0, safeNumber(job.duration, 0));
  const elapsed = Math.min(duration, Math.max(0, safeNumber(job.elapsed, 0)));
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
  const remaining = Math.max(0, duration - elapsed);
  return {
    typeId: job.type,
    name: def ? def.name : '未知项目',
    buildingId: job.id,
    elapsed,
    duration,
    remaining,
    progress,
    percent: Math.floor(progress * 100),
    elapsedText: formatDuration(elapsed),
    remainingText: formatDuration(Math.ceil(remaining))
  };
}

/* ============================================================
 * 取消
 * ========================================================== */

/**
 * 取消当前施工并按 CONSTRUCTION.refundRatio 返还（返还经 grant 钳制，不会超过上限）。
 * @returns {{ok:boolean, reason?:string, name?:string, refund?:object}}
 */
export function cancelConstruction(state) {
  const job = state && state.construction && state.construction.current;
  if (!job) return { ok: false, reason: '当前没有进行中的工程' };

  const def = BUILDINGS[job.type];
  state.buildings = state.buildings.filter((b) => b.id !== job.id);
  state.construction.current = null;
  job.done = true;

  const refund = {};
  Object.keys((def && def.cost) || {}).forEach((key) => {
    const back = Math.floor(safeNumber(def.cost[key], 0) * CONSTRUCTION.refundRatio);
    if (back > 0) refund[key] = back;
  });
  recalcDerived(state);      // 先刷新上限，再按上限钳制返还
  grant(state, refund);

  const refundText = Object.keys(refund).length ? formatCost(refund, RESOURCE_DEFS) : '无资源返还';
  logEvent(state, `${def ? def.name : '项目'}施工已取消，返还${refundText}。`, LOG_LEVEL.WARN);
  emit('construction:cancelled', { typeId: job.type, buildingId: job.id, refund });
  return { ok: true, name: def ? def.name : '项目', refund };
}

/* ============================================================
 * 存档容错
 * ========================================================== */

/**
 * 校验并修复施工相关数据（读档时调用，纯数据操作，不写日志）。
 * 处理的异常：
 *  - construction 不是对象 / current 不是对象；
 *  - 建筑类型不在 BUILDINGS 中；
 *  - elapsed / duration 非有限数或为负；
 *  - 找不到对应的建筑实例；
 *  - 建筑实例状态不是 under_construction；
 *  - 任务 id 与建筑 id 不匹配；
 *  - 存在多个 under_construction 建筑（多余的按已完成处理，不重复扣费）。
 * @returns {{repaired:boolean, notes:string[]}}
 */
export function sanitizeConstruction(saveState) {
  const notes = [];
  if (!saveState || typeof saveState !== 'object') return { repaired: false, notes };

  if (!saveState.construction || typeof saveState.construction !== 'object') {
    saveState.construction = { current: null, queue: [] };
    notes.push('施工数据结构缺失');
  }
  const con = saveState.construction;
  if (!Array.isArray(con.queue)) con.queue = [];
  if (!Array.isArray(saveState.buildings)) saveState.buildings = [];

  let job = con.current;

  // —— 任务本身是否合法 ——
  if (job !== null && job !== undefined) {
    const bad = [];
    if (typeof job !== 'object' || Array.isArray(job)) bad.push('施工任务格式非法');
    else {
      if (!job.type || !BUILDINGS[job.type]) bad.push('施工建筑类型无效');
      if (!Number.isFinite(Number(job.elapsed)) || Number(job.elapsed) < 0) bad.push('已施工时间非法');
      if (!Number.isFinite(Number(job.duration)) || Number(job.duration) <= 0) bad.push('施工总时长非法');
      if (!job.id) bad.push('施工任务缺少建筑ID');
    }
    if (bad.length) {
      notes.push(...bad);
      con.current = null;
      job = null;
    }
  } else {
    con.current = null;
    job = null;
  }

  // —— 任务与建筑实例是否对得上 ——
  if (job) {
    const building = saveState.buildings.find((b) => b && b.id === job.id);
    if (!building) {
      notes.push('施工任务找不到对应的建筑实例');
      con.current = null;
      job = null;
    } else if (building.type !== job.type) {
      notes.push('施工任务与建筑类型不匹配，已清除无效任务');
      con.current = null;
      job = null;
      // 不把建筑直接改成已建成：交由后面的“无主施工建筑”逻辑尝试重建任务
    } else if (building.status !== BUILDING_STATUS.UNDER_CONSTRUCTION) {
      notes.push('施工建筑状态异常');
      con.current = null;
      job = null;
    } else {
      // 合法：钳制进度，剔除残留的完成标记
      job.elapsed = Math.min(Number(job.elapsed), Number(job.duration));
      job.done = false;
      building.progress = job.duration > 0 ? Math.min(1, job.elapsed / job.duration) : 1;
    }
  }

  // —— 没有任务但仍有“施工中”的建筑：尝试重建施工任务，绝不免费落成 ——
  if (!job) {
    const orphans = saveState.buildings.filter(
      (b) => b && b.status === BUILDING_STATUS.UNDER_CONSTRUCTION
    );
    if (orphans.length > 0) {
      const legal = orphans.filter(
        (b) => BUILDINGS[b.type] && Number.isFinite(Number(BUILDINGS[b.type].buildTime))
      );
      notes.push(`发现 ${orphans.length} 座无主施工建筑`);

      if (legal.length >= 1) {
        // 只恢复第一座合法建筑；其余无主施工建筑移除（无法确认、不返还）
        const recovered = legal[0];
        const def = BUILDINGS[recovered.type];
        const prog = clamp(safeNumber(recovered.progress, 0), 0, 1);
        const duration = Math.max(0.05, safeNumber(def.buildTime, 1));
        con.current = {
          id: recovered.id,
          type: recovered.type,
          elapsed: prog * duration,
          duration,
          startedAt: Date.now()
        };
        recovered.progress = prog;
        job = con.current;
        notes.push(`已恢复中断的施工任务（${def.name}）`);

        if (legal.length > 1) {
          const extraIds = new Set(legal.slice(1).map((b) => b.id));
          saveState.buildings = saveState.buildings.filter((b) => !extraIds.has(b.id));
          notes.push(`移除了 ${legal.length - 1} 座无法确认的多余施工建筑`);
        }
      } else {
        // 没有任何合法建筑可恢复（类型未知等）：移除无主施工数据，绝不落成
        const orphanIds = new Set(orphans.map((b) => b.id));
        saveState.buildings = saveState.buildings.filter((b) => !orphanIds.has(b.id));
        notes.push('无合法施工建筑可恢复，已移除无主施工数据');
      }
    }
  }

  // —— 同类建筑重复：只保留第一座 ——
  const seen = new Set();
  const kept = [];
  saveState.buildings.forEach((b) => {
    if (!b || !b.type) return;
    if (seen.has(b.type)) {
      notes.push(`发现重复建筑「${BUILDINGS[b.type] ? BUILDINGS[b.type].name : b.type}」`);
      if (con.current && con.current.id === b.id) con.current = null;
      return;
    }
    seen.add(b.type);
    kept.push(b);
  });
  if (kept.length !== saveState.buildings.length) saveState.buildings = kept;

  return { repaired: notes.length > 0, notes };
}

/* ============================================================
 * 离线推进（阶段6接入，阶段2不调用）
 * ========================================================== */

/** 离线期间的施工推进（阶段6启用；阶段2不发放离线收益，因此主循环不会调用） */
export function advanceOffline(state, seconds) {
  const done = [];
  let remaining = seconds;
  let guard = 0;
  while (remaining > 0 && state.construction.current && guard < 64) {
    guard += 1;
    const job = state.construction.current;
    const need = safeNumber(job.duration, 0) - safeNumber(job.elapsed, 0);
    if (need > remaining) {
      job.elapsed += remaining;
      remaining = 0;
    } else {
      remaining -= Math.max(0, need);
      const def = BUILDINGS[job.type];
      completeConstruction(state, job);
      if (def) done.push(def.name);
    }
  }
  return done;
}

/** 所有玩家可建造的项目定义（供 UI 渲染列表，顺序稳定） */
export function buildableList() {
  return Object.values(BUILDINGS).filter((def) => def && def.buildable);
}
