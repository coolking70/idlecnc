import { hashString, numberOr } from './universal-plan-schema.js';
import { getTerrainProfile } from './terrain-profile-registry.js';
import { resolveMissionProfile } from './mission-profile-registry.js';
import { resolveStrategyProfile } from './strategy-doctrine-registry.js';
import { resolveOutcomeProfile } from './outcome-profile-registry.js';

export function unwrapContract(input) { return input?.normalizedBattle ? input : { normalizedBattle: input }; }

export function buildBattleIntent(input) {
  const contract = unwrapContract(input);
  const normalized = contract.normalizedBattle || {};
  const battle = normalized.battle || {};
  const terrain = getTerrainProfile(battle.terrain) || { id: battle.terrain || 'generic', name: '通用地形', generic: true };
  const mission = resolveMissionProfile(battle);
  const strategy = resolveStrategyProfile(battle.strategyId);
  const outcome = resolveOutcomeProfile(battle.result);
  const events = normalized.events || [];
  const first = (type) => events.find((event) => event.type === type);
  const firstContact = events.find((event) => ['fire', 'damage', 'ambush'].includes(event.type));
  const firstFire = first('fire'); const firstDamage = first('damage');
  const friendly = normalized.actors?.friendly || [];
  const enemy = normalized.actors?.enemy || [];
  const ambush = events.some((event) => event.type === 'ambush');
  const sourceScout = contract.universalSource?.scout || normalized.battle?.scout || normalized.scout || null;
  const sourceTactics = contract.universalSource?.tactics || normalized.battle?.tactics || normalized.tactics || null;
  // The report's scout object is the authoritative source for these three
  // contact facts. Event text remains a fallback for older normalized inputs.
  const reveal = typeof sourceScout?.enemyRevealed === 'boolean' ? sourceScout.enemyRevealed : events.some((event) => event.type === 'reveal' && Number(event.value || 0) > 0);
  const revealHighThreat = typeof sourceScout?.revealHighThreat === 'boolean'
    ? sourceScout.revealHighThreat
    : Boolean(events.some((event) => event.type === 'reveal' && /高威胁|high/i.test(event.text || '')));
  const firstStrike = sourceScout?.firstStrike || (firstFire?.actorId && friendly.some((actor) => actor.id === firstFire.actorId) ? 'friendly' : firstFire ? 'enemy' : null);
  const hasRepair = events.some((event) => event.type === 'repair');
  const engagements = events.filter((event) => event.type === 'fire' && event.actorId && event.targetId).map((event, index) => ({ index, actorId: event.actorId, targetId: event.targetId, sourceTime: event.time }));
  const destructions = events.filter((event) => event.type === 'destroy' && event.targetId).map((event) => ({ actorId: event.actorId, targetId: event.targetId, sourceTime: event.time }));
  const tacticalDoctrine = sourceTactics && typeof sourceTactics === 'object'
    ? {
      id: sourceTactics.id || null,
      name: sourceTactics.name || null,
      combinedArms: sourceTactics.combinedArms === true,
      roles: sourceTactics.roles || {},
      commands: Array.isArray(sourceTactics.commands) ? sourceTactics.commands : [],
      metrics: sourceTactics.metrics || {}
    }
    : null;
  return {
    id: `intent_${hashString(`${battle.id || 'report'}:${battle.seed}`)}`,
    terrain: terrain.id, terrainName: terrain.name, missionKind: battle.missionKind, missionId: battle.missionId,
    mission, strategy, outcome,
    contact: {
      occurred: Boolean(firstContact), ambushed: ambush, enemyRevealed: reveal, revealHighThreat,
      firstStrike, firstContactTime: firstContact?.time ?? null, firstFireTime: firstFire?.time ?? null,
      firstDamageTime: firstDamage?.time ?? null,
      friendlyOpenedFire: Boolean(firstFire && friendly.some((actor) => actor.id === firstFire.actorId)),
      enemyOpenedFire: Boolean(firstFire && enemy.some((actor) => actor.id === firstFire.actorId))
    },
    hasRepair, engagements, destructions,
    forceCounts: { friendly: friendly.length, enemy: enemy.length, total: friendly.length + enemy.length },
    sourceDuration: numberOr(battle.duration), objective: { kind: mission.objectiveKind, label: mission.objectiveLabel, anchor: terrain.objectiveAnchor || 'center' },
    doctrine: {
      advance: strategy.advance, spacing: strategy.spacing, reserve: strategy.reserve, scoutBias: strategy.scoutBias,
      tacticalId: tacticalDoctrine?.id || null,
      tacticalName: tacticalDoctrine?.name || null,
      combinedArms: tacticalDoctrine?.combinedArms === true,
      tacticalRoles: tacticalDoctrine?.roles || {},
      tacticalCommands: tacticalDoctrine?.commands || [],
      tacticalMetrics: tacticalDoctrine?.metrics || {}
    }
  };
}
