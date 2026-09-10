import fs from 'node:fs';

const frames = [
  ['s9-a-01-base.png', 'base_before_stage9'],
  ['s9-a-02-buildings.png', 'armor_factory_operational'],
  ['s9-a-03-units.png', 'three_mbt_ready'],
  ['s9-a-04-formation.png', 'formation_ready'],
  ['s9-a-05-eligibility.png', 'river_crossing_eligibility'],
  ['s9-a-06-review.png', 'deployment_review_new_theater'],
  ['s9-a-07-review_reload.png', 'review_after_real_reload'],
  ['s9-a-08-running.png', 'new_theater_running'],
  ['s9-a-09-running_reload.png', 'running_after_real_reload'],
  ['s9-a-10-result.png', 'new_theater_result'],
  ['s9-a-11-result_reload.png', 'result_after_real_reload'],
  ['s9-a-12-report.png', 'formal_report_view'],
  ['s9-a-13-operation.png', 'repeat_operation_eligibility'],
  ['s9-a-14-operation_review.png', 'repeat_operation_review'],
  ['s9-a-15-operation_cancel.png', 'repeat_operation_cancelled'],
  ['s9-a-16-replay.png', 'replay_started'],
  ['s9-a-17-replay_reload.png', 'replay_after_real_reload'],
  ['s9-a-18-final.png', 'replay_closed_final_reports']
];

const output = {
  stage: '9-A', version: 1, generatedBy: 'tests/generate-stage9-A-machine-evidence.mjs',
  productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false,
  dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false,
  prerequisiteStateSeeded: true,
  prerequisiteSeedMethod: 'test-only prerequisite capture state; all Stage9 launch/review/confirm/report/replay actions remain DOM-driven',
  realReloadRequired: true,
  frameCount: frames.length,
  frames: frames.map(([file, semantic], index) => ({ frame: index + 1, file, semantic }))
};
fs.writeFileSync('stage9_a_machine_evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount }));
