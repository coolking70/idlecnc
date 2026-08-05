/**
 * research.js —— 技术实验室与科研队列。
 * 只负责科研业务与数据，不操作 DOM / Canvas。
 */

import { BUILDING_STATUS, RESEARCH, RESOURCE_DEFS, TECHNOLOGIES } from './config.js';
import { emit, logEvent, LOG_LEVEL } from './events.js';
import { uid, safeNumber, clamp, stableStringify } from './utils.js';
import { validateCompletedTechnologyClosure } from './integrity.js';

export const RESEARCH_CODE = {
  UNKNOWN: 'unknown',
  CENTER_MISSING: 'research_center_missing',
  CENTER_OFFLINE: 'research_center_offline',
  COMPLETED: 'completed',
  ALREADY_QUEUED: 'already_queued',
  PREREQUISITE: 'prerequisite',
  QUEUE_FULL: 'queue_full',
  RESOURCE: 'resource',
  READY: 'ready'
};

const MODIFIER_DEFAULTS = {
  supplyPerSec: 0, alloyPerSec: 0, supplyCap: 0, alloyCap: 0,
  infantryProductionTimeMultiplier: 1, vehicleProductionTimeMultiplier: 1,
  repairTimeMultiplier: 1, armorBattleDefenseMultiplier: 1,
  battleScoutingMultiplier: 1, commandCapacity: 0
};

function isObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function ensureResearch(state) {
  if (!isObject(state.research)) state.research = { current: null, queue: [], completed: [], revision: 0, history: [] };
  if (!Array.isArray(state.research.queue)) state.research.queue = [];
  if (!Array.isArray(state.research.completed)) state.research.completed = [];
  if (!Number.isInteger(state.research.revision) || state.research.revision < 0) state.research.revision = 0;
  if (!Array.isArray(state.research.history)) state.research.history = [];
  if (!state.research.history.some((row) => row && row.revision === 0)) {
    state.research.history.unshift({ revision: 0, completed: [], gameTime: safeNumber(state.time && state.time.game, 0) });
  }
  return state.research;
}
function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), task: null, ...extra };
}
function pass(code = RESEARCH_CODE.READY, extra = {}) {
  return { ok: true, code, reason: '', task: null, ...extra };
}
function techName(id) { return TECHNOLOGIES[id] ? TECHNOLOGIES[id].name : id; }
function hasResource(state, key, amount) {
  return safeNumber(state.resources && state.resources[key], 0) >= safeNumber(amount, 0);
}
function missingResources(state, cost) {
  return Object.keys(cost || {}).map((key) => {
    const missing = Math.max(0, safeNumber(cost[key], 0) - safeNumber(state.resources && state.resources[key], 0));
    if (!missing) return null;
    const name = RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key;
    return { key, amount: missing, text: `${name}不足，缺少${Math.ceil(missing)}` };
  }).filter(Boolean);
}
function spend(state, cost) {
  if (missingResources(state, cost).length) return false;
  Object.keys(cost || {}).forEach((key) => { state.resources[key] -= cost[key]; });
  return true;
}
function refund(state, cost, ratio) {
  const out = {};
  Object.keys(cost || {}).forEach((key) => {
    const value = Math.floor(safeNumber(cost[key], 0) * ratio);
    if (value > 0) {
      const cap = safeNumber(state.caps && state.caps[key], Infinity);
      state.resources[key] = Math.min(cap, safeNumber(state.resources[key], 0) + value);
      out[key] = value;
    }
  });
  return out;
}

export function hasResearchCenter(state) {
  return Boolean((state && state.buildings || []).some(
    (b) => b && b.type === 'research_center' && b.status === BUILDING_STATUS.OPERATIONAL
  ));
}

export function isTechnologyCompleted(state, techId) {
  const r = ensureResearch(state || {});
  return r.completed.includes(techId);
}

export function getResearchModifiers(state) {
  const mods = { ...MODIFIER_DEFAULTS };
  // 运行时读取当前科研面板；存档入口会先用 sanitizeResearch 清理依赖闭包。
  // 这里保留对旧阶段直接写入 state.research.completed 的兼容性，任务本身仍只绑定 history revision。
  const completed = new Set(Array.isArray(state && state.research && state.research.completed)
    ? state.research.completed.filter((id) => TECHNOLOGIES[id]) : []);
  completed.forEach((id) => {
    const effects = TECHNOLOGIES[id] && TECHNOLOGIES[id].effects;
    if (!effects) return;
    Object.keys(effects).forEach((key) => {
      const value = safeNumber(effects[key], 0);
      if (key.endsWith('Multiplier')) mods[key] = safeNumber(mods[key], 1) * value;
      else mods[key] = safeNumber(mods[key], 0) + value;
    });
  });
  return mods;
}

