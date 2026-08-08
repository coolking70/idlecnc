import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { isRepairCapableActor } from '../js/battle-presentation/universal/presentation-action-attribution.js';
import { WEAPON_TOPOLOGY } from '../js/battle-presentation/environment/presentation-facing-policy.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const sources = [
  ['formal-victory', fixture('campaign-victory.json')],
  ['formal-withdraw', fixture('campaign-withdraw.json')],
  ['synthetic-art', buildDbArtShowcaseReport()]
];
const SAMPLE_STEP = .05;
const scenes = [];
let totalUnexpectedRepairAnimations = 0;

for (const [sceneId, report] of sources) {
  const before = stableStringify(report);
  const presentation = createUniversalBattlePresentation({ id: `stage8g-db1a-${sceneId}`, report, duration: report.duration, presentationPhase: 'battle' });
  assert.equal(presentation.ok, true, `${sceneId} presentation`);
  const events = presentation.plan.timeline.anchors.filter((anchor) => anchor.type === 'repair');
  const unexpectedRepairAnimations = [];
  let samples = 0;
  for (let seconds = 0; seconds <= presentation.plan.timeline.duration + 1e-9; seconds += SAMPLE_STEP) {
    const time = Math.min(presentation.plan.timeline.duration, Number(seconds.toFixed(3)));
    const state = presentation.renderState.atTime(time); samples += 1;
    const activeEvents = state.formalRepairEvents.filter((event) => time >= Number(event.t) - 1e-6 && time <= Number(event.t) + .42 + 1e-6);
    const validSourceIds = new Set(activeEvents.filter((event) => event.sourceActorId && event.sourceActorId !== event.targetActorId).map((event) => event.sourceActorId));
    for (const actor of state.actors) {
      if (actor.drawSpec?.animation !== 'repair') continue;
      const valid = validSourceIds.has(actor.id) && actor.repairSource === true && actor.formalRepairSourceActive === true && actor.visualState === 'repair' && actor.visualStatus === 'repairing' && isRepairCapableActor(actor);
      if (!valid) unexpectedRepairAnimations.push({ time, actorId: actor.id, type: actor.type, animation: actor.drawSpec?.animation, visualState: actor.visualState, visualStatus: actor.visualStatus, repairSource: actor.repairSource });
    }
    for (const event of activeEvents) {
      assert.notEqual(event.sourceActorId, event.targetActorId, `${sceneId} source/target must differ`);
      const source = state.actors.find((actor) => actor.id === event.sourceActorId);
      const target = state.actors.find((actor) => actor.id === event.targetActorId);
      assert.ok(source && target, `${sceneId} source and target must exist`);
      assert.equal(isRepairCapableActor(source), true, `${sceneId} repair source capability`);
      assert.equal(source.visualState, 'repair');
      assert.equal(source.visualStatus, 'repairing');
      assert.equal(source.drawSpec?.animation, 'repair');
      assert.equal(target.repairTargeted, true);
      assert.notEqual(target.drawSpec?.animation, 'repair');
    }
  }
  totalUnexpectedRepairAnimations += unexpectedRepairAnimations.length;
  assert.deepEqual(unexpectedRepairAnimations, [], `${sceneId} unexpected repair animation: ${JSON.stringify(unexpectedRepairAnimations.slice(0, 4))}`);
  assert.equal(stableStringify(report), before, `${sceneId} authority input mutated`);
  scenes.push({ sceneId, repairEvents: events.length, samples, unexpectedRepairAnimations });
}

const output = {
  stage: '8.2G-D-B.1a',
  kind: 'repair_attribution_timeline_scan',
  sampleStepSeconds: SAMPLE_STEP,
  scenes,
  formalVictoryUnexpectedRepairAnimations: scenes.find((scene) => scene.sceneId === 'formal-victory')?.unexpectedRepairAnimations.length || 0,
  formalWithdrawUnexpectedRepairAnimations: scenes.find((scene) => scene.sceneId === 'formal-withdraw')?.unexpectedRepairAnimations.length || 0,
  syntheticUnexpectedRepairAnimations: scenes.find((scene) => scene.sceneId === 'synthetic-art')?.unexpectedRepairAnimations.length || 0,
  totalUnexpectedRepairAnimations,
  authority: { reportsStable: true, plannerModified: false, solverModified: false, repairAuthorityModified: false },
  passed: totalUnexpectedRepairAnimations === 0
};
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_repair_attribution_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: scenes.length, repairEvents: scenes.reduce((sum, scene) => sum + scene.repairEvents, 0), totalUnexpectedRepairAnimations }));
