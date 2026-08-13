import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SAVE_VERSION } from '../js/config.js';

const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/core-regression.yml', 'utf8');
const cnb = fs.readFileSync('.cnb.yml', 'utf8');
const save = fs.readFileSync('js/save.js', 'utf8');
const units = fs.readFileSync('js/units.js', 'utf8');
const theater = fs.readFileSync('js/theater.js', 'utf8');
const baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const committed = execFileSync('git', ['diff', '--name-only', `${baseline}..HEAD`], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const working = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const changed = [...new Set([...committed, ...working])].sort();
const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';
const browser = read('stage9_b_browser_capture_manifest.json');
const reload = read('stage9_b_real_reload_check.json');
const performance = read('stage9_b_performance_check.json');
const tamper = read('stage9_b_tamper_results.json');
const strong = read('stage9_b_strong_evidence_verdict.json');

const answers = [
  { id: 1, question: 'commit exists remotely', answer: 'pending until push', verified: false },
  { id: 2, question: 'clean clone overallPassed', answer: 'pending until final commit and remote clean-clone run', verified: false },
  { id: 3, question: 'equipment path', answer: 'getUnitEffectiveStats(unit, equipmentState) -> buildDispatchSnapshot stats', verified: units.includes('equipmentModifiersFor') && theater.includes('getUnitEffectiveStats(unit, state && state.equipment)') },
  { id: 4, question: 'hp/maxHp affected', answer: 'no; hp bypasses equipment and sanitizeUnit keeps base maxHp', verified: units.includes("if (key === 'hp')") && !fs.readFileSync('js/equipment.js', 'utf8').includes("'hp':") },
  { id: 5, question: 'sanitizeEquipment order', answer: 'after sanitizeUnits and before operations/theaters; both dangling directions are removed', verified: save.includes('const unitFix = sanitizeUnits(merged)') && save.includes('const equipmentFix = sanitizeEquipment(merged)') },
  { id: 6, question: 'migration', answer: `SAVE_VERSION=${SAVE_VERSION}; missing equipment uses emptyEquipmentState`, verified: SAVE_VERSION === 10 && save.includes('emptyEquipmentState()') },
  { id: 7, question: 'running hashes', answer: 'equipment mutation is battle_locked; browser and core evidence compare session/deployment/report hashes', verified: read('stage9_b_battle_isolation_check.json').running.deploymentHashUnchanged && read('stage9_b_battle_isolation_check.json').running.formalReportHashUnchanged },
  { id: 8, question: 'historical replay', answer: 'replay reads source.deploymentSnapshot, not current equipment', verified: read('stage9_b_replay_historical_check.json').replayAfterCurrentEquipmentChanged.usesHistoricalSnapshot },
  { id: 9, question: 'settlement equipment mutation', answer: 'settlement leaves equipment unchanged', verified: read('stage9_b_save_diff_check.json').settlementEquipmentUnchanged },
  { id: 10, question: 'save diff', answer: 'mount paths are equipment-only; battle/session/ledger/formations are forbidden', verified: read('stage9_b_save_diff_check.json').mountChangedPaths.every((path) => path.startsWith('equipment.')) },
  { id: 11, question: 'authority files', answer: 'solver/planner/choreographer/save-diff unchanged; theater snapshot boundary is the sanctioned production-side input; only perf-environment is allowed under tests/lib', verified: !changed.some((file) => ['js/battle.js', 'js/save-diff.js'].includes(file) || file.startsWith('js/battle-presentation/universal/') || (file.startsWith('tests/lib/') && file !== allowedPerformanceHelper)) },
  { id: 12, question: 'Stage 9-A values', answer: 'six theaters and six operations remain configured', verified: read('stage9_b_regression_check.json').theaterCount === 6 && read('stage9_b_regression_check.json').operationCount === 6 },
  { id: 13, question: 'UI authority', answer: 'UI calls authoritative getUnitEffectiveStats/canEquipEquipment and uses equipment render signature', verified: read('stage9_b_ui_path_check.json').sourceChecks.allRequiredDomProvenance },
  { id: 14, question: 'tamper passedFlagOnlyCases', answer: tamper.passedFlagOnlyCases, verified: tamper.passedFlagOnlyCases === 0 },
  { id: 15, question: 'Victory p95', answer: { effectiveStats: performance.scenarios.effectiveStats.p95Ms, snapshot: performance.scenarios.snapshot.p95Ms, budgetMs: performance.budgetMs }, verified: performance.scenarios.effectiveStats.p95Ms < 16.7 && performance.scenarios.snapshot.p95Ms < 16.7 },
  { id: 16, question: 'four gate locations', answer: 'package posttest/gate, .cnb full gate, workflow Stage9-B steps', verified: packageJson.scripts.posttest.includes('test:stage9-B') && packageJson.scripts['gate:stage8-2G'].includes('browser:stage9-B') && cnb.includes('npm run gate:stage8-2G') && workflow.includes('npm run test:stage9-B') && workflow.includes('npm run browser:stage9-B') }
];

const output = {
  stage: '9-B', generatedBy: 'tests/generate-stage9-B-developer-selfcheck.mjs',
  currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  statusPorcelain: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }),
  changedFiles: changed, answers,
  independentEvidence: { browser, reload, strong, tamper },
  passed: answers.slice(2).every((row) => row.verified) && strong.passed === true && tamper.passedFlagOnlyCases === 0
};
fs.writeFileSync('stage9_b_developer_selfcheck.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, answers: answers.length, passedFlagOnlyCases: tamper.passedFlagOnlyCases }));