/** 获取某个可信科研版本的闭合完成集合。 */
export function getResearchCompletedAtRevision(state, revision, createdGameTime = Infinity) {
  const r = ensureResearch(state || {});
  const requested = Number.isInteger(Number(revision)) && Number(revision) >= 0 ? Number(revision) : -1;
  const timeLimit = Number.isFinite(Number(createdGameTime)) ? Number(createdGameTime) : Infinity;
  const rows = r.history
    .filter((row) => row && Number.isInteger(row.revision) && row.revision <= requested && safeNumber(row.gameTime, 0) <= timeLimit)
    .sort((a, b) => b.revision - a.revision);
  return rows.length ? validateCompletedTechnologyClosure(rows[0].completed) : [];
}

export function getResearchHistory(state) {
  const r = ensureResearch(state || {});
  return r.history.map((row) => ({ ...row, completed: validateCompletedTechnologyClosure(row.completed) }));
}

function recordResearchRevision(state) {
  const r = ensureResearch(state);
  const completed = validateCompletedTechnologyClosure(r.completed);
  r.completed = completed;
  const nextRevision = Math.max(0, safeNumber(r.revision, 0)) + 1;
  r.revision = nextRevision;
  r.history = r.history.filter((row) => row && row.revision !== nextRevision);
  r.history.push({ revision: nextRevision, completed: completed.slice(), gameTime: safeNumber(state.time && state.time.game, 0) });
  r.history.sort((a, b) => a.revision - b.revision);
  if (r.history.length > 64) r.history = r.history.slice(-64);
}

/** 将运行时科研集合固化为可信版本，供生产、维修和派遣任务绑定。 */
export function ensureResearchRevision(state) {
  const r = ensureResearch(state);
  const current = validateCompletedTechnologyClosure(r.completed);
  const latest = r.history.slice().sort((a, b) => b.revision - a.revision)[0];
  if (!latest || stableStringify(current) !== stableStringify(latest.completed)) {
    r.completed = current;
    recordResearchRevision(state);
  }
  return r.revision;
}

export function getTechnologyState(state, techId) {
  const tech = TECHNOLOGIES[techId];
  if (!tech) return { id: techId, status: 'unknown', code: RESEARCH_CODE.UNKNOWN, reason: '未知科技' };
  const r = ensureResearch(state || {});
  if (r.completed.includes(techId)) return { ...tech, status: 'completed', code: RESEARCH_CODE.COMPLETED, reason: '该科技已经完成' };
  if (r.current && r.current.techId === techId) return { ...tech, status: 'researching', code: RESEARCH_CODE.ALREADY_QUEUED, reason: '该科技正在研究中' };
  if (r.queue.some((j) => j && j.techId === techId)) return { ...tech, status: 'queued', code: RESEARCH_CODE.ALREADY_QUEUED, reason: '该科技已经位于研究队列中' };
  const missing = (tech.requires || []).filter((id) => !r.completed.includes(id));
  if (missing.length) return { ...tech, status: 'locked', code: RESEARCH_CODE.PREREQUISITE, reason: `需要先完成“${techName(missing[0])}”` };
  if (!hasResearchCenter(state)) return { ...tech, status: 'locked', code: RESEARCH_CODE.CENTER_MISSING, reason: '需要先建成技术实验室' };
  return { ...tech, status: 'available', code: RESEARCH_CODE.READY, reason: '' };
}

export function listTechnologies(state) {
  return Object.keys(TECHNOLOGIES).map((id) => getTechnologyState(state, id));
}

export function canQueueResearch(state, techId) {
  if (!state || typeof state !== 'object') return fail(RESEARCH_CODE.UNKNOWN, '状态无效');
  const tech = TECHNOLOGIES[techId];
  if (!tech) return fail(RESEARCH_CODE.UNKNOWN, '未知科技');
  const r = ensureResearch(state);
  if (!hasResearchCenter(state)) {
    const building = (state.buildings || []).find((b) => b && b.type === 'research_center');
    return fail(building ? RESEARCH_CODE.CENTER_OFFLINE : RESEARCH_CODE.CENTER_MISSING,
      building ? '技术实验室尚未运行' : '需要先建成技术实验室');
  }
  if (r.completed.includes(techId)) return fail(RESEARCH_CODE.COMPLETED, '该科技已经完成');
  if ((r.current && r.current.techId === techId) || r.queue.some((j) => j && j.techId === techId)) {
    return fail(RESEARCH_CODE.ALREADY_QUEUED, '该科技已经位于研究队列中');
  }
  const missingPrereq = (tech.requires || []).filter((id) => !r.completed.includes(id));
  if (missingPrereq.length) return fail(RESEARCH_CODE.PREREQUISITE, `需要先完成“${techName(missingPrereq[0])}”`);
  const total = (r.current ? 1 : 0) + r.queue.length;
  if (total >= RESEARCH.maxQueueSize) return fail(RESEARCH_CODE.QUEUE_FULL, `研究队列已满：最多${RESEARCH.maxQueueSize}项`);
  const missing = missingResources(state, tech.cost);
  if (missing.length) return fail(RESEARCH_CODE.RESOURCE, missing.map((x) => x.text).join('，'), { missing });
  return pass(RESEARCH_CODE.READY, { technology: tech, cost: { ...tech.cost }, duration: tech.researchTime });
}

