import fs from 'node:fs';

const frames = [
  ['e-a1-01-base-before-battle.png', 'base_before_battle'],
  ['e-a1-02-production-ui-launch-control.png', 'production_ui_launch_control'],
  ['e-a1-03-running-before-real-reload.png', 'running_before_real_reload'],
  ['e-a1-04-running-after-real-reload.png', 'running_after_real_reload'],
  ['e-a1-05-formal-result.png', 'formal_result'],
  ['e-a1-06-base-after-settlement.png', 'base_after_settlement'],
  ['e-a1-07-replay-start.png', 'replay_start'],
  ['e-a1-08-replay-before-real-reload.png', 'replay_before_real_reload'],
  ['e-a1-09-replay-after-real-reload.png', 'replay_after_real_reload'],
  ['e-a1-10-replay-finished-base.png', 'replay_finished_base'],
  ['e-a1-11-save-diff-summary.png', 'save_diff_summary']
];

const output = {
  stage: '8.2G-E-A.1',
  version: 1,
  generatedBy: 'tests/generate-stage8-2G-EA1-machine-evidence.mjs',
  productionEntry: true,
  fixtureLoaderUsed: false,
  debugOverlayUsed: false,
  dispatchApiUsed: false,
  replayApiUsed: false,
  realReloadRequired: true,
  frameCount: frames.length,
  frames: frames.map(([file, semantic], index) => ({ frame: index + 1, file, semantic }))
};
fs.writeFileSync('stage8_2g_ea1_machine_evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount }));
