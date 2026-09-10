import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SAVE_VERSION } from '../js/config.js';
import { STAGE9_ACCEPTED_BASE, readStage9FrozenAuthorityStatus } from './lib/stage9-frozen-authority.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const baseSha = STAGE9_ACCEPTED_BASE;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const stateEquivalence = JSON.parse(read('evidence/stage10-P-A/stage10-P-A-state-equivalence.json'));
const browser = JSON.parse(read('evidence/stage10-P-A/stage10-P-A-browser.json'));
const gitHead = git('rev-parse', 'HEAD');

// Runtime gate records are produced by tests/record-stage10-P-A-runtime-gate.mjs
// while the real gate commands execute. Machine evidence may only claim a
// regression passed when this run actually recorded a passing gate at the
// current HEAD; anything else fails closed instead of hardcoding true.
const RUNTIME_GATE_FILE = 'evidence/stage10-P-A/stage10-P-A-runtime-gates.json';
const REQUIRED_RUNTIME_GATES = [
  'historical-core-regression',
  'stage9-relevant-regression',
  'stage10-focused-tests',
  'stage10-browser'
];
const runtimeGateStatus = (() => {
  const status = { file: RUNTIME_GATE_FILE, headSha: null, currentHead: gitHead, boundToHead: false, recorded: [], missing: REQUIRED_RUNTIME_GATES.slice(), gates: {} };
  try {
    const parsed = JSON.parse(read(RUNTIME_GATE_FILE));
    status.headSha = parsed?.headSha || null;
    status.gates = parsed?.gates && typeof parsed.gates === 'object' ? parsed.gates : {};
    status.recorded = Object.keys(status.gates);
  } catch {
    status.gates = {};
  }
  status.boundToHead = status.headSha === gitHead;
  status.missing = REQUIRED_RUNTIME_GATES.filter((label) => status.boundToHead !== true || status.gates[label]?.exitCode !== 0);
  return status;
})();
const runtimeGatePassed = (label) => runtimeGateStatus.boundToHead === true && runtimeGateStatus.gates[label]?.exitCode === 0;
if (runtimeGateStatus.missing.length > 0) {
  console.error(`runtime gates not satisfied at HEAD ${gitHead}: ${runtimeGateStatus.missing.join(', ')}; run npm run gate:stage10-P-A (each step records its real exit code) before generating evidence`);
}

// Authority proof comes from the shared Stage 9 frozen-authority guard rather
// than a second, independently maintained file list here. That module is the
// single source of truth: it byte-freezes the eight closed Stage 9 gameplay
// files against the accepted baseline, and holds theater/offline/formations/
// save/save-diff to an additive-only export contract, because Stage 10-A
// through 10-E legitimately extend those five (operational tasking, dynamic
// theater pressure, command doctrine, auto operations, strategic loop
// closure). Duplicating the list here previously byte-froze all thirteen and
// silently went stale the moment Stage 10 touched the shared five.
const stage9Authority = readStage9FrozenAuthorityStatus(root);
const frozenFileProof = stage9Authority.rows.map((row) => ({
  file: row.file,
  kind: row.kind,
  baseSha256: row.baseSha256 ?? null,
  currentSha256: row.currentSha256 ?? null,
  unchanged: row.unchanged === true
}));

const porcelain = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
const changedFiles = porcelain.map((line) => line.slice(3)).map((file) => file.includes(' -> ') ? file.split(' -> ').at(-1) : file);
const allowedPresentationChange = (file) => [
  /^css\/style\.css$/,
  /^index\.html$/,
  /^js\/ui\.js$/,
  /^js\/command-(ui|presentation)\.js$/,
  /^assets\/command\//,
  /^tests\/(browser\/)?stage10-P-A/,
  /^tests\/lib\/stage10-P-A/,
  /^tests\/lib\/stage9-frozen-authority\.mjs$/,
  /^tests\/record-stage10-P-A-runtime-gate\.mjs$/,
  /^tests\/(generate|build|verify)-stage10-P-A/,
  /^tests\/stage3-test\.mjs$/,
  /^tests\/stage9-E-integration-test\.mjs$/,
  /^stage9_e_.*\.json$/,
  /^package\.json$/,
  /^\.github\/workflows\/stage10-p-a\.yml$/,
  /^evidence\/stage10-P-A\//,
  /^screenshots\/stage10-P-A\//,
  /^STAGE10-P-A-SELFCHECK\.json$/,
  /^HANDOFF-STAGE10-P-A\.md$/,
  /^HANDOFF-STAGE10-P-A1\.md$/,
  /^progress\.md$/,
  /^iron-command-stage10-P-A-command-ui-foundation\.zip$/
].some((pattern) => pattern.test(file));
const forbiddenChangedFiles = changedFiles.filter((file) => !allowedPresentationChange(file));