function createTask(state, tech) {
  const revision = safeNumber(state.research && state.research.revision, 0);
  const createdGameTime = safeNumber(state.time && state.time.game, 0);
  return {
    id: uid('research_job'), techId: tech.id, elapsed: 0,
    duration: tech.researchTime, durationBase: tech.researchTime,
    costPaid: { ...tech.cost }, queuedAt: createdGameTime, startedAt: null,
    createdGameTime, researchRevision: revision,
    researchSnapshot: getResearchCompletedAtRevision(state, revision, createdGameTime)
  };
}

export function queueResearch(state, techId) {
  const check = canQueueResearch(state, techId);
  if (!check.ok) return check;
  const r = ensureResearch(state);
  const task = createTask(state, TECHNOLOGIES[techId]);
  if (!spend(state, task.costPaid)) return fail(RESEARCH_CODE.RESOURCE, '资源扣除失败');
  if (!r.current) {
    r.current = task;
    task.startedAt = safeNumber(state.time && state.time.game, 0);
    logEvent(state, `${TECHNOLOGIES[techId].name}研究开始。`, LOG_LEVEL.INFO);
    emit('research:started', { taskId: task.id, techId });
  } else {
    r.queue.push(task);
    logEvent(state, `${TECHNOLOGIES[techId].name}已加入研究队列，当前排在第${r.queue.length + 1}位。`, LOG_LEVEL.INFO);
    emit('research:queued', { taskId: task.id, techId, position: r.queue.length + 1 });
  }
  return pass(RESEARCH_CODE.READY, { task });
}

export function startNextResearch(state) {
  const r = ensureResearch(state);
  if (r.current || !r.queue.length || !hasResearchCenter(state)) return false;
  const task = r.queue.shift();
  task.elapsed = clamp(safeNumber(task.elapsed, 0), 0, task.duration);
  task.startedAt = safeNumber(state.time && state.time.game, 0);
  r.current = task;
  logEvent(state, `${techName(task.techId)}研究开始。`, LOG_LEVEL.INFO);
  emit('research:started', { taskId: task.id, techId: task.techId });
  return true;
}

export function completeResearch(state, taskId) {
  const r = ensureResearch(state);
  const task = r.current;
  if (!task || (taskId && task.id !== taskId)) return fail(RESEARCH_CODE.UNKNOWN, '当前研究任务不存在');
  const tech = TECHNOLOGIES[task.techId];
  if (!tech) { r.current = null; return fail(RESEARCH_CODE.UNKNOWN, '未知科技任务已清除'); }
  if (!r.completed.includes(tech.id)) r.completed.push(tech.id);
  r.completed = validateCompletedTechnologyClosure(r.completed);
  recordResearchRevision(state);
  r.current = null;
  logEvent(state, `${tech.name}研究完成，${tech.desc}`, LOG_LEVEL.GOOD);
  emit('research:completed', { taskId: task.id, techId: tech.id, name: tech.name });
  startNextResearch(state);
  return pass(RESEARCH_CODE.READY, { task, techId: tech.id });
}

export function tickResearch(state, dt, options = {}) {
  const completed = [];
  if (!state || !isObject(state) || !(dt > 0)) return { completed, steps: 0 };
  if (!options.ignorePause && state.time && Number(state.time.speed) === 0) return { completed, steps: 0 };
  const r = ensureResearch(state);
  if (!hasResearchCenter(state)) return { completed, steps: 0 };
  startNextResearch(state);
  let remaining = Math.max(0, safeNumber(dt, 0));
  let guard = 0;
  while (remaining > 1e-9 && guard < 32 && r.current) {
    guard += 1;
    const task = r.current;
    const duration = Math.max(0.1, safeNumber(task.duration, 0.1));
    const need = Math.max(0, duration - safeNumber(task.elapsed, 0));
    const used = Math.min(remaining, need || remaining);
    task.elapsed += used;
    remaining -= used;
    if (task.elapsed >= duration - 1e-9) {
      task.elapsed = duration;
      const id = task.techId;
      const result = completeResearch(state, task.id);
      if (result.ok) completed.push(id);
    } else break;
  }
  return { completed, steps: guard };
}

