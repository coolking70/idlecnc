import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { EQUIPMENT, EQUIPMENT_RULES, SALVAGE_RULES, SAVE_VERSION } from '../js/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const browser = read('stage9_d_browser_capture_manifest.json');
const machine = read('stage9_d_machine_evidence.json');
const core = read('stage9_d_core_machine_evidence.json');
const performance = fs.existsSync(path.join(root, 'stage9_d_performance_check.json')) ? read('stage9_d_performance_check.json') : null;
const bundle = {
  stage: '9-D', version: 1, generatedBy: 'tests/generate-stage9-D-evidence.mjs', saveVersion: SAVE_VERSION,
  salvageRules: SALVAGE_RULES, equipmentRules: EQUIPMENT_RULES, equipmentCatalog: Object.values(EQUIPMENT).map((def) => ({ id: def.id, applicableTypes: def.applicableTypes, modifiers: def.modifiers, acquisition: def.acquisition, requiresTech: def.requiresTech || null })),
  machine, browser, core, performance,
  environment: { platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown', cpuCount: os.cpus().length, nodeVersion: process.version },
  authority: { formalSettlementEquipmentUnchanged: core.formalSettlementEquipmentUnchanged === true, noBattleDropInSolver: core.noBattleDropInSolver === true, forbiddenAuthorityFilesChanged: core.forbiddenAuthorityFilesChanged || [] },
  independentRecompute: true
};
fs.writeFileSync(path.join(root, 'stage9_d_evidence_bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: bundle.stage, frames: browser.browser.captureCount, coreChecks: core.testCount, environment: bundle.environment }));
