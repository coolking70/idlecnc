/**
 * main.js —— 启动入口与主循环
 *
 * 只做三件事：
 *  1. 组装模块（状态 / 逻辑 / 渲染 / 界面）；
 *  2. 驱动固定步长的逻辑循环，保证结果与帧率无关；
 *  3. 转发玩家操作到对应模块。
 * 业务逻辑一律不写在这里。
 */

import {
  TIME, CURRENT_STAGE, CURRENT_STAGE_LABEL, BUILDINGS, UNITS, CONSTRUCTION_UI, BUILDING_STATUS, PRODUCTION_UI,
  FORMATION, FORMATION_PRESETS, THEATERS, OPERATIONS, BATTLE, REPAIR
} from './config.js';
import { getState } from './state.js';
import { recalcDerived, tickEconomy } from './economy.js';
import {
  tickConstruction, requestBuild, cancelConstruction, canBuild, getConstructionProgress
} from './construction.js';
import {
  tickProduction, queueUnit, cancelCurrentProduction, cancelQueuedProduction,
  canQueueUnit, queueEquipment, canQueueEquipment, getProductionProgress, inventoryCount
} from './production.js';
import {
  tickRepairs, canQueueRepair, queueRepair, cancelRepair as cancelRepairJob,
  getActiveRepairs, getQueuedRepairs, getRepairProgress, getRepairRemaining,
  advanceOffline as advanceRepairsOffline, hasRepairShop, damageStateOfUnit, getDamageState
} from './repairs.js';
import {
  calculateOfflineSeconds, settleOfflineProgress, dismissOfflineReport,
  hasPendingOfflineReport, buildOfflineReport
} from './offline.js';
import {
  createFormation, renameFormation, disbandFormation, addUnit, removeUnit, applyPreset,
  canCreateFormation, canAddUnit, canApplyPreset, getAvailableUnits,
  getFormationStats, getFormationWarnings, getFormationCommandCost, getPresetCommandCost,
  resolveFormation
} from './formations.js';
import {
  listTheaters, listStrategies, getTheaterState, getTheaterIntel, getMissionCost,
  canDispatch, dispatchFormation, tickActiveBattle, tickBattleReturn, settleActiveBattle,
  finishBattleReturn, skipBattleReturn, closeBattleResult, abortInvalidBattle,
  getActiveBattle, isBattleFinished, getReports, getReport, hasRadar,
  validateBattleReportForSettlement, buildSettlementPlan, dispatchOperation,
  listOperations, getOperation, canDispatchOperationMission, replayBattleSession
} from './theater.js';
import { getOperationCost } from './operations.js';
import { simulateBattle, resultLabel, rebuildBattleFromDispatchSnapshot } from './battle.js';
import { logEvent, on, LOG_LEVEL } from './events.js';
import { saveGame, loadGame, newGame, hasSave, createAutoSaver, reconcileUnlocksFromBuildings } from './save.js';
import { BaseRenderer } from './renderer.js';
import { BattleRenderer } from './battle-renderer.js';
import { createBattlePresentationRouter } from './battle-presentation/presentation-router.js';
import { UI } from './ui.js';
import { qs } from './utils.js';
import {
  listTechnologies, canQueueResearch, queueResearch, tickResearch,
  getResearchProgress, cancelCurrentResearch, cancelQueuedResearch,
  getResearchModifiers, hasResearchCenter, sanitizeResearch
} from './research.js';
import { getUnitRank, renameUnit, getUnitEffectiveStats, filterUnits, sortUnits } from './units.js';
import { equipEquipment, unequipEquipment } from './equipment.js';
import { deriveSalvageOffer, claimBattleSalvage } from './battle-salvage.js';
import { validateResearchHistory, validateBattleOutcomeConsistency, compareBattleReports } from './integrity.js';
import { buildEvidenceStatePayload, buildEvidenceStateSignature, buildStageC1EvidenceStatePayload, buildStageC1EvidenceStateSignature, stageC1SemanticPredicates } from './battle-presentation/universal/evidence-integrity.js';
import { evaluateProductionSemanticPredicate } from './battle-presentation/universal/production-semantic-predicates.js';

/* ------------------------------------------------------------
 * 模块实例
 * ---------------------------------------------------------- */

let ui = null;
let renderer = null;
let battleRenderer = null;
let battlePresentationRouter = null;
let tickAutoSave = null;

/** 画布当前由哪个渲染器接管：base | battle（阶段5） */
let viewMode = 'base';

/** 当前在编队页选中的编队（用于 Canvas 集结区高亮），由 UI 单向同步过来 */
let selectedFormationId = null;

/**
 * 把界面的编队选中态转交给渲染器。
 * 渲染器只拿到一个 ID，不认识 UI，也不修改任何游戏状态。
 */
function syncSelectedFormation(formationId) {
  const id = formationId || null;
  if (id === selectedFormationId) return;
  selectedFormationId = id;
  if (renderer && typeof renderer.setSelectedFormation === 'function') {
    renderer.setSelectedFormation(id);
  }
}

/** 环境自检：确保必需的 DOM 元素存在 */
function checkDom() {
  const canvas = qs('#base-canvas');
  if (!canvas) {
    console.error('[main] 找不到 #base-canvas，页面结构可能损坏。');
    return null;
  }
  return canvas;
}

/* ------------------------------------------------------------
 * 玩家操作
 * ---------------------------------------------------------- */

/** 切换游戏速度（0 暂停 / 1 / 2 / 4） */
function setSpeed(speed) {
  const state = getState();
  const value = Number(speed);
  if (!TIME.speeds.includes(value)) return;
  if (state.time.speed === value) return;
  if (value !== 0) state.time.lastSpeed = value;
  state.time.speed = value;
  if (ui) {
    ui.setSpeed(value);
    ui.toast(value === 0 ? '推演已暂停' : `推演速度 ${value}×`, value === 0 ? 'warn' : 'info');
  }
}

/** 空格：暂停 / 继续 */
function togglePause() {
  const state = getState();
  if (state.time.speed === 0) setSpeed(state.time.lastSpeed || 1);
  else setSpeed(0);
}

/* ---- 建设操作（阶段2） ---- */

/** 正在处理建造请求的标记，杜绝同一帧内的重复提交 */
let buildBusy = false;
/** 派遣确认提交锁：阻止同一同步调用链上的重复核心请求。 */
let dispatchBusy = false;

/**
 * 批准建设。
 * 真正的资格判断在 construction.requestBuild() 内部完成，这里只负责转发与反馈。
 */
function handleBuild(typeId) {
  if (buildBusy) return { ok: false, reason: '正在处理上一次请求' };
  buildBusy = true;
  let res = { ok: false, reason: '未知错误' };
  try {
    const state = getState();
    res = requestBuild(state, typeId);
    const def = BUILDINGS[typeId];
    if (res.ok) {
      if (ui) ui.toast(`${def ? def.name : '项目'}已批准建设`, 'info');
      saveGame(state, { silent: true });      // 开工后立即保存，刷新不丢进度
    } else if (ui) {
      ui.toast(res.reason || '当前无法开始该项目', 'warn');
    }
    if (ui) ui.refreshConstruction(state);
  } catch (err) {
    console.error('[main] 建设请求处理失败：', err);
    if (ui) ui.toast('建设请求处理失败，请查看控制台', 'danger');
    res = { ok: false, reason: '内部错误' };
  } finally {
    buildBusy = false;
  }
  return res;
}

/** 取消当前工程（带二次确认） */
function handleCancelConstruction({ confirm = true } = {}) {
  const state = getState();
  const job = getConstructionProgress(state);
  if (!job) {
    if (ui) ui.toast('当前没有进行中的工程', 'warn');
    return { ok: false, reason: '当前没有进行中的工程' };
  }
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(CONSTRUCTION_UI.cancelConfirm(job.name))) {
      return { ok: false, reason: '玩家取消了操作' };
    }
  }
  const res = cancelConstruction(state);
  if (ui) {
    ui.toast(res.ok ? `${res.name}施工已取消` : (res.reason || '取消失败'), res.ok ? 'warn' : 'danger');
    ui.refreshConstruction(state);
  }
  if (res.ok) saveGame(state, { silent: true });   // 取消后立即保存
  return res;
}

/* ---- 生产操作（阶段3） ---- */

/** 正在处理生产请求的标记，杜绝同一帧内的重复提交 */
let produceBusy = false;

/**
 * 提交生产申请（批准训练 / 制造）。
 * 真正的资格判断在 production.queueUnit() 内部完成，这里只负责转发与反馈。
 */
function handleProduce(unitType) {
  if (produceBusy) return { ok: false, reason: '正在处理上一次请求' };
  produceBusy = true;
  let res = { ok: false, reason: '未知错误' };
  try {
    const state = getState();
    res = queueUnit(state, unitType);
    const def = UNITS[unitType];
    if (res.ok) {
      if (ui) ui.toast(`${def ? def.name : '单位'}已加入生产队列`, 'info');
      saveGame(state, { silent: true });      // 入队后立即保存
    } else if (ui) {
      ui.toast(res.reason || '当前无法生产该单位', 'warn');
    }
    if (ui) ui.refreshProduction(state);
  } catch (err) {
    console.error('[main] 生产请求处理失败：', err);
    if (ui) ui.toast('生产请求处理失败，请查看控制台', 'danger');
    res = { ok: false, reason: '内部错误' };
  } finally {
    produceBusy = false;
  }
  return res;
}

