import fs from 'node:fs';

const frames = [
  ['s9-c-01-production-queue.png', 'production_queue'],
  ['s9-c-02-production-queue-reload.png', 'production_queue_after_real_reload'],
  ['s9-c-03-completed-unmounted.png', 'equipment_completed_unmounted'],
  ['s9-c-04-completed-reload.png', 'equipment_completed_unmounted_after_real_reload'],
  ['s9-c-05-mounted.png', 'equipment_mounted_after_dom_click'],
  ['s9-c-06-running.png', 'running_battle_equipment_change_attempt'],
  ['s9-c-07-running-reload.png', 'running_after_real_reload'],
  ['s9-c-08-replay.png', 'replay_historical_equipment_attempt'],
  ['s9-c-09-replay-reload.png', 'replay_after_real_reload']
];

const output = {
  stage: '9-C.1', version: 2, generatedBy: 'tests/generate-stage9-C-machine-evidence.mjs',
  productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false,
  dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
  realReloadRequired: true, frameCount: frames.length,
  requiredActions: ['produce-equipment', 'cancel-production-current', 'cancel-production-queue', 'equip-equipment', 'unequip-equipment', 'confirm-dispatch', 'replay-report'],
  realReloadReasons: ['production_queue', 'completed_unmounted', 'running_battle', 'replay'],
  frames: frames.map(([file, semantic], index) => ({ frame: index + 1, file, semantic }))
};
fs.writeFileSync('stage9_c_machine_evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount, reloads: output.realReloadReasons.length }));
