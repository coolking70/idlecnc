import { BATTLE_RESULTS, MISSION_KINDS } from './schema.js';
import { isCombatCapableUnit, validateOutcomeSnapshot } from '../../../js/battle-outcome.js';

const REQUIRED_EVENT_TYPES = new Set(['damage', 'suppress', 'repair', 'destroy', 'retreat', 'result']);
const REF_OPTIONAL_TYPES = new Set(['phase', 'reveal', 'ambush', 'retreat', 'result', 'move']);
const STAT_FIELDS = ['attack', 'antiArmor', 'defense', 'scouting', 'mobility', 'repair'];
const IDENTITY_FIELDS = ['id', 'realId', 'side', 'type', 'category', 'shape', 'maxHp'];

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function actorRows(normalized) { return [...(normalized?.actors?.friendly || []), ...(normalized?.actors?.enemy || [])]; }

export function isCombatCapableActor(actor, phase = 'final') {
  const snapshot = actor?.[phase];
  return isCombatCapableUnit({ attack: actor?.stats?.attack, alive: snapshot?.alive, hp: snapshot?.hp });
}

function actorIndex(normalized) {
  const index = new Map();
  const errors = [];
  for (const actor of actorRows(normalized)) {
    if (!actor.id) errors.push('actor id is required');
    if (index.has(actor.id)) errors.push(`duplicate actor id: ${actor.id}`);
    index.set(actor.id, actor);
  }
  return { index, errors };
}

function validateActor(actor, errors) {
  if (typeof actor.id !== 'string' || !actor.id) errors.push(`actor identity incomplete: ${actor.id || '(missing)'}`);
  if (!actor.type || !actor.name || !actor.category || !actor.shape) errors.push(`actor display identity incomplete: ${actor.id}`);
  if (!['friendly', 'enemy'].includes(actor.side)) errors.push(`invalid actor side: ${actor.id}`);
  if (!actor.identitySnapshots?.initial || !actor.identitySnapshots?.final) errors.push(`identity snapshots missing: ${actor.id}`);
  else for (const field of IDENTITY_FIELDS) if (actor.identitySnapshots.initial[field] !== actor.identitySnapshots.final[field]) errors.push(`actor identity changed: ${actor.id}.${field}`);
  if (!actor.statSnapshots?.initial || !actor.statSnapshots?.final) errors.push(`stat snapshots missing: ${actor.id}`);
  else for (const field of STAT_FIELDS) if (actor.statSnapshots.initial[field] !== actor.statSnapshots.final[field]) errors.push(`actor stat changed: ${actor.id}.${field}`);
  if (!finite(actor.initial.maxHp) || !finite(actor.final.maxHp) || actor.initial.maxHp <= 0) errors.push(`invalid maxHp: ${actor.id}`);
  if (actor.initial.maxHp !== actor.final.maxHp) errors.push(`maxHp changed: ${actor.id}`);
  for (const phase of ['initial', 'final']) {
    const hp = actor[phase].hp; const alive = actor[phase].alive;
    if (!finite(hp) || hp < 0 || hp > actor[phase].maxHp) errors.push(`invalid ${phase} hp: ${actor.id}`);
    if (typeof alive !== 'boolean') errors.push(`invalid ${phase} alive flag: ${actor.id}`);
    if (alive === true && !(hp > 0)) errors.push(`${phase} alive actor has no hp: ${actor.id}`);
    if (alive === false && hp !== 0) errors.push(`${phase} dead actor has hp: ${actor.id}`);
  }
  for (const key of STAT_FIELDS) if (!finite(actor.stats[key]) || actor.stats[key] < 0) errors.push(`invalid ${key}: ${actor.id}`);
  if (!actor.rank || typeof actor.rank.modifiers !== 'object') errors.push(`invalid rank: ${actor.id}`);
}

export function validateEventReferences(normalized) {
  const errors = [];
  const { index, errors: actorErrors } = actorIndex(normalized); errors.push(...actorErrors);
  const events = normalized?.events || []; const duration = normalized?.battle?.duration; let previousTime = -Infinity;
  events.forEach((event, i) => {
    if (!finite(event.time) || event.time < 0 || (finite(duration) && event.time > duration)) errors.push(`invalid event time: ${event.id}`);
    if (event.time < previousTime) errors.push(`event time moved backwards: ${event.id}`); previousTime = event.time;
    if (!event.type) errors.push(`event type missing: ${event.id}`);
    const actorRequired = ['fire', 'damage', 'suppress', 'repair'].includes(event.type);
    const targetRequired = ['fire', 'damage', 'suppress', 'repair', 'destroy'].includes(event.type);
    if (actorRequired && !event.actorId) errors.push(`${event.type} actor missing: ${event.id}`);
    if (targetRequired && !event.targetId) errors.push(`${event.type} target missing: ${event.id}`);
    if (!REF_OPTIONAL_TYPES.has(event.type) && !actorRequired && !targetRequired && !event.actorId && !event.targetId) errors.push(`event references missing: ${event.id}`);
    if (event.actorId && !index.has(event.actorId)) errors.push(`unknown event actor ${event.actorId}: ${event.id}`);
    if (event.targetId && !index.has(event.targetId)) errors.push(`unknown event target ${event.targetId}: ${event.id}`);
    if (['damage', 'repair'].includes(event.type) && !(event.value > 0)) errors.push(`${event.type} value must be positive: ${event.id}`);
    if (event.type === 'result' && i !== events.length - 1) errors.push(`result event is not last: ${event.id}`);
  });
  if (events.length === 0) errors.push('events are required');
  if (events.length > 0 && events[0].time !== 0) errors.push('first event must start at time zero');
  if (events.at(-1)?.type !== 'result') errors.push('last event must be result');
  if (events.at(-1)?.time >= duration && finite(duration)) errors.push('result event must precede battle duration');
  if (normalized?.battle?.result === 'withdraw' && !events.some((event) => event.type === 'retreat')) errors.push('withdraw report requires retreat event');
  return { ok: errors.length === 0, errors };
}

