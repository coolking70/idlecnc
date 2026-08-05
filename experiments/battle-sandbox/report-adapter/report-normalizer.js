const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const IDENTITY_FIELDS = ['id', 'realId', 'side', 'type', 'category', 'shape', 'maxHp'];
const STAT_FIELDS = ['attack', 'antiArmor', 'defense', 'scouting', 'mobility', 'repair'];
const KNOWN_CATEGORIES = new Set(['infantry', 'at_infantry', 'vehicle', 'armor', 'support']);

function strictNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableString(value) {
  return value === null || value === undefined ? null : String(value);
}

function cloneJson(value) {
  if (value === undefined) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function canonicalize(value, seen = new WeakSet()) {
  if (value === undefined || typeof value === 'function') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('stableStringify does not accept circular values');
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  const output = {};
  Object.keys(value).sort().forEach((key) => { output[key] = canonicalize(value[key], seen); });
  seen.delete(value);
  return output;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function deepFreezeContract(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreezeContract(child, seen));
  return Object.freeze(value);
}

function addError(diagnostics, code, details = {}) {
  diagnostics.errors.push({ code, ...details });
}

function addWarning(diagnostics, code, details = {}) {
  diagnostics.warnings.push({ code, ...details });
}

function resolveAliasedField(event, modern, legacy, label) {
  const hasModern = hasOwn(event, modern);
  const hasLegacy = hasOwn(event, legacy);
  if (hasModern && hasLegacy && event[modern] !== event[legacy]) throw new TypeError(`battle event ${label} conflict: ${modern} !== ${legacy}`);
  return hasModern ? event[modern] : hasLegacy ? event[legacy] : null;
}

function resolveValue(event, diagnostics, index) {
  if (hasOwn(event, 'value') && hasOwn(event, 'amount') && Number(event.value) !== Number(event.amount)) throw new TypeError('battle event value conflict: value !== amount');
  const value = hasOwn(event, 'value') ? event.value : event?.amount;
  if (value === undefined || value === null) return 0;
  const number = strictNumber(value);
  if (number === null) { addError(diagnostics, 'invalid_event_value', { index, value }); return null; }
  return number;
}

export function normalizeBattleEvent(event, index, diagnostics = { errors: [], warnings: [] }) {
  const source = event && typeof event === 'object' ? event : {};
  const actorValue = resolveAliasedField(source, 'actor', 'actorId', 'actor');
  const targetValue = resolveAliasedField(source, 'target', 'targetId', 'target');
  if (actorValue !== null && actorValue !== undefined && typeof actorValue !== 'string') addError(diagnostics, 'invalid_event_actor_id', { index, value: actorValue });
  if (targetValue !== null && targetValue !== undefined && typeof targetValue !== 'string') addError(diagnostics, 'invalid_event_target_id', { index, value: targetValue });
  const time = strictNumber(source.t);
  if (time === null) addError(diagnostics, 'invalid_event_time', { index, value: source.t });
  const type = typeof source.type === 'string' && source.type ? source.type : null;
  if (!type) addError(diagnostics, 'invalid_event_type', { index, value: source.type });
  return {
    id: `event_${String(index + 1).padStart(4, '0')}`,
    index: index + 1,
    time,
    type,
    actorId: actorValue === null || actorValue === undefined ? null : String(actorValue),
    targetId: targetValue === null || targetValue === undefined ? null : String(targetValue),
    value: resolveValue(source, diagnostics, index),
    text: source.text === null || source.text === undefined ? '' : String(source.text),
    authority: true
  };
}

function snapshotNumber(snapshot, key, diagnostics, details) {
  const value = snapshot?.[key];
  if (value === undefined || value === null) return null;
  const number = strictNumber(value);
  if (number === null) addError(diagnostics, 'invalid_actor_number', { ...details, field: key, value });
  return number;
}

function snapshotIdentity(snapshot, side) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return {
    id: source.id === undefined ? null : source.id,
    realId: source.realId === undefined ? null : source.realId,
    side: source.side === undefined ? side : source.side,
    type: source.type === undefined ? null : source.type,
    category: source.category === undefined ? null : source.category,
    shape: source.shape === undefined ? null : source.shape,
    maxHp: source.maxHp === undefined ? null : source.maxHp
  };
}

function snapshotStats(snapshot) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return Object.fromEntries(STAT_FIELDS.map((key) => [key, source[key] === undefined ? null : source[key]]));
}

