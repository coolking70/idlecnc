import { stableStringify } from '../core/report-normalizer.js';
import { buildUniversalPlanSafely } from './universal-plan-builder.js';
import { buildUniversalReportFingerprint } from './universal-plan-fingerprint.js';
import { createUniversalRenderState } from './universal-render-state.js';

function fail(code, reason, extra = {}) {
  return { ok: false, mode: 'legacy', code, reason, diagnostics: { supported: false, code, reason, ...extra } };
}

export function createUniversalBattlePresentation(activeBattle, options = {}) {
  const report = activeBattle?.report;
  if (!activeBattle || !report) return fail('missing_active_report', 'active battle report is unavailable');
  const before = stableStringify(report);
  const reportFingerprint = buildUniversalReportFingerprint(report);
  const plan = buildUniversalPlanSafely(report, { reportFingerprint });
  if (stableStringify(report) !== before) return fail('report_mutated', 'universal planner mutated the authoritative report');
  const errors = plan.validation?.errors || [];
  if (plan.ok !== true || plan.spatialValidation?.ok !== true || errors.length) {
    return fail('universal_plan_invalid', 'universal plan failed formal validation', {
      reportFingerprint,
      planErrors: errors,
      spatialErrors: plan.spatialValidation?.ok === false ? plan.spatialValidation.details || [] : []
    });
  }
  return {
    ok: true,
    mode: 'universal_battle',
    battleId: activeBattle.id || report.id,
    reportId: report.id,
    reportFingerprint,
    contract: plan.contract || null,
    plan,
    renderState: createUniversalRenderState({ plan }),
    diagnostics: {
      supported: true,
      planValid: true,
      spatialValid: plan.spatialValidation.ok,
      quality: plan.quality,
      result: plan.source.result,
      terrain: plan.scene.terrain.id,
      missionId: plan.source.missionId,
      actorCount: plan.authority.expectedEventCount ? plan.forces.profile.totalCount : plan.forces.profile.totalCount
    }
  };
}

