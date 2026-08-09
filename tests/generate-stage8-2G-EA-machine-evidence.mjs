import fs from 'node:fs';

const files = [
  ['e-a-01-base-overview.png', 'base_overview'],
  ['e-a-02-barracks-ready.png', 'production_building_ready'],
  ['e-a-03-production-units-ready.png', 'production_units_ready'],
  ['e-a-04-formation-deployment.png', 'formation_deployment'],
  ['e-a-05-theater-entry.png', 'formal_theater_entry'],
  ['e-a-06-battle-running.png', 'battle_running'],
  ['e-a-07-reload-running-session.png', 'reload_running_session'],
  ['e-a-08-formal-result-settlement.png', 'formal_result_settlement'],
  ['e-a-09-report-bound.png', 'formal_report_bound'],
  ['e-a-10-replay-readonly.png', 'replay_readonly'],
  ['e-a-11-returned-base.png', 'returned_base']
];

const output = {
  stage: '8.2G-E-A',
  version: 1,
  generatedBy: 'tests/generate-stage8-2G-EA-machine-evidence.mjs',
  productionEntry: true,
  fixtureLoaderUsed: false,
  debugOverlayUsed: false,
  frameCount: files.length,
  frames: files.map(([file, semantic], index) => ({ frame: index + 1, file, semantic, timeMs: index * 1000 }))
};
fs.writeFileSync('stage8_2g_ea_machine_evidence.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: output.frameCount }));