export function cancelCurrentResearch(state) {
  const r = ensureResearch(state);
  if (!r.current) return fail(RESEARCH_CODE.UNKNOWN, '当前没有进行中的研究');
  const task = r.current;
  r.current = null;
  const refundValue = refund(state, task.costPaid, RESEARCH.activeCancelRefundRatio);
  startNextResearch(state);
  logEvent(state, `${techName(task.techId)}研究已取消，返还${Object.keys(refundValue).map((k) => `${RESOURCE_DEFS[k] ? RESOURCE_DEFS[k].name : k}${refundValue[k]}`).join('、') || '无资源'}。`, LOG_LEVEL.WARN);
  emit('research:cancelled', { taskId: task.id, techId: task.techId, refund: refundValue, active: true });
  return pass(RESEARCH_CODE.READY, { task, refund: refundValue });
}

export function cancelQueuedResearch(state, taskId) {
  const r = ensureResearch(state);
  const index = r.queue.findIndex((task) => task && task.id === taskId);
  if (index < 0) return fail(RESEARCH_CODE.UNKNOWN, '等待研究任务不存在');
  const task = r.queue.splice(index, 1)[0];
  const refundValue = refund(state, task.costPaid, RESEARCH.queuedCancelRefundRatio);
  logEvent(state, `${techName(task.techId)}研究已取消，返还${Object.keys(refundValue).map((k) => `${RESOURCE_DEFS[k] ? RESOURCE_DEFS[k].name : k}${refundValue[k]}`).join('、') || '无资源'}。`, LOG_LEVEL.WARN);
  emit('research:cancelled', { taskId: task.id, techId: task.techId, refund: refundValue, active: false });
  return pass(RESEARCH_CODE.READY, { task, refund: refundValue });
}

export function getResearchProgress(state) {
  const task = state && state.research && state.research.current;
  if (!task) return null;
  const duration = Math.max(0.1, safeNumber(task.duration, 0.1));
  const elapsed = clamp(safeNumber(task.elapsed, 0), 0, duration);
  return {
    ...task, name: techName(task.techId), duration, elapsed,
    remaining: Math.max(0, duration - elapsed), progress: elapsed / duration,
    percent: Math.round((elapsed / duration) * 100)
  };
}

function normalizeTask(raw, where, notes) {
  if (!isObject(raw) || !TECHNOLOGIES[raw.techId]) { notes.push(`${where}科研任务无效，已移除。`); return null; }
  const tech = TECHNOLOGIES[raw.techId];
  const task = { ...raw };
  task.id = typeof raw.id === 'string' && raw.id ? raw.id : uid('research_job');
  task.techId = tech.id;
  task.createdGameTime = Math.max(0, safeNumber(raw.createdGameTime, safeNumber(raw.queuedAt, stateGameTime(notes))));
  task.researchRevision = Number.isInteger(Number(raw.researchRevision)) ? Number(raw.researchRevision) : -1;
  task._legacySnapshot = Array.isArray(raw.researchSnapshot) ? raw.researchSnapshot.slice() : null;
  task.durationBase = tech.researchTime;
  task.duration = tech.researchTime;
  task.costPaid = { ...tech.cost };
  task.queuedAt = safeNumber(raw.queuedAt, 0);
  task.startedAt = raw.startedAt == null ? null : safeNumber(raw.startedAt, 0);
  task.elapsed = clamp(safeNumber(raw.elapsed, 0), 0, task.duration);
  return task;
}

function stateGameTime(notes) {
  void notes;
  return 0;
}