/** 提交装备制造：真实 UI 只转发到 production.js 的权威资格判断。 */
function handleProduceEquipment(equipmentId) {
  const state = getState();
  const res = queueEquipment(state, equipmentId);
  if (res.ok) {
    if (ui) ui.toast(`${res.definition.name}已加入制造队列`, 'info');
    saveGame(state, { silent: true });
  } else if (ui) ui.toast(res.reason || '当前无法制造该装备', 'warn');
  if (ui) ui.refreshProduction(state);
  return res;
}

/** 取消当前生产（带二次确认） */
function handleCancelCurrentProduction({ confirm = true } = {}) {
  const state = getState();
  const job = getProductionProgress(state);
  if (!job) {
    if (ui) ui.toast('当前没有进行中的生产', 'warn');
    return { ok: false, reason: '当前没有进行中的生产' };
  }
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(PRODUCTION_UI.cancelCurrentConfirm(job.name))) {
      return { ok: false, reason: '玩家取消了操作' };
    }
  }
  const res = cancelCurrentProduction(state);
  if (ui) {
    ui.toast(res.ok ? `${res.name}生产已取消` : (res.reason || '取消失败'), res.ok ? 'warn' : 'danger');
    ui.refreshProduction(state);
  }
  if (res.ok) saveGame(state, { silent: true });
  return res;
}

/** 取消等待队列中的任务（带二次确认） */
function handleCancelQueuedProduction(jobId, { confirm = true } = {}) {
  const state = getState();
  const job = (state.production && state.production.queue || []).find((j) => j && j.id === jobId);
  if (!job) {
    if (ui) ui.toast('未找到该等待任务', 'warn');
    return { ok: false, reason: '未找到该等待任务' };
  }
  const def = UNITS[job.type];
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(PRODUCTION_UI.cancelQueuedConfirm(def ? def.name : '该单位'))) {
      return { ok: false, reason: '玩家取消了操作' };
    }
  }
  const res = cancelQueuedProduction(state, jobId);
  if (ui) {
    ui.toast(res.ok ? `${res.name}已从队列移除` : (res.reason || '移除失败'), res.ok ? 'warn' : 'danger');
    ui.refreshProduction(state);
  }
  if (res.ok) saveGame(state, { silent: true });
  return res;
}

/* ---- 编队操作（阶段4） ---- */

/** 正在处理编队请求的标记，杜绝同一帧内的重复提交 */
let formationBusy = false;

/**
 * 编队操作统一外壳。
 * 资格判断全部在 formations.js 内部完成，这里只负责：加锁、提示、刷新、落盘。
 * @param {Function} action 返回结果对象 { ok, code, reason, formation } 的业务调用
 * @param {Function} [onSuccess] 成功文案生成器，返回 null 表示不提示
 */
function runFormationAction(action, onSuccess) {
  if (formationBusy) return { ok: false, code: 'busy', reason: '正在处理上一次请求', formation: null };
  formationBusy = true;
  let res = { ok: false, code: 'error', reason: '未知错误', formation: null };
  try {
    const state = getState();
    res = action(state) || res;
    if (res.ok) {
      const text = typeof onSuccess === 'function' ? onSuccess(res, state) : null;
      if (ui && text) ui.toast(text, 'info');
      saveGame(state, { silent: true });        // 编队变化后立即保存
    } else if (ui) {
      ui.toast(res.reason || '当前无法执行该编队操作', 'warn');
    }
    if (ui) ui.refreshFormations(state);
  } catch (err) {
    console.error('[main] 编队请求处理失败：', err);
    if (ui) ui.toast('编队请求处理失败，请查看控制台', 'danger');
    res = { ok: false, code: 'error', reason: '内部错误', formation: null };
  } finally {
    formationBusy = false;
  }
  return res;
}

/** 建立空编队（不传名称时由 formations.js 生成“第N战斗群”） */
function handleCreateFormation(name) {
  const res = runFormationAction(
    (state) => createFormation(state, name),
    (r) => `编队「${r.formation.name}」已建立`
  );
  if (res.ok && ui) ui.selectFormation(res.formation.id);   // 新建后自动选中
  return res;
}

/** 套用预设模板组建编队（原子操作：单位不足或容量不够则整体失败） */
function handleApplyPreset(presetId) {
  const res = runFormationAction(
    (state) => applyPreset(state, presetId),
    (r) => `${r.formation.name}组建完成`
  );
  if (res.ok && ui) ui.selectFormation(res.formation.id);
  return res;
}

/** 解散编队（带二次确认，成员全部返回库存） */
function handleDisbandFormation(formationId, { confirm = true } = {}) {
  const state = getState();
  const target = resolveFormation(state, formationId);
  if (!target) {
    if (ui) ui.toast(FORMATION.reasons.notFound, 'warn');
    return { ok: false, code: 'not_found', reason: FORMATION.reasons.notFound, formation: null };
  }
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const n = (target.unitIds || []).length;
    if (!window.confirm(`确定要解散「${target.name}」吗？${n}个单位将返回库存。`)) {
      return { ok: false, code: 'cancelled', reason: '玩家取消了操作', formation: null };
    }
  }
  return runFormationAction(
    (s) => disbandFormation(s, formationId),
    (r) => `编队「${r.formation.name}」已解散`
  );
}

/** 重命名编队 */
function handleRenameFormation(formationId, name) {
  return runFormationAction(
    (state) => renameFormation(state, formationId, name),
    (r) => `编队已更名为「${r.formation.name}」`
  );
}

/** 把库存中的单位编入编队 */
function handleAddUnit(formationId, unitId) {
  return runFormationAction(
    (state) => addUnit(state, formationId, unitId),
    (r) => `${r.unitName || '单位'}已加入「${r.formation.name}」`
  );
}

/** 把单位移出编队，返回库存 */
function handleRemoveUnit(formationId, unitId) {
  return runFormationAction(
    (state) => removeUnit(state, formationId, unitId),
    (r) => `${r.unitName || '单位'}已返回库存`
  );
}

/* ------------------------------------------------------------
 * 战区与战斗（阶段5）
 * ---------------------------------------------------------- */

/**
 * 派遣编队进入战区。
 * 结果由 theater.dispatchFormation 一次性求解，这里只负责提示、落盘与刷新界面。
 */
function handleDispatch(formationId, theaterId, strategyId, operationId = null) {
  if (dispatchBusy) {
    const blocked = { ok: false, code: 'dispatch_busy', reason: '正在处理上一次派遣请求', activeBattle: null };
    if (ui) ui.toast(blocked.reason, 'warn');
    return blocked;
  }
  dispatchBusy = true;
  let res = { ok: false, code: 'dispatch_failed', reason: '派遣失败', activeBattle: null };
  try {
  const state = getState();
  res = operationId
    ? dispatchOperation(state, formationId, operationId, strategyId)
    : dispatchFormation(state, formationId, theaterId, strategyId);
  if (!res.ok) {
    if (ui) ui.toast(res.reason || '无法派遣', 'warn');
    return res;
  }
  // 派遣即落盘：中途刷新页面也能接着播放这场战斗
  saveGame(state, { silent: true });
  if (ui) {
    ui.refreshTheater(state);
    ui.toast('编队已出击');
  }
  return res;
  } catch (err) {
    console.error('[main] 派遣请求处理失败：', err);
    const failure = { ok: false, code: 'dispatch_error', reason: '派遣请求处理失败，请稍后重试', activeBattle: null };
    if (ui) ui.toast(failure.reason, 'danger');
    return failure;
  } finally {
    dispatchBusy = false;
  }
}

function handleRenameUnit(unitId, callsign) {
  const state = getState();
  const res = renameUnit(state, unitId, callsign);
  if (res.ok) {
    saveGame(state, { silent: true });
    if (ui) { ui.refreshUnits(state); ui.refreshFormations(state); ui.refreshTheater(state); ui.toast('单位呼号已保存'); }
  } else if (ui) ui.toast(res.reason || '呼号保存失败', 'warn');
  return res;
}

function handleEquipEquipment(unitId, equipmentInstanceId) {
  const state = getState();
  const res = equipEquipment(state, unitId, equipmentInstanceId);
  if (res.ok) {
    saveGame(state, { silent: true });
    if (ui) { ui.refreshUnits(state); ui.refreshFormations(state); ui.refreshTheater(state); ui.toast('装备已挂载'); }
  } else if (ui) ui.toast(res.reason || '装备挂载失败', 'warn');
  return res;
}

function handleUnequipEquipment(unitId, equipmentInstanceId) {
  const state = getState();
  const res = unequipEquipment(state, unitId, equipmentInstanceId);
  if (res.ok) {
    saveGame(state, { silent: true });
    if (ui) { ui.refreshUnits(state); ui.refreshFormations(state); ui.refreshTheater(state); ui.toast('装备已卸载'); }
  } else if (ui) ui.toast(res.reason || '装备卸载失败', 'warn');
  return res;
}