export function validateOutcomeConsistency(normalized) {
  const battle = normalized?.battle || {};
  const friendly = normalized?.actors?.friendly || []; const enemy = normalized?.actors?.enemy || [];
  const friendlyUnits = friendly.map((actor) => ({ attack: actor.stats.attack, alive: actor.final.alive, hp: actor.final.hp }));
  const enemyUnits = enemy.map((actor) => ({ attack: actor.stats.attack, alive: actor.final.alive, hp: actor.final.hp }));
  const outcome = validateOutcomeSnapshot({ friendly: friendlyUnits, enemy: enemyUnits, result: battle.result, missionKind: battle.missionKind, capture: battle.capture, rewards: normalized.outcome?.rewards, events: normalized.events });
  const friendlyCombat = friendly.filter((actor) => isCombatCapableActor(actor)); const enemyCombat = enemy.filter((actor) => isCombatCapableActor(actor));
  return { ok: outcome.ok, errors: outcome.problems, metrics: { friendlyCombat, enemyCombat, friendlyAlive: friendlyCombat.length, enemyAlive: enemyCombat.length } };
}

export function validateAuthorityCoverage(normalized, anchors = []) {
  const errors = []; const events = normalized?.events || []; const rows = Array.isArray(anchors) ? anchors : []; const bySource = new Map();
  rows.forEach((anchor) => bySource.set(anchor.sourceEventId, (bySource.get(anchor.sourceEventId) || 0) + 1));
  for (const event of events) {
    const count = bySource.get(event.id) || 0;
    if (count !== 1) errors.push(`authority source coverage ${event.id}: ${count}`);
    if (REQUIRED_EVENT_TYPES.has(event.type) && !rows.some((anchor) => anchor.sourceEventId === event.id && anchor.required)) errors.push(`required authority anchor missing: ${event.id}`);
    if (event.authority !== true) errors.push(`event is not authoritative: ${event.id}`);
  }
  return { ok: errors.length === 0, errors, metrics: { eventCount: events.length, anchorCount: rows.length, requiredEventCount: events.filter((event) => REQUIRED_EVENT_TYPES.has(event.type)).length } };
}

export function validateNormalizedBattle(normalized) {
  const errors = []; const warnings = [];
  for (const error of normalized?.normalization?.errors || []) errors.push(`${error.code}: ${error.actorId || error.field || error.value || ''}`.trim());
  for (const warning of normalized?.normalization?.warnings || []) warnings.push(warning);
  for (const warning of normalized?.warnings || []) warnings.push(warning);
  const friendlyIds = new Set((normalized?.actors?.friendly || []).map((actor) => actor.id)); const enemyIds = new Set((normalized?.actors?.enemy || []).map((actor) => actor.id));
  if (friendlyIds.size !== (normalized?.actors?.friendly || []).length) errors.push('duplicate friendly actor ids');
  if (enemyIds.size !== (normalized?.actors?.enemy || []).length) errors.push('duplicate enemy actor ids');
  for (const id of friendlyIds) if (enemyIds.has(id)) errors.push(`actor id appears on both sides: ${id}`);
  actorRows(normalized).forEach((actor) => validateActor(actor, errors));
  const battle = normalized?.battle || {};
  if (typeof battle.id !== 'string' || !battle.id) errors.push('battle.id must be a non-empty string');
  if (!finite(battle.seed) || !Number.isInteger(battle.seed)) errors.push('battle.seed must be a finite integer');
  if (!MISSION_KINDS.has(battle.missionKind)) errors.push('battle.missionKind must be campaign or operation');
  for (const field of ['missionId', 'theaterId', 'strategyId', 'formationId']) if (typeof battle[field] !== 'string' || !battle[field]) errors.push(`battle.${field} is required`);
  if (!BATTLE_RESULTS.has(battle.result)) errors.push(`battle.result is invalid: ${battle.result}`);
  if (typeof battle.capture !== 'boolean') errors.push('battle.capture must be boolean');
  if (!finite(battle.duration) || battle.duration <= 0) errors.push('battle.duration must be positive');
  const events = validateEventReferences(normalized); const outcome = validateOutcomeConsistency(normalized);
  errors.push(...events.errors, ...outcome.errors);
  return { ok: errors.length === 0, errors, warnings, metrics: { actorCount: actorRows(normalized).length, eventCount: normalized?.events?.length || 0, ...outcome.metrics } };
}
