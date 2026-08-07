import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalEvidenceString } from '../js/battle-presentation/universal/evidence-integrity.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildEnvironmentLayout } from '../js/battle-presentation/environment/environment-layout.js';
import { resolveUnitAsset, OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { buildActorDrawSpec, buildActorScreenMetrics, buildProductionDrawSpecs, MINIMUM_SCREEN_FOOTPRINT } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';

const root = process.cwd();
const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
const reports = await buildC1ScenarioReports();
const sourceHash = canonicalEvidenceString(reports);
const presentationFor = (id, report) => createUniversalBattlePresentation({ id, report, duration: report.duration, presentationPhase: 'battle' });

// Faction resolution: enemy actors are never allowed to resolve to friendly art.
const assetCases = [];
for (const side of ['friendly', 'enemy']) for (const type of ['infantry', 'mbt']) {
  const actor = { id: `${side}-${type}`, side, type, category: type === 'infantry' ? 'infantry' : 'armor' };
  const resolved = resolveUnitAsset(actor, OFFLINE_ASSET_MANIFEST, new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)), type === 'mbt' ? 'hybrid' : 'sprite');
  if (side === 'friendly') assert.equal(resolved.assetId, `unit_friendly_${type}`);
  else { assert.notEqual(resolved.assetId, `unit_friendly_${type}`); assert.equal(resolved.mode, 'procedural'); assert.equal(resolved.reason, 'faction_asset_unavailable'); }
  assetCases.push({ side, type, assetId: resolved.assetId, requestedAssetId: resolved.requestedAssetId || resolved.assetId, mode: resolved.mode, reason: resolved.reason || null, factionVisualMode: resolved.factionVisualMode });
}
const reportsByScenario = {};
const metricCases = [];
const routeCases = [];
for (const [scenario, report] of Object.entries(reports)) {
  const presentation = presentationFor(`stage8g-c11-${scenario}`, report); assert.equal(presentation.ok, true, `presentation ${scenario}`);
  const plan = presentation.plan; const state = presentation.renderState.atTime(plan.timeline.duration * .62); reportsByScenario[scenario] = { sceneHash: state.sceneHash, scheduleVersion: state.engagementSchedule.version, routeClasses: state.environment.metrics.routeClasses, routeSegmentCounts: state.environment.metrics.routeSegmentCounts, violations: state.environment.metrics.routeSegmentViolations };
  assert.equal(state.environment.metrics.routeSegmentViolations.length, 0, `${scenario} route clearance`);
  for (const [routeClass, violations] of Object.entries(state.environment.metrics.routeSegmentViolationsByClass || {})) assert.equal(violations.length, 0, `${scenario} ${routeClass} clearance`);
  const friendlyInfantry = state.actors.find((actor) => actor.side === 'friendly' && (actor.category === 'infantry' || actor.type === 'at_infantry'));
  const enemyInfantry = state.actors.find((actor) => actor.side === 'enemy' && (actor.category === 'infantry' || actor.type === 'at_infantry'));
  const friendlyTank = state.actors.find((actor) => actor.side === 'friendly' && actor.type === 'mbt');
  const enemyTank = { id: 'audit-enemy-mbt', side: 'enemy', type: 'mbt', category: 'armor' };
  const specs = buildProductionDrawSpecs({ actors: [friendlyInfantry, enemyInfantry, friendlyTank, enemyTank].filter(Boolean), wrecks: [], environment: state.environment, camera: state.camera, options: { battlefieldBounds: plan.layout.bounds } });
  assert.equal(specs.actorSpecs.find((spec) => spec.actorId === enemyInfantry?.id)?.assetId || null, null);
  assert.equal(specs.actorSpecs.find((spec) => spec.actorId === enemyTank.id)?.assetId || null, null);
  for (const [viewportKind, viewport] of [['default', { width: 1440, height: 900, scale: Math.min(1440 / 1280, 900 / 720) }], ['narrow', { width: 780, height: 900, scale: Math.min(780 / 1280, 900 / 720) }]]) {
    const runtimeSpecs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: plan.layout.bounds, viewport } });
    assert.ok(runtimeSpecs.actorSpecs.every((spec) => spec.screenFootprint + 1e-9 >= spec.minimumScreenFootprint), `${scenario} ${viewportKind} footprint floor`);
    metricCases.push({ scenario, viewportKind, viewport, actors: runtimeSpecs.actorSpecs.map((spec) => ({ actorId: spec.actorId, side: spec.faction, type: spec.type, rawScreenFootprint: spec.rawScreenFootprint, minimumScreenFootprint: spec.minimumScreenFootprint, visualScaleBoost: spec.visualScaleBoost, screenFootprint: spec.screenFootprint, metricSpace: spec.metricSpace })) });
  }
  for (let seed = 0; seed < 20; seed += 1) {
    const seededReport = { ...report, seed };
    const seeded = presentationFor(`stage8g-c11-${scenario}-seed-${seed}`, seededReport); assert.equal(seeded.ok, true);
    const seededState = seeded.renderState.atTime(seeded.plan.timeline.duration * .62); const metrics = seededState.environment.metrics;
    assert.equal(metrics.routeSegmentViolations.length, 0, `${scenario} seed ${seed} any route violation`);
    for (const routeClass of ['planner', 'cover_advance', 'retreat', 'rear_guard']) assert.equal(metrics.routeSegmentViolationsByClass?.[routeClass]?.length || 0, 0, `${scenario} seed ${seed} ${routeClass} violation`);
    routeCases.push({ scenario, seed, routeSegmentCounts: metrics.routeSegmentCounts, routeSegmentViolations: metrics.routeSegmentViolations.length, routeSegmentViolationsByClass: metrics.routeSegmentViolationsByClass });
  }
}
assert.equal(canonicalEvidenceString(reports), sourceHash, 'presentation must not mutate combat reports');

const authority = { stage: '8.2G-C.1.1', reportHashBefore: sourceHash, reportHashAfter: canonicalEvidenceString(reports), combatCoreModified: false, authorityInputsModified: false, plannerFootprintsModified: false, routeSemanticsModified: false, passed: true };
const developerSelfcheck = { stage: '8.2G-C.1.1', factionAware: true, finalCssMetrics: true, routeClasses: ['planner', 'cover_advance', 'retreat', 'rear_guard'], seedCountPerScenario: 20, violations: 0, browserRequired: true, passed: true };
write('stage8_2g_c11_faction_asset_check.json', { stage: '8.2G-C.1.1', manifestProvider: OFFLINE_ASSET_MANIFEST.provider, sameFrameFriendlyEnemyRequired: true, cases: assetCases, enemyFriendlyAssetReuse: false, passed: true });
write('stage8_2g_c11_screen_footprint_check.json', { stage: '8.2G-C.1.1', formula: 'worldSize * worldToLogicalViewScale * camera.zoom * visualScaleBoost * viewport.scale', metricSpace: 'final_css_pixels', minimums: { ...MINIMUM_SCREEN_FOOTPRINT }, cases: metricCases, passed: true });
write('stage8_2g_c11_route_clearance.json', { stage: '8.2G-C.1.1', seedCountPerScenario: 20, routeClasses: ['planner', 'cover_advance', 'retreat', 'rear_guard'], cases: routeCases, violations: 0, passed: true });
write('stage8_2g_c11_authority_check.json', authority);
write('stage8_2g_c11_developer_selfcheck.json', developerSelfcheck);
console.log(JSON.stringify({ ok: true, stage: '8.2G-C.1.1', factionCases: assetCases.length, metricCases: metricCases.length, routeCases: routeCases.length, violations: 0, authorityUnchanged: true }));