export function sanitizeResearch(state) {
  const notes = [];
  if (!state || typeof state !== 'object') return { repaired: false, notes };
  const r = ensureResearch(state);
  const rawCompleted = r.completed.slice();
  r.completed = validateCompletedTechnologyClosure(rawCompleted);
  if (r.completed.length !== rawCompleted.length) {
    const removed = rawCompleted.filter((id) => !r.completed.includes(id)).map(techName);
    notes.push(`科研前置关系修复：移除${removed.join('、') || '非法科技'}。`);
  }
  const rawHistory = Array.isArray(r.history) ? r.history : [];
  const history = [{ revision: 0, completed: [], gameTime: safeNumber(state.time && state.time.game, 0) }];
  const seenRevisions = new Set([0]);
  rawHistory.forEach((row) => {
    if (!isObject(row) || !Number.isInteger(Number(row.revision)) || Number(row.revision) < 0) { notes.push('非法科研历史记录已移除。'); return; }
    const revision = Number(row.revision);
    if (seenRevisions.has(revision)) { if (revision !== 0) notes.push('重复科研revision已移除。'); return; }
    const completed = validateCompletedTechnologyClosure(row.completed);
    if (completed.length !== (Array.isArray(row.completed) ? row.completed.filter((id) => TECHNOLOGIES[id]).length : 0)) notes.push(`科研历史revision ${revision} 已清理非法前置科技。`);
    history.push({ revision, completed, gameTime: Math.max(0, safeNumber(row.gameTime, state.time && state.time.game)) });
    seenRevisions.add(revision);
  });
  history.sort((a, b) => a.revision - b.revision);
  const maxHistoryRevision = Math.max(...history.map((row) => row.revision), 0);
  r.revision = maxHistoryRevision;
  r.history = history.slice(-64);
  const seen = new Set();
  let current = r.current ? normalizeTask(r.current, '当前', notes) : null;
  const normalizeVersion = (task, where) => {
    if (!task) return null;
    let revision = task.researchRevision;
    if (!r.history.some((row) => row.revision === revision)) {
      const legacy = validateCompletedTechnologyClosure(task._legacySnapshot || []);
      if (task._legacySnapshot) {
        const next = Math.max(...r.history.map((row) => row.revision), 0) + 1;
        r.history.push({ revision: next, completed: legacy, gameTime: Math.min(task.createdGameTime, safeNumber(state.time && state.time.game, 0)) });
        revision = next;
        notes.push(`${where}科研任务已迁移到兼容科研revision。`);
      } else {
        revision = -1;
        notes.push(`${where}科研任务引用不存在的科研revision，已回退为无科研修正。`);
      }
    }
    task.researchRevision = revision;
    task.createdGameTime = Math.min(Math.max(0, task.createdGameTime), safeNumber(state.time && state.time.game, 0));
    const completedAtCreation = revision >= 0 ? getResearchCompletedAtRevision(state, revision, task.createdGameTime) : [];
    if ((TECHNOLOGIES[task.techId].requires || []).some((id) => !completedAtCreation.includes(id))) {
      notes.push(`${where}科研任务“${techName(task.techId)}”前置未完成，已移除。`);
      return null;
    }
    task.durationBase = TECHNOLOGIES[task.techId].researchTime;
    task.duration = task.durationBase;
    delete task.researchSnapshot;
    delete task._legacySnapshot;
    return task;
  };
  current = normalizeVersion(current, '当前');
  if (current) seen.add(current.id);
  const queue = [];
  r.queue.forEach((raw) => {
    const task = normalizeVersion(normalizeTask(raw, '等待', notes), '等待');
    if (!task || seen.has(task.id) || r.completed.includes(task.techId)
      || (current && current.techId === task.techId) || queue.some((x) => x.techId === task.techId)) {
      if (task) notes.push('重复或已完成科研任务已移除。');
      return;
    }
    seen.add(task.id);
    task.startedAt = null;
    task.elapsed = 0;
    queue.push(task);
  });
  if (current && r.completed.includes(current.techId)) { current = null; notes.push('已完成科技的当前任务已移除。'); }
  const all = [];
  if (current) all.push(current);
  all.push(...queue);
  if (all.length > RESEARCH.maxQueueSize) {
    all.length = RESEARCH.maxQueueSize;
    notes.push('科研队列超过上限，已截断。');
  }
  r.current = all.shift() || null;
  r.queue = all;
  if (r.current && r.current.startedAt == null) r.current.startedAt = safeNumber(state.time && state.time.game, 0);
  if (!r.current && r.queue.length && hasResearchCenter(state)) { startNextResearch(state); notes.push('已恢复停滞的科研队列。'); }
  r.history.sort((a, b) => a.revision - b.revision);
  if (r.history.length > 64) r.history = r.history.slice(-64);
  r.revision = Math.max(...r.history.map((row) => row.revision), 0);
  return { repaired: notes.length > 0, notes };
}

export const RESEARCH_API = {
  hasResearchCenter, getResearchModifiers, getResearchCompletedAtRevision, getResearchHistory, ensureResearchRevision,
  isTechnologyCompleted, getTechnologyState,
  listTechnologies, canQueueResearch, queueResearch, tickResearch, startNextResearch,
  completeResearch, cancelCurrentResearch, cancelQueuedResearch, getResearchProgress,
  sanitizeResearch
};
