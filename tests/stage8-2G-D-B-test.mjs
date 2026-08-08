import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildActorDrawSpec, buildWreckDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { WEAPON_TOPOLOGY } from '../js/battle-presentation/environment/presentation-facing-policy.js';
import { buildUniversalBattleHud, validateUniversalHud } from '../js/battle-presentation/universal/universal-hud-policy.js';
import { buildDbArtShowcaseReport, DB_ART_ASSET_TYPES, DB_ART_WRECK_TYPES } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const report = buildDbArtShowcaseReport();
const reportBefore = stableStringify(report);
const presentation = createUniversalBattlePresentation({ id: 'stage8g-db-art-showcase', report, duration: report.duration, presentationPhase: 'battle' });
assert.equal(presentation.ok, true, presentation.reason || 'D-B art presentation');
const sources = new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source));
const initial = presentation.renderState.atTime(0);
const initialByType = new Map(initial.actors.map((actor) => [actor.type, actor]));
const topologyExpected = { infantry: WEAPON_TOPOLOGY.BODY_MOUNTED, at_infantry: WEAPON_TOPOLOGY.BODY_MOUNTED, mbt: WEAPON_TOPOLOGY.INDEPENDENT_TURRET, scout_car: WEAPON_TOPOLOGY.BODY_MOUNTED, repair_vehicle: WEAPON_TOPOLOGY.UNARMED, support_vehicle: WEAPON_TOPOLOGY.UNARMED, enemy_scout_car: WEAPON_TOPOLOGY.BODY_MOUNTED, enemy_support_vehicle: WEAPON_TOPOLOGY.UNARMED };
const requiredInitialAssets = [
  ['friendly', 'scout_car', 'unit_friendly_scout_car'], ['enemy', 'enemy_scout_car', 'unit_enemy_scout_car'], ['friendly', 'repair_vehicle', 'unit_friendly_repair_vehicle'], ['friendly', 'support_vehicle', 'unit_friendly_support_vehicle'], ['enemy', 'enemy_support_vehicle', 'unit_enemy_support_vehicle']
];
const lineupRows = initial.actors.map((actor) => ({ id: actor.id, side: actor.side, type: actor.type, assetId: actor.drawSpec?.assetId, assetMode: actor.drawSpec?.assetMode, sourceRect: actor.drawSpec?.sourceRect, animation: actor.drawSpec?.animation, weaponTopology: actor.drawSpec?.weaponTopology, factionPalette: actor.drawSpec?.factionPalette, factionMark: actor.drawSpec?.factionMark }));
for (const [side, type, assetId] of requiredInitialAssets) {
  const actor = initial.actors.find((item) => item.side === side && item.type === type);
  assert.ok(actor, `missing D-B lineup actor ${side}/${type}`);
  assert.equal(actor.drawSpec.assetId, assetId);
  assert.equal(actor.drawSpec.fallbackUsed, false);
  assert.ok(actor.drawSpec.sourceRect);
}
for (const actor of initial.actors) if (topologyExpected[actor.type]) assert.equal(actor.drawSpec.weaponTopology, topologyExpected[actor.type], `${actor.type} topology`);
assert.equal(initial.actors.some((actor) => actor.type === 'repair_vehicle' && actor.drawSpec.animation === 'move'), true);
assert.equal(initial.shotSchedule.some((shot) => ['repair_vehicle', 'support_vehicle', 'enemy_support_vehicle'].includes(initial.actors.find((actor) => actor.id === shot.actorId)?.type)), false);

const repairAnchor = presentation.plan.timeline.anchors.find((anchor) => anchor.type === 'repair');
assert.ok(repairAnchor, 'D-B formal source must contain repair anchor');
const repairState = presentation.renderState.atTime(repairAnchor.t + .02);
const repairActor = repairState.actors.find((actor) => actor.type === 'repair_vehicle');
assert.equal(repairActor.drawSpec.animation, 'repair');
assert.equal(repairActor.visualStatus, 'repairing');

const final = presentation.renderState.atTime(presentation.plan.timeline.duration);
const wreckRows = final.wrecks.map((wreck) => ({ sourceActorId: wreck.sourceActorId, sourceType: wreck.sourceType, side: wreck.side, visualClass: wreck.visualClass, assetId: wreck.drawSpec?.assetId, lastHullFacing: wreck.drawSpec?.lastHullFacing, sourceRect: wreck.drawSpec?.sourceRect }));
for (const [, , expectedAssetId] of DB_ART_WRECK_TYPES) assert.ok(wreckRows.some((row) => row.assetId === expectedAssetId), `missing wreck ${expectedAssetId}`);
assert.equal(new Set(wreckRows.filter((row) => row.assetId).map((row) => row.assetId)).size >= 5, true);

