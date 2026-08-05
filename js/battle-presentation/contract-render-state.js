import { buildContractCaptureState, buildContractTextState } from './core/contract-capture-tools.js';
import { applyReturnChoreography } from './return-choreography.js';

export function createContractRenderState(presentation) {
  const { contract, plan } = presentation;
  return Object.freeze({
    battleId: plan.sourceId || plan.reportId,
    reportId: plan.reportId,
    atTime(seconds, runtime = {}) {
      const state = buildContractCaptureState(plan, contract, seconds);
      const implicitFinalProbe = Object.keys(runtime).length === 0 && Number(seconds) >= plan.duration;
      if (runtime.presentationPhase === 'returning' || runtime.returning === true || implicitFinalProbe) {
        const progress = Math.max(0, Math.min(1, Number(runtime.returnElapsed || 0) / Math.max(0.001, Number(runtime.returnDuration || 1))));
        applyReturnChoreography(state, progress, plan);
      }
      return state;
    },
    textAt(seconds, options = {}) {
      return buildContractTextState(plan, contract, this.atTime(seconds, options.runtime || {}), options.showHud !== false, options.debug === true, options.viewMode || 'overview');
    }
  });
}

export function renderStateAtPresentationTime(presentation, seconds, runtime = {}) {
  return createContractRenderState(presentation).atTime(seconds, runtime);
}
