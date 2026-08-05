import { deepFreezeContract, normalizeBattleReport, stableStringify } from './report-normalizer.js';
import { validateAuthorityCoverage, validateNormalizedBattle } from './report-validator.js';
import { bindTacticalRoles } from './tactical-role-binder.js';
import { buildAuthorityAnchors } from './authority-anchor-builder.js';
import { CONTRACT_VERSION } from './schema.js';

const phaseWindows = {
  scout: { start: 0, end: 6 }, deploy: { start: 4, end: 10 }, contact: { start: 7, end: 20 },
  breakthrough: { start: 20, end: 29 }, resolve: { start: 28, end: 35 }
};

export function buildPresentationContract(report, options = {}) {
  const before = stableStringify(report);
  const normalizedBattle = normalizeBattleReport(report);
  const roleBinding = bindTacticalRoles(normalizedBattle);
  const authorityAnchors = buildAuthorityAnchors(normalizedBattle, roleBinding);
  const baseValidation = validateNormalizedBattle(normalizedBattle);
  const authorityCoverage = validateAuthorityCoverage(normalizedBattle, authorityAnchors);
  const errors = [...baseValidation.errors, ...authorityCoverage.errors];
  const friendly = normalizedBattle.actors.friendly;
  const enemy = normalizedBattle.actors.enemy;
  const infantry = (actor) => actor.category === 'infantry' || actor.category === 'at_infantry' || actor.type === 'at_infantry';
  const scoutVehicle = (actor) => actor.category === 'vehicle' && actor.stats.scouting > 0 && actor.type !== 'repair_vehicle';
  const armor = (actor) => actor.category === 'armor' || actor.type === 'mbt';
  const candidateRequirements = {
    friendlyInfantryCount: { actual: friendly.filter(infantry).length, required: 2 },
    friendlyScoutVehicleCount: { actual: friendly.filter(scoutVehicle).length, required: 1 },
    friendlyArmorCount: { actual: friendly.filter(armor).length, required: 1 },
    enemyInfantryCount: { actual: enemy.filter(infantry).length, required: 2 }
  };
  Object.values(candidateRequirements).forEach((requirement) => { requirement.passed = requirement.actual >= requirement.required; });
  const missingRequirements = Object.entries(candidateRequirements).filter(([, requirement]) => !requirement.passed).map(([name, requirement]) => `${name} requires ${requirement.required}, actual ${requirement.actual}`);
  const uncoveredEvents = normalizedBattle.events.filter((event) => !authorityAnchors.some((anchor) => anchor.sourceEventId === event.id)).map((event) => event.id);
  const conflictingEvents = errors.filter((error) => /conflict/i.test(error));
  const validation = {
    ok: errors.length === 0,
    errors,
    warnings: [...baseValidation.warnings, ...Object.values(roleBinding.missingRoles)],
    metrics: { ...baseValidation.metrics, ...authorityCoverage.metrics }
  };
  const contract = {
    contractVersion: CONTRACT_VERSION,
    normalizedBattle,
    validation,
    authorityCoverage,
    roleBinding,
    authorityAnchors,
    presentation: {
      templateId: null,
      presentationDuration: 35,
      sourceDuration: normalizedBattle.battle.duration,
      phaseWindows: options.phaseWindows || phaseWindows
    },
    diagnostics: {
      supported: validation.ok && missingRequirements.length === 0 && uncoveredEvents.length === 0,
      missingRequirements,
      missingRoles: roleBinding.missingRoles,
      uncoveredEvents,
      conflictingEvents,
      candidateRequirements
    }
  };
  if (stableStringify(report) !== before) throw new TypeError('buildPresentationContract mutated the source report');
  return deepFreezeContract(contract);
}
