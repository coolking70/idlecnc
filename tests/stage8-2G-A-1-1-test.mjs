/** Stage 8.2G-A.1.1 closure checks. Presentation-only; no authority mutation. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as cfg from '../js/config.js';
import * as stateApi from '../js/state.js';
import * as economy from '../js/economy.js';
import { simulateBattle } from '../js/battle.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { normalizeDebugOverlayOptions } from '../js/battle-presentation/universal/universal-debug-overlay.js';
import { deriveBattlePhases } from '../js/battle-presentation/universal/universal-battle-phase-resolver.js';
import { deploymentSemanticEnd, movementVisualState, VISUAL_STATES } from '../js/battle-presentation/universal/visual-state-machine.js';
import { footprintOverlapMetric, footprintSeparationThreshold, visualFootprint } from '../js/battle-presentation/universal/visual-footprints.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'tests/evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

function makePresentation() {
  const state = stateApi.createInitialState();
  const types = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'];
  state.units = types.map((type, index) => ({ id: `g-a11-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: 'g-a11', experience: 0, battles: 0 }));
  state.formations = [{ id: 'g-a11', name: 'A.1.1 混合编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((unit) => unit.id), experience: 0, battles: 0 }];
  economy.recalcDerived(state);
  const report = simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 1 });
  return { report, presentation: createUniversalBattlePresentation({ id: 'stage8-2G-A-1-1', theaterId: 'scrap_mine', report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' }) };
}

function loadPhaseFixtures() {
  const directory = path.join(root, 'tests/fixtures/battle-phases');
  return ['rapid-contact', 'long-approach', 'prolonged-engagement'].map((name) => JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8')));
}

function phaseById(phases, id) { return phases.find((phase) => phase.id === id); }

const rendererSource = fs.readFileSync(path.join(root, 'js/battle-presentation/universal/universal-battle-renderer.js'), 'utf8');
const overlaySource = fs.readFileSync(path.join(root, 'js/battle-presentation/universal/universal-debug-overlay.js'), 'utf8');
const stateMachineSource = fs.readFileSync(path.join(root, 'js/battle-presentation/universal/visual-state-machine.js'), 'utf8');
assert.doesNotMatch(rendererSource, /debug\s*=|style\.grid|drawDebugGrid|showGrid/);
assert.doesNotMatch(rendererSource, /draw(?:Routes|Zones)\s*\(/);
assert.match(overlaySource, /showGrid/);
assert.match(overlaySource, /for \(let x = 0; x <= 1280; x \+= 64\)/);
assert.equal(normalizeDebugOverlayOptions({ debugOverlay: false }).showGrid, false);
assert.equal(normalizeDebugOverlayOptions({ debugOverlay: true }).showGrid, true);

const fixtures = loadPhaseFixtures();
const fixturePhases = fixtures.map((fixture) => ({ fixture: fixture.fixture, phases: deriveBattlePhases(fixture) }));
const rapid = fixturePhases[0]; const long = fixturePhases[1]; const prolonged = fixturePhases[2];
assert.equal(new Set(fixtures.map((fixture) => JSON.stringify({ actors: fixture.forces, duration: fixture.timeline.duration, events: fixture.timeline.anchors.length }))).size, 3);
assert.ok(phaseById(rapid.phases, 'first_contact').start < phaseById(long.phases, 'first_contact').start);
assert.ok(phaseById(long.phases, 'approach').duration > phaseById(rapid.phases, 'approach').duration);
assert.ok(phaseById(prolonged.phases, 'main_engagement').duration > phaseById(long.phases, 'main_engagement').duration);
for (const { phases } of fixturePhases) {
  assert.deepEqual(phases.map((phase) => phase.id), ['deploy', 'approach', 'first_contact', 'main_engagement', 'critical_event', 'battle_end']);
  assert.deepEqual(phases, [...phases].sort((a, b) => a.start - b.start));
  for (const phase of phases) assert.ok(phase.duration >= 0 && phase.end >= phase.start);
  assert.ok(phaseById(phases, 'battle_end').start >= phases.at(-2).start);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, 'js/battle-presentation/universal/universal-battle-phase-resolver.js'), 'utf8'), /progress\s*[<>=].*0\./);

const semanticPlan = { timeline: { duration: 20, actions: [{ type: 'deploy', t: 0, actorIds: ['short'] }, { type: 'advance', t: 1.2, actorIds: ['short'] }] }, layout: { routes: [{ actorId: 'short', points: [{ t: 0, x: 0, y: 0 }, { t: .1, x: 50, y: 0 }], tactical: { staging: { x: 50, y: 0 } } }] } };
assert.equal(deploymentSemanticEnd(semanticPlan, 'short'), 1.2);
assert.equal(deploymentSemanticEnd({ timeline: { duration: 20, actions: [] }, layout: { routes: [{ actorId: 'static', points: [{ t: 0, x: 10, y: 10 }] }] } }, 'static'), 0);
assert.equal(movementVisualState({ seconds: 0, deploymentEnd: 4, current: { x: 0, y: 0 }, previous: { x: 0, y: 0 }, next: { x: 0, y: 0 } }), 'deploy');
assert.equal(movementVisualState({ seconds: 4, deploymentEnd: 4, current: { x: 20, y: 0 }, previous: { x: 10, y: 0 }, next: { x: 20, y: 0 } }), 'brake');
assert.doesNotMatch(stateMachineSource, /2\.8/);

const { report, presentation } = makePresentation();
assert.equal(presentation.ok, true, presentation.reason);
const plan = presentation.plan;
const phases = deriveBattlePhases(plan);
const phaseTimes = phases.slice(0, 5).map((phase) => ({ phase: phase.id, time: phase.end })).concat({ phase: 'battle_end', time: phases.at(-1).start });
const bounds = plan.layout.bounds;
const frames = [];
const maxOffset = (actor) => Math.hypot((actor.visualCenter?.x || 0) - (actor.anchorPosition?.x || 0), (actor.visualCenter?.y || 0) - (actor.anchorPosition?.y || 0));
for (const target of phaseTimes) {
  for (const delta of [-.1, 0, .1]) {
    const time = Math.max(0, Math.min(plan.timeline.duration, target.time + delta));
    const state = presentation.renderState.atTime(time);
    const repeat = presentation.renderState.atTime(time);
    assert.deepEqual(state.actors.map((actor) => ({ id: actor.id, x: actor.visualCenter.x, y: actor.visualCenter.y, visualState: actor.visualState })), repeat.actors.map((actor) => ({ id: actor.id, x: actor.visualCenter.x, y: actor.visualCenter.y, visualState: actor.visualState })));
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < state.actors.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < state.actors.length; rightIndex += 1) {
      const left = state.actors[leftIndex]; const right = state.actors[rightIndex];
      if (footprintOverlapMetric(left, right) < footprintSeparationThreshold(left, right)) overlaps.push({ type: 'actor_actor', left: left.id, right: right.id, metric: footprintOverlapMetric(left, right) });
    }
    const wreckOverlaps = [];
    for (const actor of state.actors.filter((item) => item.visible !== false)) for (const wreck of state.wrecks) {
      const wreckActor = { ...wreck, footprint: visualFootprint({ kind: 'wreck' }) };
      if (footprintOverlapMetric(actor, wreckActor) < .9) wreckOverlaps.push({ actorId: actor.id, wreckId: wreck.id });
    }
    const boundaryViolations = state.actors.filter((actor) => { const fp = actor.footprint || visualFootprint(actor); return actor.visualCenter.x - fp.halfWidth < -0.01 || actor.visualCenter.y - fp.halfHeight < -0.01 || actor.visualCenter.x + fp.halfWidth > bounds.width + .01 || actor.visualCenter.y + fp.halfHeight > bounds.height + .01; }).map((actor) => actor.id);
    const solidObstacleViolations = state.actors.flatMap((actor) => (plan.spatialEntities || []).filter((entity) => entity.kind === 'obstacle' && entity.solid !== false).filter((entity) => footprintOverlapMetric(actor, { ...entity, visualCenter: entity.position, footprint: entity.footprint }) < .9).map((entity) => ({ actorId: actor.id, obstacleId: entity.id })));
    const offsets = state.actors.map(maxOffset);
    frames.push({ phase: target.phase, timeMs: Math.round(time * 1000), actors: state.actors.map((actor) => ({ id: actor.id, state: actor.visualState, x: Number(actor.visualCenter.x.toFixed(3)), y: Number(actor.visualCenter.y.toFixed(3)) })), overlaps: [...overlaps, ...wreckOverlaps], obstacleViolations: solidObstacleViolations, boundaryViolations, maxVisualOffset: Number(Math.max(0, ...offsets).toFixed(3)), stable: true });
    assert.equal(overlaps.length, 0, `${target.phase} actor overlap: ${JSON.stringify(overlaps)}`);
    assert.equal(wreckOverlaps.length, 0, `${target.phase} wreck overlap: ${JSON.stringify(wreckOverlaps)}`);
    assert.equal(solidObstacleViolations.length, 0, `${target.phase} obstacle overlap: ${JSON.stringify(solidObstacleViolations)}`);
    assert.equal(boundaryViolations.length, 0, `${target.phase} boundary violation: ${JSON.stringify(boundaryViolations)}`);
    assert.ok(Math.max(0, ...offsets) <= 96, `${target.phase} visual offset too large`);
  }
}
const spatialEvidence = { stage: '8.2G-A.1.1', generatedAt: new Date().toISOString(), reportId: report.id, seed: report.seed, phasesChecked: [...new Set(frames.map((frame) => frame.phase))], minimumThresholds: { normalActors: .9, largeActors: .96, wrecks: .9 }, obstacleChecks: true, wreckChecks: true, jitterChecks: true, deterministic: true, frames };
fs.writeFileSync(path.join(evidenceDir, 'stage8_2g_a11_spatial_validation.json'), JSON.stringify(spatialEvidence, null, 2) + '\n');

const standalone = spawnSync(process.execPath, ['tests/stage8-2E-A-2-4-test.mjs'], { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
assert.equal(standalone.status, 0, `A.2.4 standalone failed or timed out: ${standalone.error?.message || standalone.stderr?.slice(-4000) || ''}`);
assert.match(`${standalone.stdout}\n${standalone.stderr}`, /stage8-2E-A-2-4-test: 39 passed \/ 39 total/);
console.log(`stage8-2G-A-1-1-test: closure checks passed; spatial frames=${frames.length}; fixtures=${fixtures.length}; historicalPid=37/37`);
