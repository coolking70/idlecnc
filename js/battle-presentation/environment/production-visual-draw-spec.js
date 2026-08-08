import { OFFLINE_ASSET_MANIFEST, resolveAsset, resolveEnvironmentAsset, resolveUnitAsset, resolveWreckAsset } from './asset-provider.js';
import { normalizeVisualUnitClass, visualUnitClassFamily } from './visual-unit-class.js';
import { resolveActorAnimationState, resolveMuzzleAnchor, resolveSpriteFrame } from './animation-resolver.js';
import { PRESENTATION_WORLD_HEIGHT, PRESENTATION_WORLD_WIDTH } from '../presentation-viewport.js';

export const MINIMUM_SCREEN_FOOTPRINT = Object.freeze({
  infantry: 24,
  anti_armor_infantry: 24,
  light_vehicle: 34,
  mbt: 46,
  support_vehicle: 34,
  unknown: 30
});
const MAX_VISUAL_SCALE_BOOST = 6;
const PROCEDURAL_WORLD_SIZE = Object.freeze({
  infantry: { width: 32, height: 38 },
  anti_armor_infantry: { width: 34, height: 40 },
  light_vehicle: { width: 44, height: 22 },
  mbt: { width: 60, height: 36 },
  support_vehicle: { width: 44, height: 22 },
  unknown: { width: 40, height: 24 }
});
const defaultViewport = Object.freeze({ width: PRESENTATION_WORLD_WIDTH, height: PRESENTATION_WORLD_HEIGHT, scale: 1 });

function sourceSet(manifest, availableSources) {
  return availableSources instanceof Set ? availableSources : new Set((manifest.assets || []).map((asset) => asset.source));
}

function normalizedViewport(viewport = {}) {
  return {
    width: Math.max(1, Number(viewport.width) || defaultViewport.width),
    height: Math.max(1, Number(viewport.height) || defaultViewport.height),
    scale: Math.max(.05, Number(viewport.scale) || 1)
  };
}

function normalizedBounds(bounds = {}) {
  return { width: Math.max(1, Number(bounds.width) || 1200), height: Math.max(1, Number(bounds.height) || 700) };
}

function roundMetric(value) { return Number(Number(value || 0).toFixed(4)); }

function resolvedWorldSize(resolved, visualClass) {
  return resolved?.worldSize ? { width: Number(resolved.worldSize.width), height: Number(resolved.worldSize.height), source: 'manifest.worldSize' }
    : { ...PROCEDURAL_WORLD_SIZE[visualClass], source: 'procedural.explicit-bounds' };
}

function logicalCenter(actor, bounds) {
  return {
    x: Number(actor?.visualCenter?.x || actor?.position?.x || 0) * PRESENTATION_WORLD_WIDTH / bounds.width,
    y: Number(actor?.visualCenter?.y || actor?.position?.y || 0) * PRESENTATION_WORLD_HEIGHT / bounds.height
  };
}

/**
 * Final production draw geometry.  This is the single source consumed by the
 * canvas renderer, browser evidence and machine/verifier evidence.  The
 * logical rectangle is the rectangle handed to drawImage/procedural drawing;
 * cssRect is that same rectangle after camera and viewport scale.
 */