export function normalizeBattleActor(snapshot, side, index = 0, diagnostics = { errors: [], warnings: [] }) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const initial = source.initial && typeof source.initial === 'object' ? source.initial : source;
  const final = source.final && typeof source.final === 'object' ? source.final : source;
  const initialIdentity = snapshotIdentity(initial, side);
  const finalIdentity = snapshotIdentity(final, side);
  const id = nullableString(initialIdentity.id ?? finalIdentity.id);
  const initialMaxHp = snapshotNumber(initial, 'maxHp', diagnostics, { actorId: id, phase: 'initial' });
  const finalMaxHp = snapshotNumber(final, 'maxHp', diagnostics, { actorId: id, phase: 'final' });
  const category = nullableString(initialIdentity.category ?? finalIdentity.category);
  const type = nullableString(initialIdentity.type ?? finalIdentity.type);
  if (!id) addError(diagnostics, 'missing_actor_id', { side, index });
  if (!type || !category || !initialIdentity.shape || !finalIdentity.shape) addError(diagnostics, 'missing_actor_identity', { actorId: id, side });
  if (!KNOWN_CATEGORIES.has(category)) addWarning(diagnostics, 'unknown_actor_category', { actorId: id, category });
  const initialHp = snapshotNumber(initial, 'hp', diagnostics, { actorId: id, phase: 'initial' });
  const finalHp = snapshotNumber(final, 'hp', diagnostics, { actorId: id, phase: 'final' });
  if (typeof initial.alive !== 'boolean') addError(diagnostics, 'invalid_actor_alive', { actorId: id, phase: 'initial', value: initial.alive });
  if (typeof final.alive !== 'boolean') addError(diagnostics, 'invalid_actor_alive', { actorId: id, phase: 'final', value: final.alive });
  const statsInitial = Object.fromEntries(STAT_FIELDS.map((key) => [key, snapshotNumber(initial, key, diagnostics, { actorId: id, phase: 'initial' })]));
  const statsFinal = Object.fromEntries(STAT_FIELDS.map((key) => [key, snapshotNumber(final, key, diagnostics, { actorId: id, phase: 'final' })]));
  return {
    id,
    realId: nullableString(initialIdentity.realId ?? finalIdentity.realId),
    side: side || nullableString(initialIdentity.side ?? finalIdentity.side),
    type: type || 'unknown',
    name: nullableString(initial.name ?? final.name) || `未命名演员${index + 1}`,
    callsign: nullableString(initial.callsign ?? final.callsign),
    category: category || 'unknown',
    shape: nullableString(initialIdentity.shape ?? finalIdentity.shape) || 'unknown',
    initial: { hp: initialHp, maxHp: initialMaxHp, alive: typeof initial.alive === 'boolean' ? initial.alive : null },
    final: { hp: finalHp, maxHp: finalMaxHp, alive: typeof final.alive === 'boolean' ? final.alive : null },
    identitySnapshots: { initial: initialIdentity, final: finalIdentity },
    statSnapshots: { initial: statsInitial, final: statsFinal },
    stats: statsInitial,
    rank: { id: nullableString(initial.rankId ?? final.rankId), name: nullableString(initial.rankName ?? final.rankName), modifiers: cloneJson(initial.rankModifiers ?? final.rankModifiers) || {} }
  };
}

function addSnapshotArrayErrors(report, side, phase, rows, diagnostics) {
  if (!Array.isArray(rows)) { addError(diagnostics, 'missing_actor_snapshot_array', { side, phase }); return []; }
  const seen = new Set();
  rows.forEach((row, index) => {
    const id = row?.id;
    if (typeof id !== 'string' || !id.trim()) addError(diagnostics, 'missing_actor_id', { side, phase, index, actorId: id ?? null });
    if (seen.has(id)) addError(diagnostics, 'duplicate_actor_id', { side, phase, actorId: id });
    seen.add(id);
  });
  return rows;
}

function compareSnapshots(initial, final, side, diagnostics) {
  for (const field of IDENTITY_FIELDS) if (initial?.[field] !== final?.[field]) addError(diagnostics, 'actor_identity_changed', { actorId: initial?.id ?? final?.id ?? null, side, field, initial: initial?.[field] ?? null, final: final?.[field] ?? null });
  for (const field of STAT_FIELDS) if (initial?.[field] !== final?.[field]) addError(diagnostics, 'actor_stat_changed', { actorId: initial?.id ?? final?.id ?? null, side, field, initial: initial?.[field] ?? null, final: final?.[field] ?? null });
}

