import { buildEvidenceStateSignature } from '../../js/battle-presentation/universal/evidence-integrity.js';
import { evaluateProductionSemanticPredicate } from '../../js/battle-presentation/universal/production-semantic-predicates.js';

const STEP_SECONDS = .05;
const REFINEMENT_STEPS = 8;

function candidate(presentation, semanticName, seconds, viewportKind = 'default') {
  const state = presentation.renderState.atTime(seconds);
  const predicate = evaluateProductionSemanticPredicate(semanticName, state);
  return { state, predicate, seconds, viewportKind };
}

/**
 * Resolve a production semantic frame from the same render-state API used by
 * browser evidence.  The coarse scan is deterministic; the binary refinement
 * only narrows the first passing interval and never invents a passing state.
 */
export function resolveDB1SemanticFrame(presentation, semanticName, { viewportKind = 'default', stepSeconds = STEP_SECONDS, sceneId = presentation.plan.source?.reportId || null } = {}) {
  const duration = Number(presentation.plan.timeline.duration) || 0;
  let previous = candidate(presentation, semanticName, 0, viewportKind);
  let found = previous.predicate.passed ? previous : null;
  if (!found) {
    for (let seconds = stepSeconds; seconds <= duration + 1e-9; seconds += stepSeconds) {
      const current = candidate(presentation, semanticName, Math.min(duration, Number(seconds.toFixed(3))), viewportKind);
      if (current.predicate.passed) { found = current; break; }
      previous = current;
    }
  }
  if (!found) return { semanticName, viewportKind, resolved: false, failClosed: true, reason: 'predicate_not_found', unresolved: true, candidateCount: 0 };
  let low = Math.max(0, found.seconds - stepSeconds);
  let high = found.seconds;
  for (let index = 0; index < REFINEMENT_STEPS; index += 1) {
    const middle = Number(((low + high) / 2).toFixed(6));
    const refined = candidate(presentation, semanticName, middle, viewportKind);
    if (refined.predicate.passed) high = middle;
    else low = middle;
  }
  const final = candidate(presentation, semanticName, high, viewportKind);
  const recomputed = evaluateProductionSemanticPredicate(semanticName, final.state);
  const stateSignature = buildEvidenceStateSignature({ sceneId, seed: presentation.plan.source?.seed ?? 0, state: final.state, timeMs: final.seconds * 1000 });
  return {
    semanticName,
    predicateId: final.predicate.id,
    viewportKind,
    resolved: final.predicate.passed === true && recomputed.passed === true,
    failClosed: true,
    unresolved: false,
    visualTimeSeconds: Number(final.seconds.toFixed(6)),
    timeMs: Number((final.seconds * 1000).toFixed(3)),
    stateSignature,
    predicate: final.predicate,
    recomputedPredicate: recomputed,
    matchedActorIds: final.predicate.matchedActorIds,
    matchedShotIds: final.predicate.matchedShotIds
  };
}

export { STEP_SECONDS as DB1_SEMANTIC_STEP_SECONDS };