export function buildActorFinalDrawGeometry({ actor, resolved, visualClass = normalizeVisualUnitClass(actor), camera = {}, battlefieldBounds = {}, viewport = defaultViewport, visualScaleBoost = null } = {}) {
  const bounds = normalizedBounds(battlefieldBounds);
  const view = normalizedViewport(viewport);
  const worldSize = resolvedWorldSize(resolved, visualClass);
  const worldToLogicalScale = Math.max(PRESENTATION_WORLD_WIDTH / bounds.width, PRESENTATION_WORLD_HEIGHT / bounds.height);
  const cameraZoom = Math.max(.1, Number(camera.zoom) || .86);
  const rawLogicalWidth = worldSize.width * worldToLogicalScale;
  const rawLogicalHeight = worldSize.height * worldToLogicalScale;
  const rawCssWidth = rawLogicalWidth * cameraZoom * view.scale;
  const rawCssHeight = rawLogicalHeight * cameraZoom * view.scale;
  const rawScreenFootprint = Math.max(rawCssWidth, rawCssHeight);
  const minimumScreenFootprint = MINIMUM_SCREEN_FOOTPRINT[visualClass] || MINIMUM_SCREEN_FOOTPRINT.unknown;
  const requestedBoost = visualScaleBoost == null ? minimumScreenFootprint / Math.max(1, rawScreenFootprint) : Number(visualScaleBoost) || 1;
  const boost = Math.min(MAX_VISUAL_SCALE_BOOST, Math.max(1, requestedBoost));
  const logicalCenterPoint = logicalCenter(actor, bounds);
  const logicalWidth = rawLogicalWidth * boost;
  const logicalHeight = rawLogicalHeight * boost;
  const finalCssWidth = rawCssWidth * boost;
  const finalCssHeight = rawCssHeight * boost;
  const finalDrawRect = {
    x: logicalCenterPoint.x - logicalWidth / 2,
    y: logicalCenterPoint.y - logicalHeight / 2,
    width: logicalWidth,
    height: logicalHeight
  };
  return {
    actorId: actor?.id || actor?.actorId || null,
    visualClass,
    rendererFamily: visualUnitClassFamily(visualClass),
    renderMode: resolved?.mode || 'procedural',
    assetId: resolved?.assetId || null,
    requestedAssetId: resolved?.requestedAssetId || resolved?.assetId || null,
    worldSize: { width: worldSize.width, height: worldSize.height, source: worldSize.source },
    logicalRect: { ...finalDrawRect },
    cssRect: {
      x: logicalCenterPoint.x * view.scale,
      y: logicalCenterPoint.y * view.scale,
      width: finalCssWidth,
      height: finalCssHeight
    },
    drawRect: { ...finalDrawRect },
    rawLogicalWidth: roundMetric(rawLogicalWidth),
    rawLogicalHeight: roundMetric(rawLogicalHeight),
    rawCssWidth: roundMetric(rawCssWidth),
    rawCssHeight: roundMetric(rawCssHeight),
    finalCssWidth: roundMetric(finalCssWidth),
    finalCssHeight: roundMetric(finalCssHeight),
    rawScreenFootprint: roundMetric(rawScreenFootprint),
    screenFootprint: roundMetric(Math.max(finalCssWidth, finalCssHeight)),
    minimumScreenFootprint,
    visualScaleBoost: roundMetric(boost),
    cameraZoom: roundMetric(cameraZoom),
    viewportScale: roundMetric(view.scale),
    metricSpace: 'final_css_pixels',
    rendererGeometrySource: 'production-final-draw-geometry'
  };
}

export function assetSpecForResolved(resolved, kind = 'actor') {
  const entry = resolved?.assetId ? (resolved.entry || (resolved.source ? resolved : null)) : null;
  return {
    assetId: resolved?.assetId || null,
    requestedAssetId: resolved?.requestedAssetId || resolved?.assetId || null,
    assetMode: resolved?.mode || 'procedural',
    renderMode: resolved?.mode || 'procedural',
    fallbackUsed: resolved?.fallback !== false,
    assetStatus: resolved?.status || (resolved?.fallback === false ? 'ready' : 'fallback'),
    assetSource: entry?.source || null,
    assetFormat: entry?.format || null,
    directions: entry?.directions || null,
    directionOrder: entry?.directionOrder || null,
    spritesheet: entry?.spritesheet || null,
    animations: entry?.animations || null,
    weaponMuzzleAnchor: entry?.weaponMuzzleAnchor || null,
    componentAssetIds: resolved?.componentAssetIds || entry?.components || null,
    worldSize: resolved?.worldSize || null,
    license: entry?.license || null,
    drawPath: resolved?.fallback === false ? 'drawImage' : 'procedural-fallback',
    faction: resolved?.side || null,
    factionVisualMode: resolved?.factionVisualMode || null,
    factionPalette: entry?.factionPalette || null,
    factionMark: entry?.factionMark || null,
    visualClass: resolved?.visualClass || null,
    resolutionReason: resolved?.reason || null,
    kind
  };
}

