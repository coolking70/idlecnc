import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const run = spawnSync(process.execPath, [path.join(root, 'tests/generate-stage8-2G-DC-machine-evidence.mjs')], { cwd: root, stdio: 'inherit', encoding: 'utf8', timeout: 600_000 });
if (run.status !== 0) process.exit(run.status || 1);
const machine = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_dc_machine_evidence.json'), 'utf8'));
fs.writeFileSync(path.join(root, 'stage8_2g_dc1_machine_evidence.json'), `${JSON.stringify({ ...machine, stage: '8.2G-D-C.1', sourceStage: '8.2G-D-C', generatedBy: 'tests/generate-stage8-2G-DC1-machine-evidence.mjs', strongEvidence: { productionStateRecomputed: true, formalReportImportedAsReadOnly: true } }, null, 2)}\n`);
// D-C.1 的正式 120-sample performance evidence 由独立 qualified measurement 产生。
// 这里不得再用 D-C 的 8-sample legacy smoke check 覆盖它。
const performancePath = path.join(root, 'stage8_2g_dc1_performance_check.json');
if (!fs.existsSync(performancePath)) throw new Error('missing qualified D-C.1 performance evidence; run test:stage8-2G-D-C-1:performance first');
const performance = JSON.parse(fs.readFileSync(performancePath, 'utf8'));
if (Number(performance.version) < 2 || performance.measurementValid !== true || performance.formalMeasurementRuns !== 1) throw new Error('invalid qualified D-C.1 performance evidence');
const copied = ['effect_inventory', 'muzzle_effect_check', 'impact_effect_check', 'damage_visual_check', 'destruction_effect_check', 'wreck_effect_check', 'camera_feedback_check', 'transition_check', 'audio_cue_check', 'semantic_resolution', 'determinism_check', 'authority_check'];
for (const suffix of copied) {
  const sourcePath = path.join(root, `stage8_2g_dc_${suffix}.json`);
  if (!fs.existsSync(sourcePath)) continue;
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  fs.writeFileSync(path.join(root, `stage8_2g_dc1_${suffix}.json`), `${JSON.stringify({ ...source, stage: '8.2G-D-C.1', sourceStage: '8.2G-D-C', recomputedFromFormalState: true }, null, 2)}\n`);
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C.1', frameCount: machine.frameCount, sceneCount: machine.sceneCount }));