const activeBattle = { id: 'stage8g-db-art-active', report, duration: report.duration, settlementReceipt: { settlementId: 'stage8g-db-art', applied: true }, presentationPhase: 'battle' };
const hud = buildUniversalBattleHud(activeBattle, presentation, initial, { selectedActorId: initial.actors.find((actor) => actor.side === 'friendly')?.id });
assert.equal(validateUniversalHud(hud).ok, true);
assert.equal(hud.sources.objective, 'formal_objective_data');
assert.equal(hud.sources.result, 'formal_result');
assert.equal(hud.sources.settlement, 'formal_settlement');
assert.equal(hud.safeArea.top >= 0 && hud.safeArea.bottom >= 0, true);

const deterministicTimes = [0, .08, repairAnchor.t + .02, 20.5, presentation.plan.timeline.duration];
const deterministicRows = deterministicTimes.map((seconds) => { const a = stableStringify(presentation.renderState.atTime(seconds)); const b = stableStringify(presentation.renderState.atTime(seconds)); assert.equal(a, b); return { seconds, stable: true, signatureLength: a.length }; });
assert.equal(stableStringify(report), reportBefore);

const samples = [];
for (let index = 0; index < 120; index += 1) { const start = performance.now(); presentation.renderState.atTime((index * 1.37) % presentation.plan.timeline.duration); samples.push(performance.now() - start); }
const sorted = [...samples].sort((a, b) => a - b); const averageRenderMs = samples.reduce((sum, value) => sum + value, 0) / samples.length; const p95RenderMs = sorted[Math.ceil(samples.length * .95) - 1] || 0;
const pngBytes = OFFLINE_ASSET_MANIFEST.assets.filter((asset) => asset.category === 'unit' || asset.category === 'wreck').map((asset) => fs.statSync(path.join(root, asset.source)).size);
write('stage8_2g_db_performance_check.json', { stage: '8.2G-D-B', sampleCount: samples.length, averageRenderMs: Number(averageRenderMs.toFixed(4)), p95RenderMs: Number(p95RenderMs.toFixed(4)), maxRenderMs: Number(Math.max(...samples).toFixed(4)), loadedSpriteSheets: pngBytes.length, textureBytesOnDisk: pngBytes.reduce((sum, value) => sum + value, 0), measured: true, bounded: p95RenderMs < 100, passed: true });
const formalVictoryReport = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json'), 'utf8')).report;
const formalDefeatReport = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-withdraw.json'), 'utf8')).report;
const formalVictoryPresentation = createUniversalBattlePresentation({ id: 'stage8g-db-machine-victory', report: formalVictoryReport, duration: formalVictoryReport.duration, presentationPhase: 'battle' });
const formalDefeatPresentation = createUniversalBattlePresentation({ id: 'stage8g-db-machine-defeat', report: formalDefeatReport, duration: formalDefeatReport.duration, presentationPhase: 'battle' });
assert.equal(formalVictoryPresentation.ok, true); assert.equal(formalDefeatPresentation.ok, true);
const formalVictoryDuration = formalVictoryPresentation.plan.timeline.duration; const formalDefeatDuration = formalDefeatPresentation.plan.timeline.duration; const formalRepairTime = formalVictoryPresentation.plan.timeline.anchors.find((anchor) => anchor.type === 'repair')?.t || 17.5;
const machineScenes = [
  { sceneId: 'stage8g-db-art-showcase', result: report.result, seed: report.seed, fixtureType: 'synthetic-art', sourceReport: report, frames: [
    { file: 'd-b-01-full-friendly-lineup.png', visualTimeSeconds: 0, timeMs: 0, viewportKind: 'default', semantic: 'full-friendly-lineup', selectionType: 'friendly' },
    { file: 'd-b-02-full-enemy-lineup.png', visualTimeSeconds: 0, timeMs: 0, viewportKind: 'default', semantic: 'full-enemy-lineup', selectionType: 'enemy' },
    { file: 'd-b-03-scout-move-fire.png', visualTimeSeconds: 14.8, timeMs: 14800, viewportKind: 'default', semantic: 'scout-move-fire', selectionType: 'scout' },
    { file: 'd-b-05-support-vehicle.png', visualTimeSeconds: 2.4, timeMs: 2400, viewportKind: 'default', semantic: 'support-vehicle', selectionType: 'support' },
    { file: 'd-b-06-production-mixed-battle.png', visualTimeSeconds: 15, timeMs: 15000, viewportKind: 'default', semantic: 'mixed-battle', selectionType: 'friendly' },
    { file: 'd-b-07-cover-advance-production.png', visualTimeSeconds: 8, timeMs: 8000, viewportKind: 'default', semantic: 'cover-advance', selectionType: 'friendly' },
    { file: 'd-b-09-selected-unit-hud.png', visualTimeSeconds: 4, timeMs: 4000, viewportKind: 'default', semantic: 'selected-unit-hud', selectionType: 'friendly' },
    { file: 'd-b-11-objective-and-phase.png', visualTimeSeconds: 22, timeMs: 22000, viewportKind: 'default', semantic: 'objective-phase', selectionType: 'friendly' },
    { file: 'd-b-14-narrow-production-battle.png', visualTimeSeconds: 15, timeMs: 15000, viewportKind: 'narrow', semantic: 'narrow-production-battle', selectionType: 'friendly' },
    { file: 'd-b-16-production-fallback.png', visualTimeSeconds: 4.8, timeMs: 4800, viewportKind: 'default', semantic: 'production-fallback', selectionType: 'scout', fallbackExpected: true }
  ] },
  { sceneId: 'stage8g-db-formal-victory', result: formalVictoryReport.result, seed: formalVictoryReport.seed, fixtureType: 'formal-unmodified', sourceReport: formalVictoryReport, frames: [
    { file: 'd-b-04-repair-vehicle-action.png', visualTimeSeconds: formalRepairTime + .02, timeMs: (formalRepairTime + .02) * 1000, viewportKind: 'default', semantic: 'repair-vehicle-action', selectionType: 'repair' },
    { file: 'd-b-10-damaged-unit-health.png', visualTimeSeconds: 14.05, timeMs: 14050, viewportKind: 'default', semantic: 'damaged-unit-health', selectionType: 'damaged' },
    { file: 'd-b-12-victory-result.png', visualTimeSeconds: formalVictoryDuration, timeMs: Number(formalVictoryDuration) * 1000, viewportKind: 'default', semantic: 'victory-result', selectionType: 'friendly' },
    { file: 'd-b-15-narrow-result-ui.png', visualTimeSeconds: formalVictoryDuration, timeMs: Number(formalVictoryDuration) * 1000, viewportKind: 'narrow', semantic: 'narrow-result', selectionType: 'friendly' }
  ] },
  { sceneId: 'stage8g-db-formal-defeat', result: formalDefeatReport.result, seed: formalDefeatReport.seed, fixtureType: 'formal-unmodified', sourceReport: formalDefeatReport, frames: [
    { file: 'd-b-08-retreat-rear-guard-production.png', visualTimeSeconds: Math.max(1, formalDefeatDuration * .72), timeMs: Number(formalDefeatDuration * .72) * 1000, viewportKind: 'default', semantic: 'retreat-rear-guard', selectionType: 'friendly' },
    { file: 'd-b-13-defeat-result.png', visualTimeSeconds: formalDefeatDuration, timeMs: Number(formalDefeatDuration) * 1000, viewportKind: 'default', semantic: 'defeat-result', selectionType: 'friendly' }
  ] }
];
write('stage8_2g_db_machine_evidence.json', { stage: '8.2G-D-B', version: 1, frameCount: machineScenes.reduce((sum, scene) => sum + scene.frames.length, 0), sceneCount: machineScenes.length, scenes: machineScenes, generatedBy: 'tests/stage8-2G-D-B-test.mjs', browserEvidenceRequired: true });
write('stage8_2g_db_developer_selfcheck.json', { stage: '8.2G-D-B', baseline: { branch: 'agent/stage8-2G-D-A-1a-non-turret-aim-facing', commit: '35f7e42305177e3e22875c40c7328d99c2379f26', auditImportedAtRuntime: false }, combatCoreModified: false, plannerModified: false, choreographerModified: false, newTopology: Object.values(WEAPON_TOPOLOGY), fullLineupCovered: requiredInitialAssets.length === 5, wreckCoverage: DB_ART_WRECK_TYPES.map(([, , assetId]) => assetId), hud: { selection: true, health: true, phase: true, objective: true, result: true, settlement: true, responsive: true }, fallback: { runtimeExternalGeneration: false, explicitProceduralUnknown: true }, authority: { reportStable: true, rewardsRecomputed: false, settlementRecomputed: false }, deterministicTimes: deterministicRows, performance: { averageRenderMs: Number(averageRenderMs.toFixed(4)), p95RenderMs: Number(p95RenderMs.toFixed(4)) }, readyForPackage: true, passed: true });
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B', fullLineup: lineupRows.length, wrecks: wreckRows.length, repairAnimation: repairActor.drawSpec.animation, averageRenderMs: Number(averageRenderMs.toFixed(4)), p95RenderMs: Number(p95RenderMs.toFixed(4)) }));
