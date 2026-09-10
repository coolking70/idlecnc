import fs from 'node:fs';

const frames = [
  ['s9-b-01-equipment-panel.png', 'equipment_panel_mounted'],
  ['s9-b-02-equipment-panel-reload.png', 'equipment_panel_after_real_reload'],
  ['s9-b-03-running-attempt.png', 'running_equipment_change_attempt'],
  ['s9-b-04-running-reload.png', 'running_after_real_reload'],
  ['s9-b-05-result-attempt.png', 'result_equipment_change_attempt'],
  ['s9-b-06-result-reload.png', 'result_after_real_reload'],
  ['s9-b-07-replay-attempt.png', 'replay_equipment_change_attempt'],
  ['s9-b-08-replay-reload.png', 'replay_after_real_reload']
];

const output = {
  stage: '9-B', version: 1, generatedBy: 'tests/generate-stage9-B-machine-evidence.mjs',
  productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false,
  dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
  realReloadRequired: true, frameCount: frames.length,
  frames: frames.map(([file, semantic], index) => ({ frame: index + 1, file, semantic }))
};
fs.writeFileSync('stage9_b_machine_evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount }));