const commandUiSource = read('js/command-ui.js');
const presentationSource = read('js/command-presentation.js');
const uiSource = read('js/ui.js');
const cssSource = read('css/style.css');
const componentChecks = {
  commandTile: /export class CommandTile/.test(commandUiSource),
  commandGrid: /export class CommandGrid/.test(commandUiSource),
  quickTooltip: /export class QuickTooltip/.test(commandUiSource) && /COMMAND_TOOLTIP_DELAY_MS\s*=\s*150/.test(commandUiSource),
  commandInspector: /export class CommandInspector/.test(commandUiSource),
  statusBadge: /export function StatusBadge/.test(commandUiSource),
  progressOverlay: /export class ProgressOverlay/.test(commandUiSource),
  commandQueue: /export class CommandQueue/.test(commandUiSource) && /buildProductionQueueModels/.test(uiSource),
  categoryBar: /export class CategoryBar/.test(commandUiSource),
  longPressController: /export class LongPressController/.test(commandUiSource) && /COMMAND_LONG_PRESS_MS\s*=\s*450/.test(commandUiSource),
  presentationModels: ['buildConstructionTileModels', 'buildUnitProductionTileModels', 'buildEquipmentProductionTileModels', 'buildProductionQueueModels'].every((name) => presentationSource.includes(`export function ${name}`)),
  sharedCssNamespace: ['command-tile', 'command-grid', 'command-tooltip', 'command-inspector', 'command-badge', 'command-progress', 'command-queue', 'command-category'].every((name) => cssSource.includes(`.${name}`)),
  oneTooltipAndInspectorHost: /new QuickTooltip/.test(commandUiSource) && /new CommandInspector/.test(commandUiSource)
};

const equivalenceByDomain = Object.fromEntries((stateEquivalence.cases || []).map((row) => [row.domain, row]));
const constructionCase = equivalenceByDomain.construction;
const unitProductionCase = equivalenceByDomain.unit_production;
const equipmentProductionCase = equivalenceByDomain.equipment_production;
const presentationReadOnlyCase = equivalenceByDomain.presentation_read_only;
const functionalRegression = {
  // Sourced from the real runtime gate records of this run at this HEAD.
  historicalCoreRegression: runtimeGatePassed('historical-core-regression'),
  stage9RelevantRegression: runtimeGatePassed('stage9-relevant-regression'),
  stage10CommandUiTests: runtimeGatePassed('stage10-focused-tests'),
  stage10BrowserRun: runtimeGatePassed('stage10-browser'),
  // Sourced from the canonical state equivalence artifact recomputed in this run.
  constructionSemantics: constructionCase?.equivalent === true && constructionCase?.cancelEquivalent === true,
  unitProductionSemantics: unitProductionCase?.equivalent === true,
  equipmentProductionSemantics: equipmentProductionCase?.equivalent === true && equipmentProductionCase?.queuedCancelEquivalent === true,
  presentationReadOnly: presentationReadOnlyCase?.equivalent === true && (stateEquivalence.canonicalFieldsAdded || []).length === 0,
  // Sourced from the browser evidence artifact of this run.
  stage10BrowserEvidence: browser.passed === true && (browser.pageErrors?.length || 0) === 0 && (browser.consoleErrors?.length || 0) === 0
};

const authorityPassed = stage9Authority.passed && forbiddenChangedFiles.length === 0;
const output = {
  stage: '10-P-A',
  baseSha,
  headSha: gitHead,
  saveVersion: SAVE_VERSION,
  currentStage: '10-P-A',
  componentChecks,
  functionalRegression,
  runtimeGates: {
    required: REQUIRED_RUNTIME_GATES,
    headSha: runtimeGateStatus.headSha,
    currentHead: runtimeGateStatus.currentHead,
    boundToHead: runtimeGateStatus.boundToHead,
    recorded: runtimeGateStatus.recorded,
    missing: runtimeGateStatus.missing,
    gates: runtimeGateStatus.gates
  },
  canonicalStateEquivalence: {
    passed: stateEquivalence.passed === true,
    caseCount: stateEquivalence.cases?.length || 0,
    canonicalFieldsAdded: stateEquivalence.canonicalFieldsAdded || []
  },
  authority: {
    gameplayAuthorityChanged: !authorityPassed,
    frozenFileProof,
    changedFiles,
    forbiddenChangedFiles,
    readOnlyPresentationBoundary: true,
    passed: authorityPassed
  },
  passed: SAVE_VERSION === 10 && Object.values(componentChecks).every(Boolean) && Object.values(functionalRegression).every(Boolean) && stateEquivalence.passed === true && authorityPassed
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-machine.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ stage: output.stage, passed: output.passed, baseSha: output.baseSha, headSha: output.headSha, saveVersion: output.saveVersion, frozenFiles: frozenFileProof.length, authorityViolations: stage9Authority.violations.map((row) => `${row.kind}:${row.file}`), runtimeGatesMissing: runtimeGateStatus.missing, forbiddenChangedFiles }));
if (!output.passed) process.exitCode = 1;
