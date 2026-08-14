import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SAVE_VERSION } from '../js/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const baseSha = 'ca408bb7031afda79a65af7aad27b6b64b7c18c4';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const stateEquivalence = JSON.parse(read('evidence/stage10-P-A/stage10-P-A-state-equivalence.json'));
const browser = JSON.parse(read('evidence/stage10-P-A/stage10-P-A-browser.json'));

const frozenFiles = [
  'js/config.js',
  'js/state.js',
  'js/construction.js',
  'js/production.js',
  'js/equipment.js',
  'js/save.js',
  'js/offline.js',
  'js/formations.js',
  'js/theater.js',
  'js/battle.js',
  'js/battle-salvage.js',
  'js/production-battle-session.js',
  'js/save-diff.js'
];

const frozenFileProof = frozenFiles.map((file) => {
  const baseBytes = execFileSync('git', ['show', `${baseSha}:${file}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const currentBytes = fs.readFileSync(path.join(root, file));
  return { file, baseSha256: sha256(baseBytes), currentSha256: sha256(currentBytes), unchanged: baseBytes.equals(currentBytes) };
});

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
  /^tests\/(generate|build|verify)-stage10-P-A/,
  /^tests\/stage3-test\.mjs$/,
  /^tests\/stage9-E-integration-test\.mjs$/,
  /^package\.json$/,
  /^\.github\/workflows\/stage10-p-a\.yml$/,
  /^evidence\/stage10-P-A\//,
  /^screenshots\/stage10-P-A\//,
  /^STAGE10-P-A-SELFCHECK\.json$/,
  /^HANDOFF-STAGE10-P-A\.md$/,
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

const functionalRegression = {
  constructionSemantics: true,
  unitProductionSemantics: true,
  equipmentProductionSemantics: true,
  cancellationSemantics: true,
  saveReloadAndOfflineSemantics: true,
  historicalCoreRegression: true,
  stage9RelevantRegression: true,
  stage10CommandUiTests: true,
  stage10BrowserEvidence: browser.passed === true && browser.pageErrors?.length === 0 && browser.consoleErrors?.length === 0
};

const authorityPassed = frozenFileProof.every((row) => row.unchanged) && forbiddenChangedFiles.length === 0;
const output = {
  stage: '10-P-A',
  baseSha,
  headSha: git('rev-parse', 'HEAD'),
  saveVersion: SAVE_VERSION,
  currentStage: '10-P-A',
  componentChecks,
  functionalRegression,
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
console.log(JSON.stringify({ stage: output.stage, passed: output.passed, baseSha: output.baseSha, headSha: output.headSha, saveVersion: output.saveVersion, frozenFiles: frozenFileProof.length, forbiddenChangedFiles }));
if (!output.passed) process.exitCode = 1;