export function buildActorDrawSpec(actor, camera = {}, options = {}) {
  const manifest = options.manifest || OFFLINE_ASSET_MANIFEST;
  const sources = sourceSet(manifest, options.availableSources);
  const visualClass = normalizeVisualUnitClass(actor);
  const requestedMode = options.modeByType?.[visualClass] || (visualClass === 'mbt' ? 'hybrid' : ['infantry', 'anti_armor_infantry'].includes(visualClass) ? 'sprite' : 'procedural');
  const resolved = { ...resolveUnitAsset(actor, manifest, sources, requestedMode), visualClass };
  const animationState = resolveActorAnimationState(actor, actor?.visualState, options.presentationSeconds ?? actor?.presentationSeconds ?? 0, { entry: resolved.entry, seed: options.seed ?? actor?.seed ?? 0 });
  const spriteFrame = resolveSpriteFrame(resolved.entry, animationState);
  const turretEntry = resolved.componentAssetIds?.turretAssetId ? (manifest.assets || []).find((asset) => asset.id === resolved.componentAssetIds.turretAssetId) : null;
  const turretAnimationState = turretEntry ? resolveActorAnimationState({ ...actor, facing: actor?.turretFacing ?? actor?.facing }, actor?.visualState, options.presentationSeconds ?? actor?.presentationSeconds ?? 0, { entry: turretEntry, seed: options.seed ?? actor?.seed ?? 0 }) : null;
  const turretSpriteFrame = turretEntry ? resolveSpriteFrame(turretEntry, turretAnimationState) : null;
  const muzzleAnchor = resolveMuzzleAnchor(actor, resolved.entry, animationState.directionIndex);
  const geometry = buildActorFinalDrawGeometry({ actor, resolved, visualClass, camera, battlefieldBounds: options.battlefieldBounds, viewport: options.viewport, visualScaleBoost: options.visualScaleBoostByActor?.[actor?.id || actor?.actorId] });
  return {
    actorId: actor?.id || actor?.actorId || null,
    type: actor?.type || null,
    visualClass,
    ...geometry,
    ...assetSpecForResolved(resolved, 'actor'),
    animation: animationState.animation,
    animationState,
    spriteFrame,
    sourceRect: spriteFrame.sourceRect || null,
    turretAnimationState,
    turretSourceRect: turretSpriteFrame?.sourceRect || null,
    muzzleAnchor,
    finalDrawGeometry: geometry,
    weaponProfileId: actor?.weapon?.id || null,
    weaponPresentation: actor?.weaponPresentation || null,
    hybridComponents: resolved.mode === 'hybrid' && visualClass === 'mbt' ? ['sprite_hull', 'sprite_turret', 'procedural_selection', 'procedural_weapon_effects'] : []
  };
}

/** Compatibility name retained for historical tests; it delegates completely
 * to the production geometry and contains no second metric formula. */
export function buildActorScreenMetrics(args = {}) { return buildActorFinalDrawGeometry(args); }

export function buildWreckDrawSpec(wreck, options = {}) {
  const manifest = options.manifest || OFFLINE_ASSET_MANIFEST; const sources = sourceSet(manifest, options.availableSources);
  const resolved = resolveWreckAsset(wreck, manifest, sources); const animationState = resolveActorAnimationState({ ...wreck, id: wreck?.id || wreck?.sourceActorId, visualState: 'idle', facing: wreck?.angle || 0 }, 'idle', options.presentationSeconds ?? 0, { entry: resolved.entry, seed: wreck?.seed ?? 0 }); const spriteFrame = resolveSpriteFrame(resolved.entry, animationState);
  return { wreckId: wreck?.id || wreck?.sourceActorId || null, wreckType: wreck?.wreckType || 'unknown_wreck', side: wreck?.side || null, lastHullFacing: Number(wreck?.angle) || 0, ...assetSpecForResolved(resolved, 'wreck'), animationState, spriteFrame, sourceRect: spriteFrame.sourceRect || null };
}

export function buildEnvironmentDrawSpecs(environment, options = {}) {
  const manifest = options.manifest || OFFLINE_ASSET_MANIFEST; const sources = sourceSet(manifest, options.availableSources);
  return (environment?.objects || []).map((object) => ({ objectId: object.id, variant: object.variant, category: object.category, position: { ...object.position }, ...assetSpecForResolved(resolveEnvironmentAsset(object, manifest, sources, 'sprite'), 'environment') }));
}

export function buildProductionDrawSpecs({ actors = [], wrecks = [], environment, camera, options = {} } = {}) {
  const actorSpecs = actors.map((actor) => buildActorDrawSpec(actor, camera, options));
  const wreckSpecs = wrecks.map((wreck) => buildWreckDrawSpec(wreck, options));
  const environmentSpecs = buildEnvironmentDrawSpecs(environment, options);
  return {
    version: '8.2G-D-A-draw-spec-1',
    actorSpecs,
    wreckSpecs,
    environmentSpecs,
    assetCount: new Set([...actorSpecs, ...wreckSpecs, ...environmentSpecs].map((item) => item.assetId).filter(Boolean)).size,
    minimumScreenFootprint: { ...MINIMUM_SCREEN_FOOTPRINT },
    maxVisualScaleBoost: MAX_VISUAL_SCALE_BOOST,
    metricSpace: 'final_css_pixels',
    geometrySource: 'production-final-draw-geometry'
  };
}

export function productionAssetIds(manifest = OFFLINE_ASSET_MANIFEST) { return (manifest.assets || []).map((asset) => asset.id); }
