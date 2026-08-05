import { deepFreezeContract, normalizeBattleReport, stableStringify } from './core/report-normalizer.js';
import { validateAuthorityCoverage, validateNormalizedBattle } from './core/report-validator.js';
import { bindTacticalRoles } from './core/tactical-role-binder.js';
import { buildAuthorityAnchors } from './core/authority-anchor-builder.js';
import { CONTRACT_VERSION } from './core/schema.js';
import { buildVictoryPresentationPlan, validateContractDrivenPlan } from './core/contract-plan-builder.js';
import { createContractRenderState } from './contract-render-state.js';
import { CONTRACT_TEMPLATE_ID } from './contract-render-assets.js';

const PHASE_WINDOWS = Object.freeze({
  scout: Object.freeze({ start: 0, end: 6 }), deploy: Object.freeze({ start: 4, end: 10 }),
  contact: Object.freeze({ start: 7, end: 20 }), breakthrough: Object.freeze({ start: 20, end: 29 }),
  resolve: Object.freeze({ start: 28, end: 35 })
});

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
  const missingRequirements = Object.entries(candidateRequirements)
    .filter(([, requirement]) => !requirement.passed)
    .map(([name, requirement]) => `${name} requires ${requirement.required}, actual ${requirement.actual}`);
  const uncoveredEvents = normalizedBattle.events
    .filter((event) => !authorityAnchors.some((anchor) => anchor.sourceEventId === event.id))
    .map((event) => event.id);
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
      phaseWindows: options.phaseWindows || PHASE_WINDOWS
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

export function createContractBattlePresentation(activeBattle, options = {}) {
  const report = activeBattle?.report;
  const fail = (code, reason, extra = {}) => ({
    ok: false, mode: 'legacy', code, reason,
    diagnostics: { supported: false, code, reason, ...extra }
  });
  if (!activeBattle || !report) return fail('missing_active_report', 'active battle report is unavailable');
  if (activeBattle.theaterId !== 'border_road' || report.theaterId !== 'border_road') return fail('unsupported_theater', 'contract road presentation requires border_road');
  if (report.result !== 'victory') return fail('unsupported_result', 'contract road presentation requires a victory report');
  try {
    const contract = buildPresentationContract(report, options);
    if (contract.validation.ok !== true) return fail('invalid_contract', 'formal report contract validation failed', { contractErrors: contract.validation.errors });
    if (contract.diagnostics.supported !== true) return fail('unsupported_report', 'formal report does not satisfy the road template requirements', { missingRequirements: contract.diagnostics.missingRequirements, uncoveredEvents: contract.diagnostics.uncoveredEvents });
    const plan = buildVictoryPresentationPlan(contract, { sourceId: activeBattle.id || report.id, sourceKind: 'formal_runtime_report' });
    const planCheck = validateContractDrivenPlan(plan, contract);
    if (!plan.ok || !planCheck.ok || plan.templateId !== CONTRACT_TEMPLATE_ID) return fail('invalid_plan', 'contract presentation plan validation failed', { planErrors: [...(plan.validation?.errors || []), ...(planCheck.errors || [])] });
    return {
      ok: true,
      mode: 'contract_road_victory',
      battleId: activeBattle.id || report.id,
      reportId: report.id,
      contract,
      plan,
      renderState: createContractRenderState({ contract, plan }),
      diagnostics: { supported: true, contractValid: true, planValid: true, templateId: plan.templateId }
    };
  } catch (error) {
    return fail('adapter_error', error instanceof Error ? error.message : String(error));
  }
}