/** 玩家看完战报后返回基地：编队复位待命，清空活动战斗 */
function handleCloseBattle() {
  const state = getState();
  const res = skipBattleReturn(state);
  if (!res.ok) {
    if (ui) ui.toast(res.reason || '当前没有进行中的作战', 'warn');
    return res;
  }
  saveGame(state, { silent: true });
  if (ui) {
    ui.refreshTheater(state);
    ui.toast('编队已返回基地');
  }
  return res;
}

/** 跳过结算后的返航展示，不重新结算。 */
function handleSkipBattleReturn() {
  const state = getState();
  const res = skipBattleReturn(state);
  if (!res.ok) {
    if (ui) ui.toast(res.reason || '当前没有可跳过的返航', 'warn');
    return res;
  }
  saveGame(state, { silent: true });
  if (ui) { ui.refreshTheater(state); ui.toast('返航展示已跳过'); }
  return res;
}

/** 从历史正式战报启动只读回放，不创建新战斗，也不进入结算路径。 */
function handleReplayReport(reportId) {
  const state = getState();
  const session = Object.values(state.battleSessions || {})
    .find((row) => row && row.formalReportId === reportId);
  if (!session) {
    const result = { ok: false, code: 'report_invalid', reason: '该战报没有正式战斗会话', activeBattle: null };
    if (ui) ui.toast(result.reason, 'warn');
    return result;
  }
  const res = replayBattleSession(state, session.battleSessionId);
  if (!res.ok) {
    if (ui) ui.toast(res.reason || '无法启动战报回放', 'warn');
    return res;
  }
  saveGame(state, { silent: true });
  if (ui) {
    ui.switchTab('theater');
    ui.refreshTheater(state);
    ui.toast('已进入只读战报回放');
  }
  return res;
}

/** 领取战后打捞：唯一 equipment acquisition mutation seam。 */
function handleClaimBattleSalvage(battleSessionId) {
  const state = getState();
  const res = claimBattleSalvage(state, battleSessionId);
  if (res.ok) {
    saveGame(state, { silent: true });
    if (ui) {
      ui.toast(`已回收${res.instance?.equipmentId || '装备'}`, 'good');
      ui.refreshTheater(state);
      ui.refreshUnits(state);
      ui.refreshProduction(state);
    }
  } else if (ui) {
    ui.toast(res.reason || '当前无法领取战场打捞', 'warn');
  }
  return res;
}

/* ---- 维修操作（阶段6） ---- */

/** 正在处理维修请求的标记，杜绝同一帧内的重复提交 */
let repairBusy = false;

/**
 * 把受损单位送去维修。
 * 资格判断与费用扣除在 repairs.queueRepair() 内部完成，这里只负责加锁、提示、刷新、落盘。
 */
function handleRepair(unitId) {
  if (repairBusy) return { ok: false, reason: '正在处理上一次请求' };
  repairBusy = true;
  let res = { ok: false, reason: '未知错误' };
  try {
    const state = getState();
    res = queueRepair(state, unitId);
    if (res.ok) {
      if (ui) ui.toast(`${res.job ? res.job.unitName : '单位'}已进入维修队列`, 'info');
      saveGame(state, { silent: true });
    } else if (ui) {
      ui.toast(res.reason || '当前无法维修该单位', 'warn');
    }
    if (ui && typeof ui.refreshRepairs === 'function') ui.refreshRepairs(state);
    if (ui) ui.refreshFormations(state);
  } catch (err) {
    console.error('[main] 维修请求处理失败：', err);
    if (ui) ui.toast('维修请求处理失败，请查看控制台', 'danger');
    res = { ok: false, reason: '内部错误' };
  } finally {
    repairBusy = false;
  }
  return res;
}

/** 取消维修任务（带二次确认） */
function handleCancelRepair(jobId, { confirm = true } = {}) {
  const state = getState();
  const job = (state.repairs || []).find((j) => j && j.id === jobId);
  if (!job) {
    if (ui) ui.toast('未找到该维修任务', 'warn');
    return { ok: false, reason: '未找到该维修任务' };
  }
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(`确定要取消 ${job.unitName} 的维修吗？${job.status === 'active' ? '进行中任务仅退还一半费用。' : '排队任务全额退还费用。'}`)) {
      return { ok: false, reason: '玩家取消了操作' };
    }
  }
  const res = cancelRepairJob(state, jobId);
  if (ui) {
    ui.toast(res.ok ? `${job.unitName}维修已取消` : (res.reason || '取消失败'), res.ok ? 'warn' : 'danger');
    if (typeof ui.refreshRepairs === 'function') ui.refreshRepairs(state);
    ui.refreshFormations(state);
  }
  if (res.ok) saveGame(state, { silent: true });
  return res;
}

function handleResearch(techId) {
  const state = getState();
  const res = queueResearch(state, techId);
  if (res.ok) {
    recalcDerived(state);
    saveGame(state, { silent: true });
  } else if (ui) ui.toast(res.reason || '无法开始研究', 'warn');
  if (ui && typeof ui.refreshResearch === 'function') ui.refreshResearch(state);
  return res;
}

function handleCancelCurrentResearch({ confirm = true } = {}) {
  const state = getState();
  const current = state.research && state.research.current;
  if (!current) return { ok: false, reason: '当前没有进行中的研究' };
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function'
    && !window.confirm(`确定取消“${current.techId}”的研究吗？只能返还50%的已支付资源。`)) {
    return { ok: false, reason: '玩家取消了操作' };
  }
  const res = cancelCurrentResearch(state);
  if (res.ok) { recalcDerived(state); saveGame(state, { silent: true }); }
  if (ui && typeof ui.refreshResearch === 'function') ui.refreshResearch(state);
  return res;
}

function handleCancelQueuedResearch(taskId, { confirm = true } = {}) {
  const state = getState();
  if (confirm && typeof window !== 'undefined' && typeof window.confirm === 'function'
    && !window.confirm('确定取消这项等待研究吗？')) return { ok: false, reason: '玩家取消了操作' };
  const res = cancelQueuedResearch(state, taskId);
  if (res.ok) { recalcDerived(state); saveGame(state, { silent: true }); }
  if (ui && typeof ui.refreshResearch === 'function') ui.refreshResearch(state);
  return res;
}

/* ---- 离线结算（阶段6） ---- */

/**
 * 手动触发离线结算（调试接口用）：按真实秒数推进世界。
 * 正常流程下离线结算在 loadGame() 内自动完成，无需玩家手动触发。
 */
function handleSettleOffline(seconds, options = {}) {
  const state = getState();
  const secs = Math.max(0, Math.floor(Number(seconds) || 0));
  const info = calculateOfflineSeconds(Date.now() - secs * 1000, Date.now(), TIME.offlineMaxHours);
  const realSecs = Math.min(secs, info.maxSeconds);
  let report = null;
  try {
    report = settleOfflineProgress(state, realSecs, {
      ...options,
      createReport: realSecs >= TIME.offlineReportMinSeconds
    });
  } catch (err) {
    console.error('[main] 离线结算失败：', err);
    if (ui) ui.toast('离线结算发生异常', 'danger');
    return { ok: false, reason: '离线结算发生异常' };
  }
  saveGame(state, { silent: true });
  if (ui) {
    if (typeof ui.refreshRepairs === 'function') ui.refreshRepairs(state);
    ui.refreshConstruction(state);
    ui.refreshProduction(state);
    ui.refreshFormations(state);
    ui.refreshTheater(state);
  }
  return { ok: true, report };
}

/** 玩家点「知道了」：关闭离线报告卡片 */
function handleDismissOfflineReport() {
  const state = getState();
  const res = dismissOfflineReport(state);
  if (res.ok && ui && typeof ui.refreshOverview === 'function') ui.refreshOverview(state);
  if (res.ok) saveGame(state, { silent: true });
  return res;
}

/** 手动保存 */
function handleSave() {
  const state = getState();
  const ok = saveGame(state);
  if (ui) ui.toast(ok ? '基地数据已保存' : '保存失败：存储不可用', ok ? 'info' : 'danger');
}

/** 读取存档 */
function handleLoad() {
  if (!hasSave()) {
    if (ui) ui.toast('没有找到存档', 'warn');
    return;
  }
  // “读取”是玩家明确的恢复动作，优先读取显式手动槽位；启动时的 loadGame()
  // 仍默认续接自动槽位，避免刷新页面回到很久以前的手动存档。
  const res = loadGame({ preferManual: true });
  if (!res.ok) {
    if (ui) ui.toast(`读取失败：${res.reason}`, 'danger');
    return;
  }
  const state = getState();
  battlePresentationRouter?.reset();
  logEvent(state, '存档已载入，基地状态恢复。', LOG_LEVEL.GOOD);
  writeLoadNotes(state, res);
  if (ui) {
    ui.setSpeed(state.time.speed);
    ui.refreshConstruction(state);
    ui.refreshProduction(state);
    ui.refreshFormations(state);      // 读档后编队列表与指挥容量同步重画
    ui.refreshTheater(state);         // 阶段5：战区进度、活动战斗与战报同步重画
    if (typeof ui.refreshRepairs === 'function') ui.refreshRepairs(state);   // 阶段6：维修队列
    ui.toast('存档已载入');
  }
}

