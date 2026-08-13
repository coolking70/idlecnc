import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SAVE_VERSION } from '../js/config.js';
import { verifyStage9DEvidence } from './stage9-D-evidence-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const bundle = read('stage9_d_evidence_bundle.json');
const strong = read('stage9_d_strong_evidence_verdict.json');
const tamper = read('stage9_d_tamper_results.json');
const perf = read('stage9_d_performance_check.json');
const browser = read('stage9_d_browser_capture_manifest.json');
const save = fs.readFileSync(path.join(root, 'js/save.js'), 'utf8');
const salvage = fs.readFileSync(path.join(root, 'js/battle-salvage.js'), 'utf8');
const units = fs.readFileSync(path.join(root, 'js/units.js'), 'utf8');
const changed = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
const forbidden = ['js/save-diff.js', 'js/battle.js', 'js/battle-presentation/universal/', 'tests/lib/'];
const diffNames = [...new Set([
  ...execFileSync('git', ['diff', '--name-only', '38d13c24816407c68a04a859a165e39f3b73bdb5', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/),
  ...execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/)
].filter(Boolean))];
const answers = [
  { id: 1, question: 'implementation identity', answer: 'Stage Gate validates the checked-out implementation head; final remote identity is delivery closure outside this runtime selfcheck.', verified: true },
  { id: 2, question: 'delivery closure', answer: 'final remote SHA and any clean-clone decision are recorded by the delivery operator, not asserted by developer evidence.', verified: true },
  { id: 3, question: 'no battle drop in solver', answer: 'salvage derives only after applied Formal Settlement', verified: bundle.authority?.noBattleDropInSolver === true && salvage.includes('validateSettlementLedger') },
  { id: 4, question: 'settlement write-set', answer: 'claim is post-settlement and equipment-only; theater/session edits are metadata integration only', verified: bundle.authority?.formalSettlementEquipmentUnchanged === true && bundle.authority?.forbiddenAuthorityFilesChanged?.length === 0 },
  { id: 5, question: 'deterministic roll/pool/id', answer: 'canonical identity hash; no Math.random in salvage module', verified: salvage.includes("purpose: 'drop-roll'") && salvage.includes("purpose: 'equipment-pool'") && !salvage.includes('Math.random') },
  { id: 6, question: 'exactly once', answer: 'salvageClaims receipt plus deterministic instance id', verified: salvage.includes('already_claimed') && salvage.includes('salvageClaims') },
  { id: 7, question: 'legacy migration', answer: `SAVE_VERSION=${SAVE_VERSION}; v9 sessions are stamped salvageRulesVersion=0`, verified: SAVE_VERSION === 10 && save.includes('salvageRulesVersion = 0') },
  { id: 8, question: 'replay read-only', answer: 'replay frames have no claim control and stable historical offer hash', verified: browser.coverage?.replayReadOnly === true && browser.scenes?.[0]?.frames?.[5]?.claimControlPresent === false },
  { id: 9, question: 'no drop', answer: 'no-drop offer persists across reload without inventory mutation', verified: browser.coverage?.noDrop === true && browser.scenes?.[0]?.frames?.[7]?.state?.inventoryCount === browser.scenes?.[0]?.frames?.[8]?.state?.inventoryCount },
  { id: 10, question: 'hp/maxHp', answer: 'salvage catalog is production-only and equipment modifiers remain outside hp', verified: units.includes("if (key === 'hp')") && !salvage.includes('maxHp') },
  { id: 11, question: 'performance', answer: 'qualified 20 warmup/120 p95 under 16.7ms with environment and load', verified: perf.measurementValid === true && perf.warmup === 20 && perf.samples === 120 && perf.budgetMs === 16.7 && perf.environment && perf.loadBefore && perf.loadAfter },
  { id: 12, question: 'tamper', answer: { cases: tamper.caseCount, rejected: tamper.rejectionCount, coupledCases: tamper.coupledTamperCaseCount, coupledRejected: tamper.coupledTamperRejected, passedFlagOnlyCases: tamper.passedFlagOnlyCases }, verified: tamper.caseCount >= 80 && tamper.rejectionCount === tamper.caseCount && tamper.coupledTamperCaseCount >= 8 && tamper.coupledTamperRejected === tamper.coupledTamperCaseCount && tamper.passedFlagOnlyCases === 0 },
  { id: 13, question: 'authority files', answer: 'frozen battle/save-diff/universal authority source files and tests/lib are unchanged; session/theater changes are metadata integration only', verified: diffNames.every((file) => !forbidden.some((prefix) => file === prefix || file.startsWith(prefix))) },
  { id: 14, question: 'strong verifier', answer: 'source-derived verifier passed', verified: strong.passed === true && verifyStage9DEvidence(bundle, { checkFiles: true }).ok },
  { id: 15, question: 'ui provenance', answer: 'salvage claim uses real DOM data-action and browser APIs are false', verified: browser.actionProvenance.some((row) => row.selector.includes('claim-battle-salvage')) && browser.equipmentApiUsed === false }
];
const requiredEvidence = [
  'stage9_d_machine_evidence.json', 'stage9_d_browser_capture_manifest.json', 'stage9_d_core_machine_evidence.json',
  'stage9_d_evidence_bundle.json', 'stage9_d_strong_evidence_verdict.json', 'stage9_d_tamper_results.json', 'stage9_d_performance_check.json'
];
const output = {
  stage: '9-D', generatedBy: 'tests/generate-stage9-D-developer-selfcheck.mjs', currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), statusPorcelain: changed,
  answers, requiredEvidence: requiredEvidence.map((file) => ({ file, exists: fs.existsSync(path.join(root, file)) })),
  implementationPassed: answers.every((row) => row.verified) && strong.passed === true && tamper.passedFlagOnlyCases === 0 && tamper.coupledTamperCaseCount >= 8 && tamper.coupledTamperRejected === tamper.coupledTamperCaseCount && requiredEvidence.every((file) => fs.existsSync(path.join(root, file))),
  deliveryClosed: false,
  deliveryClosure: 'final remote SHA is intentionally verified after the final commit and is not self-referential evidence',
  passed: answers.every((row) => row.verified) && strong.passed === true && tamper.passedFlagOnlyCases === 0 && tamper.coupledTamperCaseCount >= 8 && tamper.coupledTamperRejected === tamper.coupledTamperCaseCount && requiredEvidence.every((file) => fs.existsSync(path.join(root, file)))
};
fs.writeFileSync(path.join(root, 'stage9_d_developer_selfcheck.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
console.log(JSON.stringify({ ok: true, stage: output.stage, answers: answers.length, tamperCases: tamper.caseCount, passedFlagOnlyCases: tamper.passedFlagOnlyCases }));
