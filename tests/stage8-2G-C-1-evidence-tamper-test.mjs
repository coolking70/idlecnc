import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd(); const verifier = path.join(root, 'tests/verify-stage8-2G-C-1-evidence.mjs'); const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-c1-tamper-')); const copy = (file) => fs.copyFileSync(path.join(root, file), path.join(tempRoot, file)); const machineFile = 'stage8_2g_c1_machine_semantic_evidence.json'; const browserFile = 'stage8_2g_c1_browser_capture_manifest.json';
fs.mkdirSync(path.join(tempRoot, 'screenshots/stage8-2G-C-1'), { recursive: true }); copy(machineFile); copy(browserFile); for (const file of fs.readdirSync(path.join(root, 'screenshots/stage8-2G-C-1'))) fs.copyFileSync(path.join(root, 'screenshots/stage8-2G-C-1', file), path.join(tempRoot, 'screenshots/stage8-2G-C-1', file));
const read = (file) => JSON.parse(fs.readFileSync(path.join(tempRoot, file), 'utf8')); const write = (file, value) => fs.writeFileSync(path.join(tempRoot, file), JSON.stringify(value, null, 2) + '\n'); const run = () => spawnSync(process.execPath, [verifier], { cwd: root, env: { ...process.env, IRON_COMMAND_EVIDENCE_ROOT: tempRoot }, encoding: 'utf8' }); const fresh = () => { copy(machineFile); copy(browserFile); };
const cases = [];
function mutation(label, mutate) { fresh(); const machine = read(machineFile); const browser = read(browserFile); mutate(machine, browser); write(machineFile, machine); browser.machineEvidenceSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(tempRoot, machineFile))).digest('hex'); write(browserFile, browser); const result = run(); cases.push({ label, rejected: result.status !== 0, output: `${result.stdout || ''}${result.stderr || ''}`.slice(-800) }); }
mutation('dual state signature', (machine, browser) => { machine.scenes[0].frames[0].stateSignature = 'same_fake'; browser.scenes[0].frames[0].c1StateSignature = 'same_fake'; });
mutation('dual environment signature', (machine, browser) => { machine.scenes[0].frames[0].environmentSignature = 'fake_environment'; browser.scenes[0].frames[0].browserEnvironmentSignature = 'fake_environment'; });
mutation('dual destruction signature', (machine, browser) => { machine.scenes[0].frames[0].destructionSignature = 'fake_destruction'; browser.scenes[0].frames[0].browserDestructionSignature = 'fake_destruction'; });
mutation('scene hash', (machine, browser) => { machine.scenes[0].frames[0].sceneHash = 'fake_scene'; browser.scenes[0].frames[0].sceneHash = 'fake_scene'; });
mutation('semantic predicate', (machine, browser) => { machine.scenes[0].frames[0].semanticPredicates.heavyImpactCrater = true; browser.scenes[0].frames[0].semanticPredicates.heavyImpactCrater = true; });
mutation('environment object', (machine, browser) => { machine.scenes[0].frames[0].environmentObjects.pop(); browser.scenes[0].frames[0].browserStateSnapshot.environment.objects.pop(); });
mutation('decal radius', (machine, browser) => { machine.scenes[0].frames[2].persistentDecals[0].radius += 11; browser.scenes[0].frames[2].browserStateSnapshot.destruction.decals[0].radius += 11; });
mutation('wrong png', (_machine, browser) => { browser.scenes[0].frames[0].imageSha256 = crypto.createHash('sha256').update('wrong').digest('hex'); });
const result = { ok: cases.every((item) => item.rejected), stage: '8.2G-C.1', mutationCases: cases.length, cases, dualTamperUpdatesBrowserBinding: true };
fs.writeFileSync(path.join(root, 'stage8_2g_c1_evidence_tamper_results.json'), JSON.stringify(result, null, 2) + '\n');
if (!result.ok) { console.error(JSON.stringify(result)); process.exitCode = 1; } else console.log(JSON.stringify(result));
fs.rmSync(tempRoot, { recursive: true, force: true });
