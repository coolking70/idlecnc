import { buildEvidenceStateSignature } from '../../js/battle-presentation/universal/evidence-integrity.js';
import { evaluateProductionSemanticPredicate } from '../../js/battle-presentation/universal/production-semantic-predicates.js';

const STEP_SECONDS = .05;

function candidate(presentation, semanticName, seconds, viewportKind = 'default', sceneId = null) {
  const state = presentation.renderState.atTime(seconds);
  const predicate = evaluateProductionSemanticPredicate(semanticName, state);
  return { state, predicate, seconds, viewportKind, sceneId };
}

export function resolveDCSemanticFrame(presentation, semanticName, { viewportKind = 'default', stepSeconds = STEP_SECONDS, sceneId = presentation.plan.source?.reportId || null } = {}) {
  const duration = Number(presentation.plan.timeline.duration) || 0;
  let found = null;
  for (let index = 0; index <= Math.ceil(duration / stepSeconds) + 1; index += 1) {
    const seconds = Math.min(duration, Number((index * stepSeconds).toFixed(3)));
    const current = candidate(presentation, semanticName, seconds, viewportKind, sceneId);
    if (current.predicate.passed === true) { found = current; break; }
  }
  if (!found) return { semanticName, viewportKind, resolved: false, failClosed: true, unresolved: true, reason: 'predicate_not_found', candidateCount: 0 };
  const stateSignature = buildEvidenceStateSignature({ sceneId, seed: presentation.plan.source?.seed ?? 0, state: found.state, timeMs: found.seconds * 1000 });
  return {
    semanticName,
    predicateId: found.predicate.id,
    viewportKind,
    resolved: true,
    failClosed: true,
    unresolved: false,
    visualTimeSeconds: found.seconds,
    timeMs: Number((found.seconds * 1000).toFixed(3)),
    stateSignature,
    predicate: found.predicate,
    recomputedPredicate: evaluateProductionSemanticPredicate(semanticName, found.state),
    matchedActorIds: found.predicate.matchedActorIds,
    matchedShotIds: found.predicate.matchedShotIds,
    effectKinds: [...new Set((found.state.effects || []).map((effect) => effect.kind))].sort(),
    effectInventory: found.state.effectInventory || null,
    cameraFeedback: found.state.cameraFeedback || null,
    audioCues: found.state.audioCues || [],
    transitions: found.state.transitions || null
  };
}
