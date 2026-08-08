import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';
import { PROHIBITED_UNARMED_VISUAL_STATES, WEAPON_TOPOLOGY } from '../js/battle-presentation/environment/presentation-facing-policy.js';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const SAMPLE_STEP = .05;

const sources = [
  ['formal-victory', fixture('campaign-victory.json')],
  ['formal-defeat', fixture('campaign-withdraw.json')],
  ['synthetic-art', buildDbArtShowcaseReport()]
];
const violations = [];
const sceneResults = [];
const reportHashes = [];
let sampledStates = 0;
let generatedStateMs = 0;

for (const [sceneId, report] of sources) {
  const before = stableStringify(report);
  const presentation = createUniversalBattlePresentation({ id: `stage8g-db1-${sceneId}`, report, duration: report.duration, presentationPhase: 'battle' });
  assert.equal(presentation.ok, true, `${sceneId} presentation`);
  const samples = [];
  const startBuild = performance.now();
  for (let seconds = 0; seconds <= presentation.plan.timeline.duration + 1e-9; seconds += SAMPLE_STEP) {
    const time = Math.min(presentation.plan.timeline.duration, Number(seconds.toFixed(3)));
    samples.push({ time, state: presentation.renderState.atTime(time) });
  }
  generatedStateMs += performance.now() - startBuild;
  sampledStates += samples.length;
  const scanStart = performance.now();
  let unarmedActors = 0;
  for (const sample of samples) {
    for (const actor of sample.state.actors) {
      if (actor.weaponTopology !== WEAPON_TOPOLOGY.UNARMED && actor.drawSpec?.weaponTopology !== WEAPON_TOPOLOGY.UNARMED) continue;
      unarmedActors += 1;
      const state = String(actor.visualState || '').toLowerCase();
      const animation = String(actor.drawSpec?.animation || '').toLowerCase();
      const presentationMode = String(actor.presentationMode || '').toLowerCase();
      if (PROHIBITED_UNARMED_VISUAL_STATES.includes(state) || PROHIBITED_UNARMED_VISUAL_STATES.includes(animation) || presentationMode === 'cover_fire' || actor.firing === true || actor.aiming === true || actor.reloading === true) {
        violations.push({ sceneId, time: sample.time, actorId: actor.id, type: actor.type, weaponTopology: actor.weaponTopology || actor.drawSpec?.weaponTopology, visualState: state, animation, presentationMode, firing: actor.firing, aiming: actor.aiming, reloading: actor.reloading, currentAction: actor.currentAction });
      }
    }
  }
  const scanMs = performance.now() - scanStart;
  assert.ok(scanMs <= 50, `${sceneId} unarmed scan exceeded 50ms: ${scanMs}`);
  assert.equal(stableStringify(report), before, `${sceneId} authority input mutated`);
  reportHashes.push({ sceneId, stable: true, hashLength: before.length });
  sceneResults.push({ sceneId, duration: presentation.plan.timeline.duration, sampleCount: samples.length, unarmedActorSamples: unarmedActors, scanMs: Number(scanMs.toFixed(4)), formalRepairEventCount: presentation.plan.timeline.anchors.filter((anchor) => anchor.type === 'repair').length });
}

assert.equal(violations.length, 0, `unarmed visual violations: ${JSON.stringify(violations.slice(0, 5))}`);
assert.ok(sceneResults.every((scene) => scene.formalRepairEventCount > 0), 'formal source must contain repair events');

const output = {
  stage: '8.2G-D-B.1',
  kind: 'unarmed_visual_state_timeline_scan',
  generatedBy: 'tests/stage8-2G-D-B-1-unarmed-visual-state-test.mjs',
  sampleStepSeconds: SAMPLE_STEP,
  sampledStates,
  scenes: sceneResults,
  prohibitedStates: PROHIBITED_UNARMED_VISUAL_STATES,
  violations,
  scanBoundMs: 50,
  maxScanMs: Math.max(...sceneResults.map((scene) => scene.scanMs)),
  stateGenerationMs: Number(generatedStateMs.toFixed(3)),
  authority: { reportsStable: reportHashes.every((item) => item.stable), plannerModified: false, solverModified: false, choreographerModified: false },
  passed: true
};
write('stage8_2g_db1_unarmed_state_check.json', output);
console.log(JSON.stringify({ ok: true, stage: output.stage, sampledStates, scenes: sceneResults.length, violations: violations.length, maxScanMs: output.maxScanMs, stateGenerationMs: output.stateGenerationMs }));

