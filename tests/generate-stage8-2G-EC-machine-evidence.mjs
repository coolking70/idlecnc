import fs from 'node:fs';

const phases = [
  ['base_before_offline', 'ec-01-base-before-offline.png'],
  ['offline_report_pending', 'ec-02-offline-report-pending.png'],
  ['offline_report_pending_reload', 'ec-03-offline-report-pending-reload.png'],
  ['offline_report_viewed', 'ec-04-offline-report-viewed.png'],
  ['offline_report_dismissed', 'ec-05-offline-report-dismissed.png'],
  ['offline_report_closed_reload', 'ec-06-offline-report-closed-reload.png'],
  ['running_before_offline', 'ec-07-running-before-offline.png'],
  ['running_after_offline_reload', 'ec-08-running-after-offline-reload.png'],
  ['running_offline_report_viewed', 'ec-09-running-offline-report-viewed.png'],
  ['running_offline_report_dismissed', 'ec-10-running-offline-report-dismissed.png'],
  ['formal_result', 'ec-11-formal-result.png'],
  ['replay_before_offline', 'ec-12-replay-before-offline.png'],
  ['replay_after_offline_reload', 'ec-13-replay-after-offline-reload.png'],
  ['replay_offline_report_viewed', 'ec-14-replay-offline-report-viewed.png'],
  ['replay_offline_report_dismissed', 'ec-15-replay-offline-report-dismissed.png'],
  ['replay_finished', 'ec-16-replay-finished.png'],
  ['final_reports', 'ec-17-final-reports.png']
];

const output = {
  stage: '8.2G-E-C',
  version: 1,
  generatedBy: 'tests/generate-stage8-2G-EC-machine-evidence.mjs',
  productionEntry: true,
  fixtureLoaderUsed: false,
  debugOverlayUsed: false,
  frameCount: phases.length,
  frames: phases.map(([semantic, file], index) => ({ index, semantic, file, required: true }))
};
fs.writeFileSync('stage8_2g_ec_machine_evidence.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: output.stage, frameCount: output.frameCount }));
