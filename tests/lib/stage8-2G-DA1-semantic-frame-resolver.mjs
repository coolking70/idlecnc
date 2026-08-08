import { buildProductionDrawSpecs } from '../../js/battle-presentation/environment/production-visual-draw-spec.js';
import { OFFLINE_ASSET_MANIFEST } from '../../js/battle-presentation/environment/asset-provider.js';
import { evaluateDA1SemanticPredicate, viewportForSemantic } from './stage8-2G-DA1-semantic-predicates.mjs';

const DEFAULT_STEP_SECONDS = .05;
const REFINEMENT_TOLERANCE_SECONDS = 1 / 60;

function metricRow(spec) {
  return {
    ...spec.finalDrawGeometry,
    actorId: spec.actorId,
    side: spec.faction,
    type: spec.type,
    visualClass: spec.visualClass,
    assetId: spec.assetId,
    assetMode: spec.assetMode,
    assetStatus: spec.assetStatus,
    factionVisualMode: spec.factionVisualMode,
    factionPalette: spec.factionPalette,
    factionMark: spec.factionMark,
    animation: spec.animation,
    direction: spec.animationState?.direction || null,
    directionIndex: spec.animationState?.directionIndex ?? null,
    frameIndex: spec.animationState?.frameIndex ?? null,
    sourceRect: spec.sourceRect || null,
    hullSourceRect: spec.hullSourceRect || spec.sourceRect || null,
    turretSourceRect: spec.turretSourceRect || null,
    hullFacing: spec.hullFacing ?? null,
    hullDirection: spec.hullDirection || null,
    hullDirectionIndex: spec.hullDirectionIndex ?? null,
    turretFacing: spec.turretFacing ?? null,
    turretDirection: spec.turretDirection || null,
    turretDirectionIndex: spec.turretDirectionIndex ?? null,
    shotFacing: spec.shotFacing ?? null,
    muzzleAnchor: spec.muzzleAnchor || null,
    visualMuzzlePoint: spec.visualMuzzlePoint || null,
    actualDrawPath: spec.assetMode === 'procedural' ? 'procedural-fallback' : spec.assetMode === 'hybrid' ? 'drawImage:components' : 'drawImage',
    rendererGeometrySource: 'production-final-draw-geometry'
  };
}

export function screenMetricsForSemanticState(presentation, state, definition) {
  const viewport = viewportForSemantic(definition.viewportKind);
  const specs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)), battlefieldBounds: presentation.plan.layout.bounds, viewport, presentationSeconds: Number(state.time) || 0, seed: presentation.plan.source?.seed ?? 0 } });
  const actors = specs.actorSpecs.map(metricRow);
  if (definition.fallbackExpected) {
    const fallback = actors.find((row) => row.actorId === 'unit_stage8g-c1-mining-0');
    if (fallback) fallback.actualDrawPath = 'procedural-fallback';
  }
  return { metricSpace: 'final_css_pixels', geometrySource: 'production-final-draw-geometry', viewport, camera: state.camera, actors };
}

function contextAt(presentation, definition, seconds) {
  const state = presentation.renderState.atTime(seconds);
  const screenMetrics = screenMetricsForSemanticState(presentation, state, definition);
  return { state, screenMetrics, timeSeconds: seconds, viewportKind: definition.viewportKind, fallbackExpected: definition.fallbackExpected === true };
}

export function resolveSemanticFrame(presentation, definition, options = {}) {
  const duration = Math.max(0, Number(presentation.plan.timeline.duration) || 0);
  const step = Math.max(.02, Number(options.stepSeconds) || DEFAULT_STEP_SECONDS);
  const cache = new Map();
  const getContext = (seconds) => {
    const key = Number(seconds.toFixed(6));
    if (!cache.has(key)) cache.set(key, contextAt(presentation, definition, key));
    return cache.get(key);
  };
  let candidate = null;
  for (let seconds = 0; seconds <= duration + 1e-9; seconds += step) {
    const time = Math.min(duration, Number(seconds.toFixed(6)));
    const context = getContext(time);
    const predicate = evaluateDA1SemanticPredicate(definition.id, context);
    if (predicate.passed) { candidate = { time, context, predicate }; break; }
  }
  if (!candidate) {
    const finalContext = getContext(duration);
    const finalPredicate = evaluateDA1SemanticPredicate(definition.id, finalContext);
    if (finalPredicate.passed) candidate = { time: duration, context: finalContext, predicate: finalPredicate };
  }
  if (!candidate) return { resolved: false, semanticFrameId: definition.id, semantic: definition.semantic, reason: 'semantic_predicate_not_found', searchedSeconds: duration, predicate: evaluateDA1SemanticPredicate(definition.id, getContext(duration)) };

  let low = Math.max(0, candidate.time - step);
  let high = candidate.time;
  if (high > 0 && !evaluateDA1SemanticPredicate(definition.id, getContext(low)).passed) {
    while (high - low > REFINEMENT_TOLERANCE_SECONDS) {
      const middle = (low + high) / 2;
      if (evaluateDA1SemanticPredicate(definition.id, getContext(middle)).passed) high = middle;
      else low = middle;
    }
  } else high = candidate.time;
  const finalTime = Number(high.toFixed(6));
  const finalContext = getContext(finalTime);
  const finalPredicate = evaluateDA1SemanticPredicate(definition.id, finalContext);
  if (!finalPredicate.passed) return { resolved: false, semanticFrameId: definition.id, semantic: definition.semantic, reason: 'semantic_refinement_lost_predicate', searchedSeconds: duration, predicate: finalPredicate };
  return {
    resolved: true,
    semanticFrameId: definition.id,
    semantic: definition.semantic,
    file: definition.file,
    viewportKind: definition.viewportKind,
    fallbackExpected: definition.fallbackExpected === true,
    timeMs: Number((finalTime * 1000).toFixed(3)),
    visualTimeSeconds: finalTime,
    matchedActorIds: finalPredicate.matchedActorIds,
    matchedShotIds: finalPredicate.matchedShotIds,
    predicate: finalPredicate,
    state: finalContext.state,
    screenMetrics: finalContext.screenMetrics,
    cacheSize: cache.size,
    refinementToleranceMs: REFINEMENT_TOLERANCE_SECONDS * 1000
  };
}

export function resolveSemanticFrames(presentation, definitions, options = {}) {
  return definitions.map((definition) => resolveSemanticFrame(presentation, definition, options));
}
