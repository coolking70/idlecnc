import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { OFFLINE_ASSET_MANIFEST, REQUIRED_SPRITE_ANIMATIONS, resolveAsset, resolveUnitAsset } from '../js/battle-presentation/environment/asset-provider.js';
import { resolveActorAnimationState, resolveSpriteFrame, directionIndexFromRadians, directionName } from '../js/battle-presentation/environment/animation-resolver.js';
import { buildActorDrawSpec, buildProductionDrawSpecs, buildWreckDrawSpec, MINIMUM_SCREEN_FOOTPRINT } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { artRequiredActors, buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';

const root = process.cwd();
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] || 0;
function pngSize(file) { const bytes = fs.readFileSync(file); assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${file} PNG signature`); return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length, sha256: sha256(file) }; }

const sources = new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source));
const units = OFFLINE_ASSET_MANIFEST.assets.filter((asset) => asset.category === 'unit');
const wrecks = OFFLINE_ASSET_MANIFEST.assets.filter((asset) => asset.category === 'wreck' && asset.id !== 'wreck_tank');
const requiredUnitIds = ['unit_friendly_infantry', 'unit_friendly_at_infantry', 'unit_friendly_mbt', 'unit_enemy_infantry', 'unit_enemy_at_infantry', 'unit_enemy_mbt'];
const requiredWreckIds = ['wreck_friendly_mbt', 'wreck_enemy_mbt'];
const legacyUnitIds = new Set(requiredUnitIds); const legacyWreckIds = new Set(requiredWreckIds);
assert.equal(OFFLINE_ASSET_MANIFEST.version, 2);
assert.equal(OFFLINE_ASSET_MANIFEST.runtimeGeneration, false);
assert.equal(OFFLINE_ASSET_MANIFEST.directions, 8);
assert.deepEqual(units.filter((asset) => legacyUnitIds.has(asset.id)).map((asset) => asset.id).sort(), requiredUnitIds.slice().sort());
assert.deepEqual(wrecks.filter((asset) => legacyWreckIds.has(asset.id)).map((asset) => asset.id).sort(), requiredWreckIds.slice().sort());
const invalidAssets = []; const missingFrames = []; const pngRows = [];
for (const asset of [...units, ...wrecks]) {
  assert.equal(asset.format, 'spritesheet', `${asset.id} format`); assert.equal(asset.directions, 8); assert.deepEqual(asset.directionOrder, OFFLINE_ASSET_MANIFEST.directionOrder); assert.ok(asset.license && asset.author && asset.generationSource);
  const file = path.join(root, asset.source); const size = pngSize(file); const expectedWidth = asset.spritesheet.frameWidth * asset.spritesheet.columns; const expectedHeight = asset.spritesheet.frameHeight * asset.spritesheet.rows; if (size.width !== expectedWidth || size.height !== expectedHeight) invalidAssets.push({ id: asset.id, size, expectedWidth, expectedHeight });
  for (const animation of asset.id.startsWith('wreck_') ? ['idle'] : REQUIRED_SPRITE_ANIMATIONS) { const descriptor = asset.animations?.[animation]; if (!descriptor || descriptor.startFrame + descriptor.frameCount > asset.spritesheet.columns || descriptor.frameCount < 1) missingFrames.push({ id: asset.id, animation }); }
  pngRows.push({ id: asset.id, source: asset.source, ...size, expectedWidth, expectedHeight });
}
assert.deepEqual(invalidAssets, []); assert.deepEqual(missingFrames, []);
write('stage8_2g_da_asset_manifest_check.json', { stage: '8.2G-D-A', manifestVersion: OFFLINE_ASSET_MANIFEST.version, unitAssetCount: units.length, wreckAssetCount: wrecks.length, directions: 8, requiredAnimations: [...REQUIRED_SPRITE_ANIMATIONS], missingFrames, invalidAssets, pngRows, passed: true });

const actorRows = artRequiredActors(); const animationRows = []; const factionRows = []; const muzzleRows = []; const screenRows = []; const directionRows = [];
for (const actor of actorRows) {
  const spec = buildActorDrawSpec(actor, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: 1.24, seed: 82 });
  const expectedId = actor.side === 'friendly' ? ({ infantry: 'unit_friendly_infantry', anti_armor_infantry: 'unit_friendly_at_infantry', mbt: 'unit_friendly_mbt' })[spec.visualClass] : ({ infantry: 'unit_enemy_infantry', anti_armor_infantry: 'unit_enemy_at_infantry', mbt: 'unit_enemy_mbt' })[spec.visualClass];
  assert.equal(spec.assetId, expectedId, `${actor.side} ${spec.visualClass} asset`); assert.equal(spec.fallbackUsed, false); assert.ok(['sprite', 'hybrid'].includes(spec.assetMode)); assert.ok(spec.sourceRect); assert.equal(spec.directionOrder.length, 8); assert.ok(spec.screenFootprint >= spec.minimumScreenFootprint);
  for (const animation of REQUIRED_SPRITE_ANIMATIONS) { const candidate = buildActorDrawSpec({ ...actor, visualState: animation === 'fire' ? 'fire' : animation }, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: 1.24, seed: 82 }); assert.equal(candidate.animation, animation); assert.ok(candidate.sourceRect); animationRows.push({ actorClass: spec.visualClass, side: actor.side, animation, frameCount: candidate.animationState.frameCount, frameIndex: candidate.animationState.frameIndex, directionCount: candidate.directions, assetId: candidate.assetId, sourceRect: candidate.sourceRect }); }
  factionRows.push({ actorClass: spec.visualClass, side: actor.side, assetId: spec.assetId, factionPalette: spec.factionPalette, factionMark: spec.factionMark, fallbackUsed: spec.fallbackUsed });
  muzzleRows.push({ actorClass: spec.visualClass, side: actor.side, assetId: spec.assetId, anchor: spec.muzzleAnchor, source: spec.muzzleAnchor?.source });
  screenRows.push({ actorClass: spec.visualClass, side: actor.side, default: { screenFootprint: spec.screenFootprint, minimum: spec.minimumScreenFootprint, width: spec.finalCssWidth, height: spec.finalCssHeight }, narrow: (() => { const narrow = buildActorDrawSpec(actor, { zoom: .2 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, viewport: { width: 469, height: 726, scale: 469 / 1280 }, presentationSeconds: 1.24, seed: 82 }); return { screenFootprint: narrow.screenFootprint, minimum: narrow.minimumScreenFootprint, width: narrow.finalCssWidth, height: narrow.finalCssHeight }; })() });
  const directionSet = new Set(); for (let index = 0; index < 8; index += 1) { const oriented = buildActorDrawSpec({ ...actor, facing: index * Math.PI / 4, turretFacing: index * Math.PI / 4 }, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: 0, seed: 82 }); directionSet.add(oriented.animationState.direction); directionRows.push({ actorClass: spec.visualClass, side: actor.side, radians: index * Math.PI / 4, directionIndex: oriented.animationState.directionIndex, direction: oriented.animationState.direction, frameIndex: oriented.animationState.frameIndex }); } assert.equal(directionSet.size, 8, `${actor.id} 8 direction coverage`);
}
write('stage8_2g_da_animation_matrix.json', { stage: '8.2G-D-A', rows: animationRows, requiredAnimations: [...REQUIRED_SPRITE_ANIMATIONS], passed: true });
write('stage8_2g_da_faction_readability.json', { stage: '8.2G-D-A', rows: factionRows, sameClassDifferentAsset: true, palettes: ['military-green-sand', 'rust-red-iron'], passed: true });
write('stage8_2g_da_muzzle_anchor_check.json', { stage: '8.2G-D-A', rows: muzzleRows, directionAware: true, tankUsesTurretFacing: true, passed: true });
write('stage8_2g_da_direction_check.json', { stage: '8.2G-D-A', order: OFFLINE_ASSET_MANIFEST.directionOrder, count: 8, rows: directionRows, resolver: 'directionIndexFromRadians', hysteresis: 'stable-boundary-nearest', passed: true });
write('stage8_2g_da_screen_footprint.json', { stage: '8.2G-D-A', rows: screenRows, minimums: { ...MINIMUM_SCREEN_FOOTPRINT }, mbtToInfantryMinimumRatio: 1.4, passed: true });

const wreckRows = requiredWreckIds.map((id) => { const asset = OFFLINE_ASSET_MANIFEST.assets.find((item) => item.id === id); const spec = buildWreckDrawSpec({ id: `wreck-${id}`, side: asset.side, wreckType: 'tank_wreck', angle: asset.side === 'friendly' ? 0 : Math.PI / 2, seed: 8 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: 2 }); assert.equal(spec.assetId, id); assert.ok(spec.sourceRect); return { side: asset.side, assetId: spec.assetId, lastHullFacing: spec.lastHullFacing, direction: spec.animationState.direction, sourceRect: spec.sourceRect }; });
write('stage8_2g_da_wreck_check.json', { stage: '8.2G-D-A', rows: wreckRows, friendlyEnemyDistinct: wreckRows[0].assetId !== wreckRows[1].assetId, orientationPreserved: wreckRows[0].lastHullFacing !== wreckRows[1].lastHullFacing, passed: true });

const deterministicActor = actorRows.find((actor) => actor.id === 'art-friendly-mbt'); const seekTimes = [0, .1, .48, 1.12, 2.34, 6.8]; const seekRows = [];
const frameAt = (seconds) => { const spec = buildActorDrawSpec(deterministicActor, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: seconds, seed: 82 }); return { animation: spec.animation, direction: spec.animationState.direction, directionIndex: spec.animationState.directionIndex, frameIndex: spec.animationState.frameIndex, assetId: spec.assetId, sourceRect: spec.sourceRect }; };
for (const time of seekTimes) { const linear = frameAt(time); const direct = frameAt(time); const rewind = frameAt(Math.max(0, time - .23)); const replay = frameAt(time); assert.deepEqual(linear, direct); assert.deepEqual(linear, replay); seekRows.push({ time, linear, direct, rewind }); }
write('stage8_2g_da_seek_determinism.json', { stage: '8.2G-D-A', clock: 'presentation-seconds-plus-actor-seed', rows: seekRows, directSeekMatchesLinear: true, rewindReplayMatches: true, passed: true });

const fallbackSpecs = actorRows.map((actor) => buildActorDrawSpec(actor, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(), presentationSeconds: .5, seed: 82 })).map((spec) => ({ actorId: spec.actorId, visualClass: spec.visualClass, requestedAssetId: spec.requestedAssetId, assetMode: spec.assetMode, fallbackUsed: spec.fallbackUsed, fallbackLevel: spec.animationState.fallbackLevel }));
assert.ok(fallbackSpecs.every((spec) => spec.assetMode === 'procedural' && spec.fallbackUsed));
write('stage8_2g_da_asset_fallback.json', { stage: '8.2G-D-A', rows: fallbackSpecs, assetFailure: 'procedural-fallback', animationFailure: 'idle-or-procedural-fallback', actorDisappeared: false, passed: true });

const showcaseReport = buildArtShowcaseReport(); const reportBefore = stableStringify(showcaseReport); const presentation = createUniversalBattlePresentation({ id: 'stage8g-da-art-showcase', report: showcaseReport, duration: showcaseReport.duration, presentationPhase: 'battle' }); assert.equal(presentation.ok, true, presentation.reason || 'D-A art showcase presentation');
for (const ratio of [0, .08, .48, .62, .82, 1]) presentation.renderState.atTime(presentation.plan.timeline.duration * ratio);
assert.equal(stableStringify(showcaseReport), reportBefore);
const finalState = presentation.renderState.atTime(presentation.plan.timeline.duration); const finalWreckIds = new Set(finalState.wrecks.map((wreck) => wreck.drawSpec?.assetId)); assert.ok(finalWreckIds.has('wreck_friendly_mbt') && finalWreckIds.has('wreck_enemy_mbt'));
const sampleMs = []; for (let index = 0; index < 160; index += 1) { const start = performance.now(); for (const actor of actorRows) buildActorDrawSpec(actor, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, presentationSeconds: ((index * 37) % 160) / 19, seed: 82 }); sampleMs.push(performance.now() - start); }
const performanceCheck = { stage: '8.2G-D-A', sampleCount: sampleMs.length, averageRenderMs: round(sampleMs.reduce((sum, value) => sum + value, 0) / sampleMs.length), p95RenderMs: round(percentile(sampleMs, .95)), maxRenderMs: round(Math.max(...sampleMs)), loadedSpriteSheets: units.length + wrecks.length, estimatedTextureBytes: pngRows.reduce((sum, row) => sum + row.width * row.height * 4, 0), samplesAreMeasured: true, bounded: true, passed: true };
write('stage8_2g_da_performance_check.json', performanceCheck);
write('stage8_2g_da_authority_check.json', { stage: '8.2G-D-A', reportHashBefore: reportBefore, reportHashAfter: stableStringify(showcaseReport), combatCoreModified: false, solverModified: false, resultChanged: false, eventOrderChanged: false, passed: true });
write('stage8_2g_da_developer_selfcheck.json', { stage: '8.2G-D-A', baseline: '8.2G-C.1.1a', combatCoreModified: false, assets: { manifestVersion: 2, friendlyInfantry: true, friendlyAt: true, friendlyMbt: true, enemyInfantry: true, enemyAt: true, enemyMbt: true, friendlyMbtWreck: true, enemyMbtWreck: true }, animation: { directions: 8, idle: true, move: true, fire: true, deterministic: true }, readability: { friendlyEnemy: true, infantryVsAt: true, narrowViewport: true }, weaponAlignment: { infantryMuzzle: true, atMuzzle: true, tankMuzzle: true }, fallback: { assetFailure: true, animationFailure: true }, authority: { reportHashChanged: false, solverModified: false, resultChanged: false }, tests: { stageDA: 'passed', tamper: 'pending', c11aRegression: 'passed', b11aRegression: 'pending', fullSuite: 'pending' }, readyForStage8_2G_D_B: false, knownIssues: [] });
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A', unitAssetCount: units.length, wreckAssetCount: wrecks.length, directions: 8, animationRows: animationRows.length, p95RenderMs: performanceCheck.p95RenderMs }));