function normalizeActorSide(report, side, diagnostics) {
  const initialRows = addSnapshotArrayErrors(report, side, 'initial', report?.initial?.[side], diagnostics);
  const finalRows = addSnapshotArrayErrors(report, side, 'final', report?.final?.[side], diagnostics);
  const initial = new Map(); const final = new Map();
  initialRows.forEach((row) => { if (typeof row?.id === 'string' && !initial.has(row.id)) initial.set(row.id, row); });
  finalRows.forEach((row) => { if (typeof row?.id === 'string' && !final.has(row.id)) final.set(row.id, row); });
  for (const id of initial.keys()) if (!final.has(id)) addError(diagnostics, 'actor_missing_from_final', { side, actorId: id });
  for (const id of final.keys()) if (!initial.has(id)) addError(diagnostics, 'actor_missing_from_initial', { side, actorId: id });
  const ids = [...new Set([...initial.keys(), ...final.keys()])];
  ids.forEach((id) => { if (initial.has(id) && final.has(id)) compareSnapshots(initial.get(id), final.get(id), side, diagnostics); });
  return ids.map((id, index) => normalizeBattleActor({ ...(final.get(id) || {}), ...(initial.get(id) || {}), initial: initial.get(id) || {}, final: final.get(id) || {} }, side, index, diagnostics));
}

function normalizeMetadata(source, diagnostics) {
  const seed = strictNumber(source.seed); if (seed === null || !Number.isInteger(seed)) addError(diagnostics, 'invalid_battle_seed', { value: source.seed });
  const duration = strictNumber(source.duration); if (duration === null || duration <= 0) addError(diagnostics, 'invalid_battle_duration', { value: source.duration });
  const missionKind = source.missionKind === 'campaign' || source.missionKind === 'operation' ? source.missionKind : null;
  if (!missionKind) addError(diagnostics, 'invalid_mission_kind', { value: source.missionKind });
  for (const field of ['id', 'missionId', 'theaterId', 'strategyId', 'formationId', 'result']) if (typeof source[field] !== 'string' || !source[field]) addError(diagnostics, `invalid_battle_${field}`, { value: source[field] });
  return {
    id: typeof source.id === 'string' && source.id ? source.id : null,
    seed, missionKind, missionId: typeof source.missionId === 'string' && source.missionId ? source.missionId : null,
    theaterId: typeof source.theaterId === 'string' && source.theaterId ? source.theaterId : null,
    theaterName: nullableString(source.theaterName), terrain: nullableString(source.terrain),
    strategyId: typeof source.strategyId === 'string' && source.strategyId ? source.strategyId : null,
    strategyName: nullableString(source.strategyName), formationId: typeof source.formationId === 'string' && source.formationId ? source.formationId : null,
    formationName: nullableString(source.formationName), result: typeof source.result === 'string' ? source.result : null,
    capture: source.capture === true, duration
  };
}

export function normalizeBattleReport(report) {
  const source = report && typeof report === 'object' ? report : {};
  const normalization = { errors: [], warnings: [] };
  const friendly = normalizeActorSide(source, 'friendly', normalization);
  const enemy = normalizeActorSide(source, 'enemy', normalization);
  const events = (Array.isArray(source.events) ? source.events : []).map((event, index) => normalizeBattleEvent(event, index, normalization));
  if (!Array.isArray(source.events)) addError(normalization, 'missing_events_array');
  const allActors = [...friendly, ...enemy];
  return {
    schemaVersion: 1,
    normalization,
    battle: normalizeMetadata(source, normalization),
    actors: { friendly, enemy },
    events,
    outcome: {
      friendlyAliveIds: friendly.filter((actor) => actor.final.alive === true).map((actor) => actor.id),
      friendlyDestroyedIds: friendly.filter((actor) => actor.final.alive === false).map((actor) => actor.id),
      enemyAliveIds: enemy.filter((actor) => actor.final.alive === true).map((actor) => actor.id),
      enemyDestroyedIds: enemy.filter((actor) => actor.final.alive === false).map((actor) => actor.id),
      rewards: cloneJson(source.rewards) || {},
      losses: cloneJson(source.losses) || { friendly: [], enemy: [] }
    },
    warnings: [...normalization.warnings, ...allActors.filter((actor) => actor.category === 'unknown').map((actor) => ({ code: 'unknown_actor_category', actorId: actor.id }))]
  };
}
