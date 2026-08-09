import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { dispatchCodeLabel, dispatchEligibilityText, missionKindLabel, operationCooldownText, unitStatusLabel } from '../js/mission-command-presentation.js';

const warmupSamples = 20;
const sampleCount = 120;
const budgetMs = 16.7;
const scenarios = [
  { id: 'campaign-ready', kind: 'campaign', check: { ok: true, code: 'ready' }, operation: null, unitStatus: 'assigned' },
  { id: 'campaign-blocked', kind: 'campaign', check: { ok: false, code: 'theater_not_captured', reason: '目标战区尚未占领' }, operation: null, unitStatus: 'deployed' },
  { id: 'operation-cooldown', kind: 'operation', check: { ok: false, code: 'cooldown', reason: '剩余 12 秒' }, operation: { cooldownRemaining: 12, cooldownText: '12 秒' }, unitStatus: 'repairing' },
  { id: 'operation-ready', kind: 'operation', check: { ok: true, code: 'ready' }, operation: { cooldownRemaining: 0, cooldownUntil: 0 }, unitStatus: 'ready' }
];

const root = process.cwd();
const uiSource = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
const presentationSource = fs.readFileSync(new URL('../js/mission-command-presentation.js', import.meta.url), 'utf8');
const dispatchStart = uiSource.indexOf('  _updateDispatchConsole(state, active) {');
const dispatchEnd = uiSource.indexOf('  /** 刷新「当前作战」面板 */', dispatchStart);
assert.notEqual(dispatchStart, -1, 'dispatch console source region');
assert.notEqual(dispatchEnd, -1, 'dispatch console source boundary');
const dispatchSource = uiSource.slice(dispatchStart, dispatchEnd);
const forbiddenHotPathTokens = ['computeSaveDiff', 'productionStateSignature', 'readRaw', 'localStorage', 'structuredClone'];
assert.deepEqual(forbiddenHotPathTokens.filter((token) => dispatchSource.includes(token)), [], 'dispatch UI hot path must not read/diff full save state');
assert.equal(presentationSource.includes('requestAnimationFrame'), false, 'presentation metadata must not enter animation frame loop');

const invoke = (scenario, index) => {
  const check = { ...scenario.check };
  const operation = scenario.operation ? { ...scenario.operation } : null;
  const started = process.hrtime.bigint();
  const result = [
    missionKindLabel(scenario.kind),
    dispatchCodeLabel(check),
    dispatchEligibilityText(check),
    operationCooldownText(operation),
    unitStatusLabel(scenario.unitStatus),
    index % 2 ? 'cost-preview' : 'deployment-review'
  ].join('|');
  return { elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, resultLength: result.length };
};

const rows = scenarios.map((scenario) => {
  for (let index = 0; index < warmupSamples; index += 1) invoke(scenario, index);
  const samples = Array.from({ length: sampleCount }, (_, index) => invoke(scenario, index));
  const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const p95Ms = sorted[Math.floor((sorted.length - 1) * 0.95)];
  return {
    scenario: scenario.id,
    warmupSamples,
    samples: sampleCount,
    averageMs: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(4)),
    p95Ms: Number(p95Ms.toFixed(4)),
    maxMs: Number(sorted.at(-1).toFixed(4)),
    resultLength: samples.at(-1).resultLength,
    measured: true
  };
});

const passed = rows.every((row) => row.samples === sampleCount && row.p95Ms < budgetMs);
assert.equal(passed, true, JSON.stringify(rows));
const output = {
  stage: '8.2G-E-B',
  version: 1,
  measurement: 'mission eligibility labels, cost-preview metadata and deployment-review metadata; presentation-only benchmark',
  runtime: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: os.cpus().length },
  hotPathGuard: { forbiddenTokens: forbiddenHotPathTokens, foundTokens: [], fullSaveHashOrDiffInDispatchPath: false, storageReadInDispatchPath: false, animationFrameInPresentationMetadata: false },
  warmupSamples,
  sampleCount,
  limits: { p95Ms: budgetMs, comparison: 'strictly less than 16.7ms' },
  scenarios: rows,
  passed
};
fs.writeFileSync(`${root}/stage8_2g_eb_performance_check.json`, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, warmupSamples, sampleCount, p95Ms: rows.map((row) => ({ scenario: row.scenario, p95Ms: row.p95Ms })) }));
