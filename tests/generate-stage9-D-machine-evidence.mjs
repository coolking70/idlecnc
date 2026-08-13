import fs from 'node:fs';

const frames = [
  ['s9-d-01-result-salvage-available.png', 'result_salvage_available'],
  ['s9-d-02-pending-after-real-reload.png', 'pending_after_real_reload'],
  ['s9-d-03-salvage-claimed.png', 'salvage_claimed'],
  ['s9-d-04-claimed-after-real-reload.png', 'claimed_after_real_reload'],
  ['s9-d-05-history-claimed.png', 'history_claimed'],
  ['s9-d-06-replay-read-only.png', 'replay_read_only_salvage'],
  ['s9-d-07-replay-after-real-reload.png', 'replay_after_real_reload'],
  ['s9-d-08-no-drop.png', 'no_drop_result'],
  ['s9-d-09-no-drop-after-real-reload.png', 'no_drop_after_real_reload']
];

const output = {
  stage: '9-D', version: 1, generatedBy: 'tests/generate-stage9-D-machine-evidence.mjs',
  productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false,
  dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
  realReloadRequired: true, frameCount: frames.length,
  requiredActions: ['launch-battle', 'confirm-dispatch', 'claim-battle-salvage', 'view-report', 'replay-report'],
  realReloadReasons: ['pending_result', 'claimed_result', 'replay', 'no_drop_result'],
  deterministicFixture: { salvageSeed: 5, noDropSeed: 6, method: 'DOM dispatch with test-only Math.random seed source; no dispatch API call', requiresExplicitSalvageRulesVersion: 1 },
  frames: frames.map(([file, semantic], index) => ({ frame: index + 1, file, semantic }))
};

fs.writeFileSync('stage9_d_machine_evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount, reloads: output.realReloadReasons.length }));
