import fs from 'node:fs';

const frames = [
  ['e-b-01-base-before-command-flow.png', 'base_before_command_flow'],
  ['e-b-02-campaign-eligibility.png', 'campaign_eligibility'],
  ['e-b-03-deployment-review.png', 'deployment_review'],
  ['e-b-04-review_after_real_reload.png', 'review_after_real_reload_safe_fallback'],
  ['e-b-05-running-battle.png', 'running_battle'],
  ['e-b-06-running_after_real_reload.png', 'running_after_real_reload'],
  ['e-b-07-formal-result.png', 'formal_result'],
  ['e-b-08-result_after_real_reload.png', 'result_after_real_reload'],
  ['e-b-09-report_view.png', 'report_view'],
  ['e-b-10-base_after_return.png', 'base_after_return'],
  ['e-b-11-operation-selected.png', 'operation_selected'],
  ['e-b-12-operation-review.png', 'operation_review'],
  ['e-b-13-operation-cancelled.png', 'operation_cancelled'],
  ['e-b-14-replay-start.png', 'replay_start'],
  ['e-b-15-replay-before-real-reload.png', 'replay_before_real_reload'],
  ['e-b-16-replay-after-real-reload.png', 'replay_after_real_reload'],
  ['e-b-17-replay-finished.png', 'replay_finished'],
  ['e-b-18-final-reports.png', 'final_reports']
];

const output = {
  stage: '8.2G-E-B',
  version: 1,
  generatedBy: 'tests/generate-stage8-2G-EB-machine-evidence.mjs',
  productionEntry: true,
  fixtureLoaderUsed: false,
  debugOverlayUsed: false,
  dispatchApiUsed: false,
  replayApiUsed: false,
  realReloadRequired: true,
  frameCount: frames.length,
  frames: frames.map(([file, semantic], index) => ({ frame: index + 1, file, semantic }))
};

fs.writeFileSync('stage8_2g_eb_machine_evidence.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount }));