/** 读档后的附加提示：离线结算结果与数据自愈情况 */
function writeLoadNotes(state, res) {
  // 阶段6：离线结算结果已写入 state.offline，报告卡片由界面展示
  if (res.offlineSeconds >= TIME.offlineReportMinSeconds && state.offline) {
    const o = state.offline;
    if (o.settled) {
      const summary = (o.lines && o.lines.length) ? o.lines[0] : `离线 ${o.text}`;
      logEvent(state, `离线 ${o.text}进度已结算：${summary}。`, LOG_LEVEL.GOOD);
      if (o.capped) {
        logEvent(state, `离线时间超过上限，仅结算最近 ${o.text}。`, LOG_LEVEL.WARN);
      }
    } else {
      logEvent(state, `检测到离线 ${o.text}，但本次未产生可结算进度。`, LOG_LEVEL.WARN);
    }
  }
  if (res.repaired) {
    const parts = [];
    if (res.constructionRepaired) parts.push('施工');
    if (res.productionRepaired) parts.push('生产');
    if (res.formationRepaired) parts.push('编队');
    if (res.theaterRepaired) parts.push('战区');
    if (res.battleRepaired) parts.push('作战');
    if (res.repairQueueRepaired) parts.push('维修');
    const what = parts.length ? parts.join('、') : '存档';
    logEvent(state, `检测到异常${what}数据，已自动修复。`, LOG_LEVEL.WARN);
    (res.repairNotes || []).slice(0, 3).forEach((note) => {
      logEvent(state, `修复说明：${note}。`, LOG_LEVEL.INFO);
    });
  }
  const job = getConstructionProgress(state);
  if (job) {
    logEvent(state, `${job.name}施工已恢复，当前进度 ${job.percent}%，剩余约 ${job.remainingText}。`, LOG_LEVEL.INFO);
  }
  const formationCount = Array.isArray(state.formations) ? state.formations.length : 0;
  if (formationCount > 0) {
    logEvent(
      state,
      `${formationCount}支编队已恢复，指挥容量占用 ${state.command.used}/${state.command.capacity}。`,
      LOG_LEVEL.INFO
    );
  }

  // 阶段5：战区进度与未结束的作战
  const capturedNames = Object.keys(THEATERS)
    .filter((id) => state.theaters && state.theaters[id] && state.theaters[id].captured)
    .map((id) => THEATERS[id].name);
  if (capturedNames.length) {
    logEvent(state, `已占领战区：${capturedNames.join('、')}，占领收益持续生效。`, LOG_LEVEL.INFO);
  }
  const active = getActiveBattle(state);
    if (active) {
    if (active.settled) {
      logEvent(state,
        `${active.formationName}在${active.theaterName}的战斗已结束（${resultLabel(active.report && active.report.result)}），等待返回基地。`,
        LOG_LEVEL.BATTLE);
    } else {
      const pct = Math.floor((active.elapsed / Math.max(1, active.duration)) * 100);
      logEvent(state,
        `${active.formationName}正在${active.theaterName}作战，回放进度 ${pct}%，结果已锁定。`,
        LOG_LEVEL.BATTLE);
    }
  if (state.offline && state.offline.battlePaused) {
    logEvent(state, '一场活动战斗在离线期间保持暂停。', LOG_LEVEL.INFO);
  }
}
}

/** 新游戏 */
function handleNewGame() {
  const confirmed = window.confirm('确定要清空当前存档并重新开始吗？此操作不可撤销。');
  if (!confirmed) return;
  newGame();
  battlePresentationRouter?.reset();
  const state = getState();
  writeWelcomeLog(state);
  if (ui) {
    ui.setSpeed(state.time.speed);
    ui.toast('新的基地已建立');
  }
}

/* ------------------------------------------------------------
 * 日志
 * ---------------------------------------------------------- */

/** 新游戏开场日志 */
function writeWelcomeLog(state) {
  logEvent(state, '指挥终端上线，基地控制权已移交。', LOG_LEVEL.GOOD);
  logEvent(state, '指挥中心自检完成，可用指挥容量 6 点。', LOG_LEVEL.INFO);
  logEvent(state, '小型发电站并网，输出 30 点电力。', LOG_LEVEL.INFO);
  logEvent(state, '补给与合金生产线开始运转。', LOG_LEVEL.INFO);
  logEvent(state, '工程队已就位，可在「建设」分页批准新项目。', LOG_LEVEL.GOOD);
  logEvent(state, '作战编队室已开放，可在「编队」分页组建部队。', LOG_LEVEL.GOOD);
  logEvent(state, '战区地图已接入，可在「战区」分页选择目标与作战策略并派遣出击。', LOG_LEVEL.GOOD);
  logEvent(state, '维修车间已开放，受损单位可在「维修」分页排队修复，完成后返回库存。', LOG_LEVEL.GOOD);
  logEvent(state, `当前为阶段${CURRENT_STAGE}原型：战斗结算加固、单位维修与完整离线结算已开放。`, LOG_LEVEL.WARN);
}

/** 定时环境播报，让消息栏保持“基地在运转”的感觉 */
const AMBIENT_LINES = [
  { text: '各区域例行巡查完成，未发现异常。', level: LOG_LEVEL.INFO },
  { text: '后勤组完成补给分装，仓储压力正常。', level: LOG_LEVEL.INFO },
  { text: '发电站冷却塔排气正常，输出稳定。', level: LOG_LEVEL.INFO },
  { text: '指挥中心雷达完成一轮周边扫描。', level: LOG_LEVEL.INFO },
  { text: '工程班已完成预留地块的地基测绘。', level: LOG_LEVEL.INFO },
  { text: '警戒哨报告：基地外围态势平稳。', level: LOG_LEVEL.INFO }
];
let ambientTimer = 0;
let ambientIndex = 0;
const AMBIENT_INTERVAL = 600;   // 每 10 分钟（游戏时间）播报一次

/** 资源满仓提醒（只提醒一次，重新低于上限后可再次触发） */
const capWarned = { supply: false, alloy: false, intel: false };

function checkCapWarnings(state) {
  ['supply', 'alloy', 'intel'].forEach((key) => {
    const full = state.resources[key] >= state.caps[key] - 0.5;
    if (full && !capWarned[key]) {
      capWarned[key] = true;
      const name = { supply: '补给', alloy: '合金', intel: '情报' }[key];
      logEvent(state, `${name}已达存储上限，产量正在浪费。`, LOG_LEVEL.WARN);
    } else if (!full && capWarned[key]) {
      capWarned[key] = false;
    }
  });
}

/* ------------------------------------------------------------
 * 逻辑步进（固定步长，与帧率、速度无关）
 * ---------------------------------------------------------- */

function stepLogic(state, step) {
  state.time.game += step;
  state.time.played += step;

  tickEconomy(state, step);
  tickConstruction(state, step);   // 阶段2起有实际内容
  tickProduction(state, step);     // 阶段3起有实际内容
  tickActiveBattle(state, step);   // 阶段5：只推进播放进度，胜负在派遣时已定
  tickBattleReturn(state, step);   // 阶段8.1：结算后只推进返航展示
  tickRepairs(state, step);        // 阶段6起有实际内容
  const researchResult = tickResearch(state, step);
  if (researchResult.completed.length) recalcDerived(state);

  ambientTimer += step;
  if (ambientTimer >= AMBIENT_INTERVAL) {
    ambientTimer = 0;
    const line = AMBIENT_LINES[ambientIndex % AMBIENT_LINES.length];
    ambientIndex += 1;
    logEvent(state, line.text, line.level);
  }

  checkCapWarnings(state);
}

/* ------------------------------------------------------------
 * 主循环
 * ---------------------------------------------------------- */

let lastFrame = 0;
let logicAcc = 0;
let uiAcc = 0;

function frame(now) {
  const state = getState();
  const dtReal = Math.min((now - lastFrame) / 1000, TIME.maxFrameDelta);
  lastFrame = now;

  const speed = Number(state.time.speed) || 0;
  const dtGame = dtReal * speed;

  // 固定步长推进逻辑，保证任何帧率下结果一致
  logicAcc += dtGame;
  let guard = 0;
  while (logicAcc >= TIME.logicStep && guard < 1000) {
    stepLogic(state, TIME.logicStep);
    logicAcc -= TIME.logicStep;
    guard += 1;
  }
  if (guard >= 1000) logicAcc = 0;   // 异常情况下丢弃积压，避免卡死

  // 渲染（只读状态）。有活动战斗时画布交给战斗渲染器，否则显示基地。
  const active = state.activeBattle || null;
  const wantMode = active ? 'battle' : 'base';
  if (wantMode !== viewMode) {
    viewMode = wantMode;
    if (renderer && typeof renderer.setSuspended === 'function') {
      renderer.setSuspended(wantMode === 'battle');
    }
    if (battleRenderer) battleRenderer.reset();
    if (battlePresentationRouter) battlePresentationRouter.reset();
  }
  // UI 可能在没有点击的情况下自动选中首支编队，这里统一同步一次。
  if (ui) syncSelectedFormation(ui.selectedFormationId);
  if (viewMode === 'battle' && battlePresentationRouter) {
    battlePresentationRouter.render(active, dtReal);
  } else if (renderer) {
    renderer.render(state, dtGame, dtReal);
  }

  // 界面刷新节流到 10Hz，减少 DOM 开销
  uiAcc += dtReal;
  if (uiAcc >= 0.1) {
    uiAcc = 0;
    if (ui) ui.update(state, { fps: renderer ? renderer.fps : 0 });
  }

  // 自动保存（真实时间计时）
  if (tickAutoSave) tickAutoSave(state, dtReal);

  window.requestAnimationFrame(frame);
}

