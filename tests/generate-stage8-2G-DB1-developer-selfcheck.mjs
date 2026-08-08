import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const unarmed = read('stage8_2g_db1_unarmed_state_check.json');
const semantic = read('stage8_2g_db1_semantic_resolution.json');
const machine = read('stage8_2g_db1_machine_evidence.json');
const browser = read('stage8_2g_db1_browser_capture_manifest.json');
const responsive = read('stage8_2g_db1_responsive_geometry.json');
const leak = read('stage8_2g_db1_production_leak_check.json');
const tamper = read('stage8_2g_db1_tamper_results.json');
let workingTreeCommit = 'package-clean-verifier';
try { workingTreeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const selfcheck = {
  stage: '8.2G-D-B.1',
  kind: 'developer_self_check',
  baseline: { branch: 'agent/stage8-2G-D-B-full-unit-art-hud', commit: '61760937f2ce2db619e2b122b4e9c56f556a016b', auditImportedAtRuntime: false, auditUsedAsRegressionReference: true },
  scope: { solverModified: false, hpDamageRepairDestroyAuthorityModified: false, targetSelectionModified: false, shotScheduleModified: false, plannerModified: false, choreographerModified: false, resultRewardSettlementSaveModified: false, artAssetsAdded: false, hudPanelsAdded: false },
  implemented: ['presentation-only unarmed capability filter', 'formal repair visual anchor binding', 'production semantic predicate resolver', 'browser semantic recomputation and state-signature binding', 'battle-first responsive layout', 'production DOM leak fail-closed scan', 'D-B evidence semantic filename and timestamp correction'],
  unarmed: { scenes: unarmed.scenes, violations: unarmed.violations.length, maxScanMs: unarmed.maxScanMs, sampledStates: unarmed.sampledStates },
  semantic: { resolutionCount: semantic.resolutions.length, unresolved: semantic.unresolved, browserRecomputed: browser.semantic.browserRecomputed, stateSignaturesMatched: browser.semantic.stateSignaturesMatched, failClosed: semantic.failClosed },
  responsive: { viewport: responsive.viewport, passed: responsive.passed },
  productionLeak: { forbidden: leak.productionDomForbidden, debugOverlayPreserved: leak.debugOverlayPreserved, passed: leak.passed },
  browserEvidence: { frameCount: browser.browser.captureCount, uniquePngHashes: browser.browser.uniqueImageHashes, pageErrors: browser.browser.pageErrors, consoleErrors: browser.browser.consoleErrors },
  tamper: { cases: tamper.rejectionCount, rejected: tamper.cases.every((item) => item.rejected), passed: tamper.passed },
  evidenceFiles: ['stage8_2g_db1_unarmed_state_check.json', 'stage8_2g_db1_semantic_resolution.json', 'stage8_2g_db1_responsive_geometry.json', 'stage8_2g_db1_production_leak_check.json', 'stage8_2g_db1_machine_evidence.json', 'stage8_2g_db1_browser_capture_manifest.json', 'stage8_2g_db1_tamper_results.json'],
  generatedAt: new Date().toISOString(),
  workingTreeCommit,
  passed: unarmed.passed && semantic.passed && browser.passed && responsive.passed && leak.passed && tamper.passed && machine.frameCount === 10
};
fs.writeFileSync(path.join(root, 'stage8_2g_db1_developer_selfcheck.json'), `${JSON.stringify(selfcheck, null, 2)}\n`);
console.log(JSON.stringify({ ok: selfcheck.passed, stage: selfcheck.stage, frames: selfcheck.browserEvidence.frameCount, tamperCases: selfcheck.tamper.cases }));
