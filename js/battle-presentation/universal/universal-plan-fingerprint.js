import { stableStringify } from '../core/report-normalizer.js';
import { hashString } from './universal-plan-schema.js';

function sortedActors(rows = []) {
  return rows.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).map((actor) => ({
    id: actor.id, realId: actor.realId, side: actor.side, type: actor.type, category: actor.category,
    shape: actor.shape, initial: actor.initial, final: actor.final,
    identitySnapshots: actor.identitySnapshots, statSnapshots: actor.statSnapshots, stats: actor.stats, rank: actor.rank
  }));
}

export function buildUniversalReportFingerprint(contract) {
  const normalized = contract?.normalizedBattle || contract || {};
  const canonical = {
    battle: normalized.battle || {},
    actors: { friendly: sortedActors(normalized.actors?.friendly), enemy: sortedActors(normalized.actors?.enemy) },
    events: (normalized.events || []).map((event, index) => ({ index, id: event.id, time: event.time, type: event.type, actorId: event.actorId, targetId: event.targetId, value: event.value, authority: event.authority })),
    outcome: canonicalOutcome(normalized.outcome || {})
  };
  return `urf_${hashString(stableStringify(canonical))}`;
}

function canonicalOutcome(outcome) { const copy = JSON.parse(JSON.stringify(outcome)); for (const key of ['friendlyAliveIds', 'friendlyDestroyedIds', 'enemyAliveIds', 'enemyDestroyedIds']) if (Array.isArray(copy[key])) copy[key].sort(); return copy; }

export function buildUniversalPlanFingerprint(plan) {
  const { planFingerprint: _ignored, validation: _validation, ok: _ok, ...canonical } = plan || {};
  return `upf_${hashString(stableStringify(JSON.parse(JSON.stringify(canonical))))}`;
}