/* ------------------------------------------------------------
 * 启动
 * ---------------------------------------------------------- */

function boot() {
  const canvas = checkDom();
  if (!canvas) return;

  ui = new UI({
    onSpeedChange: setSpeed,
    onSave: handleSave,
    onLoad: handleLoad,
    onNewGame: handleNewGame,
    onBuild: handleBuild,
    onCancelConstruction: () => handleCancelConstruction(),
    onProduce: handleProduce,
    onProduceEquipment: handleProduceEquipment,
    onCancelCurrentProduction: () => handleCancelCurrentProduction(),
    onCancelQueuedProduction: (jobId) => handleCancelQueuedProduction(jobId),
    /* 阶段4：编队 */
    onCreateFormation: () => handleCreateFormation(),
    onApplyPreset: (presetId) => handleApplyPreset(presetId),
    onDisbandFormation: (formationId) => handleDisbandFormation(formationId),
    onRenameFormation: (formationId, name) => handleRenameFormation(formationId, name),
    onAddUnit: (formationId, unitId) => handleAddUnit(formationId, unitId),
    onRemoveUnit: (formationId, unitId) => handleRemoveUnit(formationId, unitId),
    onSelectFormation: (formationId) => syncSelectedFormation(formationId),
    /* 阶段5：战区与战斗 */
    onDispatch: (formationId, theaterId, strategyId, operationId) => handleDispatch(formationId, theaterId, strategyId, operationId),
    onConfirmDispatch: (formationId, theaterId, strategyId, operationId) => handleDispatch(formationId, theaterId, strategyId, operationId),
    onCloseBattle: () => handleCloseBattle(),
    onSkipBattleReturn: () => handleSkipBattleReturn(),
    onSelectTheater: () => {},
    onSelectReport: () => {},
    onReplayReport: (reportId) => handleReplayReport(reportId),
    /* 阶段6：维修与离线结算 */
    onRepair: (unitId) => handleRepair(unitId),
    onCancelRepair: (jobId) => handleCancelRepair(jobId),
    onDismissOfflineReport: () => handleDismissOfflineReport(),
    onResearch: (techId) => handleResearch(techId),
    onCancelCurrentResearch: (opts) => handleCancelCurrentResearch(opts),
    onCancelQueuedResearch: (taskId, opts) => handleCancelQueuedResearch(taskId, opts),
    onPresentationModeChange: (mode) => battlePresentationRouter?.setPreference(mode)
    ,onRenameUnit: (unitId, callsign) => handleRenameUnit(unitId, callsign)
    ,onEquipEquipment: (unitId, equipmentInstanceId) => handleEquipEquipment(unitId, equipmentInstanceId)
    ,onUnequipEquipment: (unitId, equipmentInstanceId) => handleUnequipEquipment(unitId, equipmentInstanceId)
    ,onClaimBattleSalvage: (battleSessionId) => handleClaimBattleSalvage(battleSessionId)
  });

  try {
    renderer = new BaseRenderer(canvas, qs('#canvas-tip'));
  } catch (err) {
    console.error('[main] 渲染器初始化失败：', err);
    return;
  }
  try {
    battleRenderer = new BattleRenderer(canvas);
  } catch (err) {
    console.error('[main] 战斗渲染器初始化失败：', err);
    battleRenderer = null;
  }
  battlePresentationRouter = createBattlePresentationRouter({
    canvas,
    legacyRenderer: battleRenderer,
    onStateChange: (presentationState) => ui?.setPresentationState(presentationState)
  });

  // 读档；没有存档则开新局
  const loaded = hasSave() ? loadGame() : { ok: false };
  const state = getState();
  if (loaded.ok) {
    logEvent(state, '存档已载入，基地状态恢复。', LOG_LEVEL.GOOD);
    writeLoadNotes(state, loaded);
  } else {
    writeWelcomeLog(state);
  }
  recalcDerived(state);

  // 施工完成时立即落盘，避免刚建成就关页面导致回退
  on('construction:completed', () => {
    reconcileUnlocksFromBuildings(getState());   // 建筑施工完成后校准单位解锁
    saveGame(getState(), { silent: true });
  });

  // 生产完成时立即落盘，避免刚生产完就关页面导致回退
    on('production:completed', () => {
    const s = getState();
    saveGame(s, { silent: true });
    if (ui) ui.refreshProduction(s);
  });

  // 战斗结算（阶段5）：损失、占领与奖励已写入状态，立即落盘并刷新界面
  on('battle:settled', () => {
    const s = getState();
    saveGame(s, { silent: true });
    if (ui) ui.refreshTheater(s);
  });

  // 维修完成（阶段6）：单位恢复满耐久并返回库存，立即落盘与刷新界面
  on('repair:completed', () => {
    const s = getState();
    saveGame(s, { silent: true });
    if (ui && typeof ui.refreshRepairs === 'function') ui.refreshRepairs(s);
    if (ui) ui.refreshFormations(s);
  });

  on('research:completed', () => {
    const s = getState();
    recalcDerived(s);
    saveGame(s, { silent: true });
    if (ui && typeof ui.refreshResearch === 'function') ui.refreshResearch(s);
  });

  on('battle:closed', () => {
    const s = getState();
    battlePresentationRouter?.reset();
    if (ui) { ui.refreshUnits(s); ui.refreshTheater(s); }
  });

  // 离线结算完成（阶段6）：报告已写入 state.offline，立即落盘，由界面展示
  on('offline:settled', () => {
    const s = getState();
    saveGame(s, { silent: true });
    if (ui) ui.refreshProduction(s);
  });

  tickAutoSave = createAutoSaver(TIME.autoSaveInterval);
  ui.setSpeed(state.time.speed);
  ui.update(state, { fps: 0 });

  // 键盘快捷键
  window.addEventListener('keydown', (e) => {
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '3') setSpeed(4);
  });

  // 关闭页面前保存一次，避免丢进度
  window.addEventListener('beforeunload', () => {
    saveGame(getState(), { silent: true });
  });

  // 调试句柄：全部转调正式业务函数，非法参数返回失败对象而不是抛异常
  window.__IRON_COMMAND__ = {
    stage: CURRENT_STAGE,
    stageLabel: CURRENT_STAGE_LABEL,
    getState,
    setSpeed: (value) => { setSpeed(value); return getState().time.speed; },
    save: () => saveGame(getState()),
    load: handleLoad,
    reset: () => { const result = newGame(); battlePresentationRouter?.reset(); return result; },
    /** 查询某建筑当前能否建造 */
    canBuild: (typeId) => {
      try {
        return canBuild(getState(), typeId);
      } catch (err) {
        return { ok: false, code: 'error', reasons: [String(err)], reason: String(err) };
      }
    },
    /** 批准建设（等同点击按钮，但不弹提示以外的交互） */
    build: (typeId) => {
      try {
        return handleBuild(typeId);
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 取消当前工程；传 { confirm:false } 可跳过确认弹窗 */
    cancelConstruction: (opts) => {
      try {
        return handleCancelConstruction(opts || {});
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 当前施工进度详情，空闲时返回 null */
    getConstructionProgress: () => {
      try {
        return getConstructionProgress(getState());
      } catch (err) {
        return null;
      }
    },
    /** 列出已建成（运行中）的建筑类型 id */
    built: () => {
      try {
        return getState().buildings
          .filter((b) => b.status === BUILDING_STATUS.OPERATIONAL)
          .map((b) => b.type);
      } catch (err) {
        return [];
      }
    },

    /* ---- 阶段3：生产调试接口 ---- */
    /** 查询某单位当前能否生产（返回 {ok, code, reason}） */
    canProduce: (unitType) => {
      try {
        return canQueueUnit(getState(), unitType);
      } catch (err) {
        return { ok: false, code: 'error', reasons: [String(err)], reason: String(err) };
      }
    },
    /** 提交生产（等同点击按钮），非法单位 ID 不抛异常 */
    produce: (unitType) => {
      try {
        return handleProduce(unitType);
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    canProduceEquipment: (equipmentId) => {
      try { return canQueueEquipment(getState(), equipmentId); }
      catch (err) { return { ok: false, code: 'error', reason: String(err), reasons: [String(err)] }; }
    },
    produceEquipment: (equipmentId) => {
      try { return handleProduceEquipment(equipmentId); }
      catch (err) { return { ok: false, code: 'error', reason: String(err) }; }
    },
    equipmentInventory: () => {
      try { return getState().equipment || { inventory: [], bindings: {} }; }
      catch (err) { return { inventory: [], bindings: {} }; }
    },
    /** 当前生产进度详情，空闲时返回 null */
    getProductionProgress: () => {
      try {
        return getProductionProgress(getState());
      } catch (err) {
        return null;
      }
    },
    /** 取消当前生产；传 { confirm:false } 可跳过确认弹窗 */
    cancelCurrentProduction: (opts) => {
      try {
        return handleCancelCurrentProduction(opts || {});
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 取消等待队列任务；传 { confirm:false } 可跳过确认弹窗 */
    cancelQueuedProduction: (jobId, opts) => {
      try {
        return handleCancelQueuedProduction(jobId, opts || {});
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 当前生产队列（current + queue 原始数据） */
    productionQueue: () => {
      try {
        const s = getState();
        return { current: s.production.current, queue: (s.production.queue || []).slice() };
      } catch (err) {
        return { current: null, queue: [] };
      }
    },
    /** 库存统计（按类型计数） */
    inventory: () => {
      try {
        return inventoryCount(getState());
      } catch (err) {
        return {};
      }
    },

    /* ---- 阶段8：单位档案与老兵 ---- */
    units: (filter = {}, sort = 'createdAt') => {
      try {
        const list = sortUnits(filterUnits(getState(), filter), sort);
        return list.map((unit) => ({ ...unit, rank: getUnitRank(unit) }));
      } catch (err) { return []; }
    },
    unit: (unitId) => {
      try { return (getState().units || []).find((unit) => unit && unit.id === unitId) || null; } catch (err) { return null; }
    },
    unitRank: (unitId) => {
      try { return getUnitRank((getState().units || []).find((unit) => unit && unit.id === unitId)); } catch (err) { return null; }
    },
    renameUnit: (unitId, callsign) => {
      try { return handleRenameUnit(unitId, callsign); } catch (err) { return { ok: false, code: 'error', reason: String(err) }; }
    },
    unitEffectiveStats: (unitId) => {
      try {
        const state = getState();
        return getUnitEffectiveStats((state.units || []).find((unit) => unit && unit.id === unitId), state.equipment);
      } catch (err) { return null; }
    },
    salvageOffer: (battleSessionId) => {
      try { return deriveSalvageOffer(getState(), battleSessionId); }
      catch (err) { return { ok: false, code: 'error', reason: String(err) }; }
    },
    claimBattleSalvage: (battleSessionId) => {
      try { return handleClaimBattleSalvage(battleSessionId); }
      catch (err) { return { ok: false, code: 'error', reason: String(err) }; }
    },

    /* ---- 阶段4：编队调试接口 ---- */
    /** 当前全部编队（原始数据浅拷贝） */
    formations: () => {
      try {
        return (getState().formations || []).map((f) => ({ ...f, unitIds: (f.unitIds || []).slice() }));
      } catch (err) {
        return [];
      }
    },
    /** 指挥容量占用情况 */
    command: () => {
      try {
        const s = getState();
        return { capacity: s.command.capacity, used: s.command.used, free: s.command.capacity - s.command.used };
      } catch (err) {
        return { capacity: 0, used: 0, free: 0 };
      }
    },
    /** 还能不能建立新编队 */
    canCreateFormation: () => {
      try {
        return canCreateFormation(getState());
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 建立空编队，不传名称则自动生成“第N战斗群” */
    createFormation: (name) => {
      try {
        return handleCreateFormation(name);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 重命名编队 */
    renameFormation: (formationId, name) => {
      try {
        return handleRenameFormation(formationId, name);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 解散编队；默认跳过确认弹窗，传 { confirm:true } 可还原玩家操作 */
    disbandFormation: (formationId, opts) => {
      try {
        return handleDisbandFormation(formationId, { confirm: false, ...(opts || {}) });
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 查询单位能否加入编队 */
    canAddUnit: (formationId, unitId) => {
      try {
        return canAddUnit(getState(), formationId, unitId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 单位入队 */
    addUnit: (formationId, unitId) => {
      try {
        return handleAddUnit(formationId, unitId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 单位移出编队 */
    removeUnit: (formationId, unitId) => {
      try {
        return handleRemoveUnit(formationId, unitId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 查询预设模板能否套用 */
    canApplyPreset: (presetId) => {
      try {
        return canApplyPreset(getState(), presetId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 套用预设模板（原子操作） */
    applyPreset: (presetId) => {
      try {
        return handleApplyPreset(presetId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), formation: null };
      }
    },
    /** 预设模板列表及其指挥消耗 */
    presets: () => {
      try {
        return FORMATION_PRESETS.map((p) => ({
          id: p.id, name: p.name, units: { ...p.units }, command: getPresetCommandCost(p.id)
        }));
      } catch (err) {
        return [];
      }
    },
    /** 编队汇总属性 */
    getFormationStats: (formationId) => {
      try {
        return getFormationStats(getState(), formationId);
      } catch (err) {
        return null;
      }
    },
    /** 编队评估提示（字符串数组） */
    getFormationWarnings: (formationId) => {
      try {
        return getFormationWarnings(getState(), formationId);
      } catch (err) {
        return [];
      }
    },
    /** 某编队占用的指挥点 */
    getFormationCommandCost: (formationId) => {
      try {
        return getFormationCommandCost(getState(), formationId);
      } catch (err) {
        return 0;
      }
    },
    /** 可加入编队的库存单位；传类型 ID 可过滤 */
    availableUnits: (typeId) => {
      try {
        return getAvailableUnits(getState(), typeId)
          .map((u) => ({ id: u.id, type: u.type, hp: u.hp, status: u.status }));
      } catch (err) {
        return [];
      }
    },
    /** 编队规则常量，便于人工测试时对照上限 */
    formationRules: () => ({
      maxFormations: FORMATION.maxFormations,
      maxNameLength: FORMATION.maxNameLength,
      editableStatuses: FORMATION.editableStatuses.slice()
    }),

    /* ---- 阶段5：战区与战斗调试接口 ---- */
    /** 全部战区视图（解锁状态、占领情况、战绩） */
    theaters: () => {
      try {
        return listTheaters(getState());
      } catch (err) {
        return [];
      }
    },
    /** 单个战区视图 */
    theater: (theaterId) => {
      try {
        return getTheaterState(getState(), theaterId);
      } catch (err) {
        return null;
      }
    },
    /** 战区敌情（雷达在线时为精确值） */
    intel: (theaterId) => {
      try {
        return getTheaterIntel(getState(), theaterId);
      } catch (err) {
        return null;
      }
    },
    /** 作战策略列表 */
    strategies: () => {
      try {
        return listStrategies();
      } catch (err) {
        return [];
      }
    },
    /** 任务成本预览（含计算明细） */
    missionCost: (formationId, theaterId, strategyId) => {
      try {
        return getMissionCost(getState(), formationId, theaterId, strategyId);
      } catch (err) {
        return { cost: {}, breakdown: {}, affordable: false, missing: [String(err)] };
      }
    },
    /** 派遣资格校验（不修改状态） */
    canDispatch: (formationId, theaterId, strategyId) => {
      try {
        return canDispatch(getState(), formationId, theaterId, strategyId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 派遣出击；可传入固定 seed 复现同一场战斗 */
    dispatch: (formationId, theaterId, strategyId, seed) => {
      try {
        if (Number.isFinite(seed)) {
          const state = getState();
          const res = dispatchFormation(state, formationId, theaterId, strategyId, seed);
          if (res.ok) {
            saveGame(state, { silent: true });
            if (ui) ui.refreshTheater(state);
          } else if (ui) {
            ui.toast(res.reason || '无法派遣', 'warn');
          }
          return res;
        }
        return handleDispatch(formationId, theaterId, strategyId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 当前活动战斗（含播放进度与结算标记） */
    activeBattle: () => {
      try {
        return getActiveBattle(getState());
      } catch (err) {
        return null;
      }
    },
    /** 战斗是否已结算完毕 */
    battleFinished: () => {
      try {
        return isBattleFinished(getState());
      } catch (err) {
        return false;
      }
    },
    /** 手动推进战斗播放进度（游戏秒），到点自动结算 */
    tickBattle: (seconds) => {
      try {
        return tickActiveBattle(getState(), Number(seconds) || 0);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 手动推进返航展示计时，不触发二次结算 */
    tickBattleReturn: (seconds) => {
      try {
        const res = tickBattleReturn(getState(), Number(seconds) || 0);
        if (res.ok && ui) ui.refreshBattle(getState());
        return res;
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 立即结算当前战斗（跳过剩余动画，幂等） */
    settleBattle: () => {
      try {
        const state = getState();
        const res = settleActiveBattle(state);
        if (res.ok && ui) ui.refreshTheater(state);
        return res;
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 返回基地，关闭结算面板 */
    closeBattle: () => {
      try {
        return handleCloseBattle();
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    skipBattleReturn: () => {
      try { return handleSkipBattleReturn(); } catch (err) { return { ok: false, code: 'error', reason: String(err), activeBattle: null }; }
    },
    finishBattleReturn: () => {
      try {
        const res = finishBattleReturn(getState());
        if (res.ok) { saveGame(getState(), { silent: true }); if (ui) ui.refreshTheater(getState()); }
        return res;
      } catch (err) { return { ok: false, code: 'error', reason: String(err), activeBattle: null }; }
    },
    /** 只关闭已被结算阻断的无效战斗，不应用损失或奖励 */
    abortInvalidBattle: () => {
      try {
        const state = getState();
        const res = abortInvalidBattle(state);
        if (res.ok) saveGame(state, { silent: true });
        return res;
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 历史战报（最新在前） */
    reports: () => {
      try {
        return getReports(getState());
      } catch (err) {
        return [];
      }
    },
    /** 按 ID 取战报 */
    report: (reportId) => {
      try {
        return getReport(getState(), reportId);
      } catch (err) {
        return null;
      }
    },
    /** 以正式会话只读回放历史战报；不会重新求解或重复结算。 */
    replayBattle: (battleSessionId) => {
      try {
        const res = replayBattleSession(getState(), battleSessionId);
        if (res.ok) { saveGame(getState(), { silent: true }); if (ui) ui.refreshTheater(getState()); }
        return res;
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), activeBattle: null };
      }
    },
    /** 纯求解：不扣资源、不改状态，只算一场战斗的结果（用于验证确定性） */
    simulate: (formationId, theaterId, strategyId, seed) => {
      try {
        const state = getState();
        const formation = resolveFormation(state, formationId);
        if (!formation) return null;
        return simulateBattle({
          state, formation, theaterId, strategyId, seed: Number(seed) || 0
        });
      } catch (err) {
        return null;
      }
    },
    /** 雷达站是否在线（决定敌情精度） */
    hasRadar: () => {
      try {
        return hasRadar(getState());
      } catch (err) {
        return false;
      }
    },
    /** 战斗规则常量，便于人工测试时对照 */
    battleRules: () => ({
      maxRounds: BATTLE.maxRounds,
      baseDuration: BATTLE.baseDuration,
      maxReports: BATTLE.maxReports,
      repairRatio: BATTLE.repairRatio,
      suppress: { ...BATTLE.suppress },
      recovery: { ...BATTLE.recovery },
      theaters: Object.keys(THEATERS)
    }),

    /* ---- 阶段8：可重复作战任务 ---- */
    operations: () => listOperations(getState()),
    operation: (operationId) => getOperation(getState(), operationId),
    canDispatchOperation: (formationId, operationId, strategyId) => {
      try { return canDispatchOperationMission(getState(), formationId, operationId, strategyId); } catch (err) { return { ok: false, code: 'error', reason: String(err) }; }
    },
    dispatchOperation: (formationId, operationId, strategyId, options = {}) => {
      try {
        const res = dispatchOperation(getState(), formationId, operationId, strategyId, options);
        if (res.ok) { saveGame(getState(), { silent: true }); if (ui) ui.refreshTheater(getState()); }
        return res;
      } catch (err) { return { ok: false, code: 'error', reason: String(err) }; }
    },
    operationCooldown: (operationId) => getOperation(getState(), operationId) ? getOperation(getState(), operationId).cooldownRemaining : 0,

    /* ---- 阶段6：维修与离线结算调试接口 ---- */
    /** 查询单位损伤等级（intact / light / heavy / destroyed） */
    damageState: (unitId) => {
      try {
        const s = getState();
        const unit = (s.units || []).find((u) => u && u.id === unitId);
        if (!unit) return { damage: null, hp: 0, maxHp: 0 };
        return { damage: damageStateOfUnit(unit), hp: unit.hp, maxHp: unit.maxHp };
      } catch (err) {
        return { damage: null, hp: 0, maxHp: 0 };
      }
    },
    /** 查询单位能否送去维修（返回 {ok, code, reason, severity, cost, duration, missing}） */
    canRepair: (unitId) => {
      try {
        return canQueueRepair(getState(), unitId);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err), severity: null, cost: {}, duration: 0, missing: [] };
      }
    },
    /** 把单位送去维修（等同点击维修按钮） */
    repair: (unitId) => {
      try {
        return handleRepair(unitId);
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 当前维修队列（active + queued 原始数据） */
    repairs: () => {
      try {
        const s = getState();
        return {
          active: getActiveRepairs(s).map((j) => ({ ...j })),
          queued: getQueuedRepairs(s).map((j) => ({ ...j }))
        };
      } catch (err) {
        return { active: [], queued: [] };
      }
    },
    /** 手动推进维修队列 N 游戏秒（事件步进，与离线一致） */
    advanceRepairs: (seconds) => {
      try {
        return tickRepairs(getState(), Math.max(0, Number(seconds) || 0));
      } catch (err) {
        return { completed: [], steps: 0 };
      }
    },
    /** 取消维修任务（默认跳过确认弹窗） */
    cancelRepair: (jobId, opts) => {
      try {
        return handleCancelRepair(jobId, { confirm: false, ...(opts || {}) });
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err) };
      }
    },
    /** 手动触发离线结算（推进真实秒数，调试用） */
    settleOffline: (seconds, opts) => {
      try {
        return handleSettleOffline(seconds, opts || {});
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 当前离线报告（无报告返回 null） */
    offlineReport: () => {
      try {
        const o = getState().offline;
        return o ? { ...o } : null;
      } catch (err) {
        return null;
      }
    },
    /** 关闭离线报告卡片（玩家点「知道了」） */
    dismissOfflineReport: () => {
      try {
        return handleDismissOfflineReport();
      } catch (err) {
        return { ok: false, reason: String(err) };
      }
    },
    /** 校验当前活动战斗的战报能否结算（只读，不修改状态） */
    validateActiveBattle: () => {
      try {
        const s = getState();
        const ab = getActiveBattle(s);
        if (!ab || !ab.report) return { ok: false, code: 'no_battle', reason: '当前没有可校验的活动战斗' };
        return validateBattleReportForSettlement(s, ab);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err) };
      }
    },
    /** 生成当前活动战斗的结算计划（只读，不修改状态） */
    settlementPlan: () => {
      try {
        const s = getState();
        const ab = getActiveBattle(s);
        if (!ab || !ab.report) return { ok: false, code: 'no_battle', reason: '当前没有可结算的活动战斗' };
        return buildSettlementPlan(s, ab);
      } catch (err) {
        return { ok: false, code: 'error', reason: String(err) };
      }
    },
    /* ---- 阶段7：科研调试接口 ---- */
    technologies: () => listTechnologies(getState()),
    technology: (techId) => {
      try { return listTechnologies(getState()).find((x) => x.id === techId) || null; } catch (err) { return null; }
    },
    canResearch: (techId) => {
      try { return canQueueResearch(getState(), techId); } catch (err) { return { ok: false, code: 'error', reason: String(err), task: null }; }
    },
    research: (techId) => {
      try { return handleResearch(techId); } catch (err) { return { ok: false, code: 'error', reason: String(err), task: null }; }
    },
    researchQueue: () => {
      const r = getState().research || {};
      return { current: r.current || null, queue: Array.isArray(r.queue) ? r.queue.slice() : [] };
    },
    researchProgress: () => getResearchProgress(getState()),
    advanceResearch: (seconds) => {
      try { const result = tickResearch(getState(), Math.max(0, Number(seconds) || 0)); recalcDerived(getState()); return result; } catch (err) { return { completed: [], steps: 0 }; }
    },
    cancelCurrentResearch: (opts) => handleCancelCurrentResearch({ confirm: false, ...(opts || {}) }),
    cancelQueuedResearch: (taskId, opts) => handleCancelQueuedResearch(taskId, { confirm: false, ...(opts || {}) }),
    completedResearch: () => (getState().research && getState().research.completed || []).slice(),
    researchModifiers: () => getResearchModifiers(getState()),
    researchHistory: () => getState().research && getState().research.history ? getState().research.history.map((row) => ({ ...row, completed: row.completed.slice() })) : [],
    validateResearchHistory: () => validateResearchHistory(getState().research && getState().research.history, getState().research && getState().research.revision),
    validateActiveBattleDeterministically: () => {
      try {
        const ab = getState().activeBattle;
        if (!ab || !ab.dispatchSnapshot) return { ok: false, reason: '当前活动战斗没有派遣快照' };
        const rebuilt = rebuildBattleFromDispatchSnapshot(ab.dispatchSnapshot, ab.seed);
        const check = validateBattleOutcomeConsistency(ab.report);
        const comparison = rebuilt ? compareBattleReports(rebuilt, ab.report) : { ok: false, reason: '重建失败' };
        return { ok: Boolean(rebuilt && check.ok && comparison.ok), outcome: check, comparison, rebuilt };
      } catch (err) { return { ok: false, reason: String(err) }; }
    },
    sanitizeResearch: () => sanitizeResearch(getState()),

    /** 维修规则常量，便于人工测试时对照上限 */
    presentation: () => battlePresentationRouter?.getState() || null,
    setPresentationMode: (mode) => { battlePresentationRouter?.setPreference(mode); return battlePresentationRouter?.getState() || null; },
    setBattlePresentationDebug: (enabled, options) => { battlePresentationRouter?.setDebugOverlay?.(enabled, options || {}); return battlePresentationRouter?.getDebugOverlayState?.() || { debugOverlay: false }; },
    battlePresentationDebug: () => battlePresentationRouter?.getDebugOverlayState?.() || { debugOverlay: false },
    resetPresentationCamera: () => { battlePresentationRouter?.resetCamera?.(); return battlePresentationRouter?.getInteractionState?.() || null; },
    battlePresentationInteraction: () => battlePresentationRouter?.getInteractionState?.() || null,
    battlePresentationSelection: () => battlePresentationRouter?.getSelectionState?.() || null,
    battlePresentationSelectActor: (actorId) => battlePresentationRouter?.setSelection?.(actorId) || null,
    battlePresentationClearSelection: () => battlePresentationRouter?.clearSelection?.() || null,
    /** Test-only evidence loader: it installs an immutable report as an active presentation input. */
    loadEvidenceBattle: (input = {}) => {
      const report = input.report;
      if (!report || typeof report !== 'object') return { ok: false, reason: 'evidence report missing' };
      const active = {
        id: input.id || report.id || 'evidence-battle',
        seed: Number.isFinite(Number(input.seed)) ? Number(input.seed) : Number(report.seed) || 0,
        theaterId: report.theaterId || null,
        theaterName: report.theaterName || '',
        strategyId: report.strategyId || null,
        missionKind: report.missionKind || 'campaign',
        missionId: report.missionId || report.theaterId || null,
        formationId: report.formationId || null,
        formationName: report.formationName || 'Evidence',
        dispatchedUnitIds: [], dispatchSnapshot: null,
        report,
        elapsed: 0, duration: Math.max(1, Number(report.duration) || 1),
        playing: true, settled: false, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5
      };
      const state = getState(); state.activeBattle = active; viewMode = 'battle';
      battlePresentationRouter?.reset?.(); battlePresentationRouter?.render?.(active, 0);
      return { ok: true, id: active.id, seed: active.seed, reportId: report.id, duration: active.duration };
    },
    battlePresentationEvidenceStateAt: (seconds, context = {}) => {
      const renderState = battlePresentationRouter?.getRenderStateAt?.(Number(seconds) || 0) || battlePresentationRouter?.getRenderState?.() || null;
      if (!renderState) return { ok: false, reason: 'presentation render state unavailable' };
      const payload = buildEvidenceStatePayload({ sceneId: context.sceneId || null, seed: context.seed, state: renderState, timeMs: Number(renderState.time || 0) * 1000 });
      const timeMs = Number(renderState.time || 0) * 1000; const c1Payload = buildStageC1EvidenceStatePayload({ sceneId: context.sceneId || null, seed: context.seed, state: renderState, timeMs, semanticName: context.semanticName || '' }); const textState = battlePresentationRouter?.getTextState?.({}) || null; return { ok: true, state: renderState, payload, stateSignature: buildEvidenceStateSignature({ sceneId: context.sceneId || null, seed: context.seed, state: renderState, timeMs }), c1Payload, c1StateSignature: buildStageC1EvidenceStateSignature({ sceneId: context.sceneId || null, seed: context.seed, state: renderState, timeMs, semanticName: context.semanticName || '' }), semanticPredicates: stageC1SemanticPredicates(context.semanticName || '', renderState), productionSemanticPredicate: evaluateProductionSemanticPredicate(context.semanticName || '', renderState), hudContract: textState?.hudContract || null, selection: battlePresentationRouter?.getSelectionState?.() || null };
    },
    battlePresentationDiagnostics: () => {
      const routerState = battlePresentationRouter?.getState?.() || null;
      const active = getState().activeBattle;
      const presentation = battlePresentationRouter?.getPresentation?.();
      const renderState = battlePresentationRouter?.getRenderState?.();
      return {
        ...routerState,
        activeBattle: active ? {
          id: active.id || active.report?.id || null,
          presentationPhase: active.presentationPhase || (active.settled ? 'returning' : 'battle'),
          elapsed: Number(active.elapsed || 0),
          returnElapsed: Number(active.returnElapsed || 0),
          returnDuration: Number(active.returnDuration || 0),
          reportFingerprint: routerState?.reportFingerprint || null
        } : null,
        repairAnchors: (presentation?.plan?.anchors || presentation?.plan?.timeline?.anchors || []).filter((anchor) => anchor.type === 'repair').map((anchor) => ({
          id: anchor.id, presentationTime: anchor.presentationTime, actorId: anchor.actorId, targetId: anchor.targetId, sourceEventId: anchor.sourceEventId
        })) || [],
        renderState: renderState ? {
          time: renderState.time, returning: Boolean(renderState.returning), returnProgress: Number(renderState.returnProgress || 0),
          choreography: renderState.choreography ? { ...renderState.choreography } : null,
          actors: renderState.actors.map((actor) => ({ id: actor.id, side: actor.side, type: actor.type, alive: actor.alive, hp: actor.hp, visualCenter: { ...actor.visualCenter }, anchorPosition: { ...actor.anchorPosition }, memberPositions: (actor.memberPositions || []).map((member) => ({ ...member })) })),
          wrecks: renderState.wrecks.map((wreck) => ({ ...wreck }))
        } : null,
        plan: presentation?.plan ? { mode: presentation.mode, templateId: presentation.plan.templateId || null, duration: presentation.plan.duration || presentation.plan.timeline?.duration || 0, timeMap: presentation.plan.timeMap || presentation.plan.timeline || null, repairAnchors: (presentation.plan.anchors || presentation.plan.timeline?.anchors || []).filter((anchor) => anchor.type === 'repair') } : null
      };
    },
    battlePresentationAssetStatus: () => battlePresentationRouter?.getAssetRuntimeState?.() || null,
    battlePresentationScreenMetrics: () => battlePresentationRouter?.getActorScreenMetrics?.() || null,
    battlePresentationRenderedBounds: () => battlePresentationRouter?.getActorRenderedBounds?.() || null,
    battlePresentationScreenMetricsAt: (seconds) => battlePresentationRouter?.getActorScreenMetricsAt?.(seconds) || null,
    battlePresentationSetAssetDisabled: (assetId, value = true) => battlePresentationRouter?.setAssetDisabled?.(assetId, value) || null,
    battlePresentationRenderStateAt: (seconds) => battlePresentationRouter?.getRenderStateAt?.(seconds) || null,
    battlePresentationRenderAt: (seconds) => { const active = getState().activeBattle; let rendered = battlePresentationRouter?.renderAt?.(seconds, active) || null; if (!rendered && active) { battlePresentationRouter?.setPreference?.('universal'); battlePresentationRouter?.render?.(active, 0); rendered = battlePresentationRouter?.renderAt?.(seconds, active) || null; } if (rendered && active) active.playing = false; return rendered; },
    repairRules: () => ({
      maxConcurrent: REPAIR.maxConcurrent,
      maxQueueSize: REPAIR.maxQueueSize,
      activeCancelRefundRatio: REPAIR.activeCancelRefundRatio,
      queuedCancelRefundRatio: REPAIR.queuedCancelRefundRatio,
      times: { ...REPAIR.times },
      cost: Object.keys(REPAIR.cost).reduce((acc, k) => { acc[k] = { ...REPAIR.cost[k] }; return acc; }, {})
    })
  };

  // 浏览器自动化与人工调试钩子：按游戏秒推进并返回可读的最小状态摘要。
  window.advanceTime = (milliseconds) => {
    battlePresentationRouter?.clearRenderOverride?.();
    const seconds = Math.max(0, Number(milliseconds) || 0) / 1000;
    const state = getState();
    let remaining = seconds;
    while (remaining > 0) {
      const step = Math.min(TIME.logicStep, remaining);
      stepLogic(state, step);
      remaining -= step;
    }
    if (state.activeBattle && battlePresentationRouter) battlePresentationRouter.render(state.activeBattle, 0);
    else if (renderer) renderer.render(state, 0, 0);
    if (ui) ui.update(state, { fps: renderer ? renderer.fps : 0 });
    return Promise.resolve();
  };
  window.render_game_to_text = () => {
    const state = getState();
    return JSON.stringify({
      coordinateSystem: 'origin top-left; +x right; +y down',
      stage: CURRENT_STAGE,
      stageLabel: CURRENT_STAGE_LABEL,
      viewMode,
      gameTime: Math.round(state.time.game),
      speed: state.time.speed,
      resources: { ...state.resources },
      research: {
        current: state.research && state.research.current ? state.research.current.techId : null,
        queue: state.research && Array.isArray(state.research.queue) ? state.research.queue.map((x) => x.techId) : [],
        completed: state.research && Array.isArray(state.research.completed) ? state.research.completed.slice() : []
      },
      activeBattle: Boolean(state.activeBattle),
      battlePresentation: state.activeBattle ? {
        phase: state.activeBattle.presentationPhase || (state.activeBattle.settled ? 'returning' : 'battle'),
        elapsed: Number(state.activeBattle.elapsed || 0),
        returnElapsed: Number(state.activeBattle.returnElapsed || 0),
        returnDuration: Number(state.activeBattle.returnDuration || 5),
        settled: Boolean(state.activeBattle.settled),
        settlementAttempted: Boolean(state.activeBattle.settlementAttempted),
        settlementBlocked: Boolean(state.activeBattle.settlementBlocked),
        settlementError: state.activeBattle.settlementError || null,
        mode: battlePresentationRouter?.getState()?.mode || 'legacy',
        preference: battlePresentationRouter?.getPreference?.() || 'auto',
        rendering: battlePresentationRouter?.getDebugOverlayState?.() || { debugOverlay: false },
        scene: battlePresentationRouter?.getTextState?.({}) || null,
        diagnostics: battlePresentationRouter?.getState?.() || null
      } : null
    });
  };

  lastFrame = performance.now();
  window.requestAnimationFrame(frame);
  console.info(`[钢铁指令] 阶段${CURRENT_STAGE} 原型已启动。`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
