import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { awaitFitEnvironment, loadSnapshot, PerfEnvironmentUnfitError } from './lib/perf-environment.mjs';
import { BATTLE_RESULT, SALVAGE_RULES } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { buildSettlementLedgerHash, createProductionBattleSession } from '../js/production-battle-session.js';
import { deriveSalvageOffer } from '../js/battle-salvage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const warmup = 20;
const samples = 120;
const budgetMs = 16.7;
const p95 = (values) => {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] || 0;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture(result = BATTLE_RESULT.VICTORY, sequence = 1) {
  const state = createInitialState();
  const report = {
    id: `stage9-d-perf-report-${sequence}`,
    theaterId: 'mountain_pass', missionId: 'mountain_pass', missionKind: 'campaign', result,
    capture: result === BATTLE_RESULT.VICTORY, events: [], final: { friendly: [], enemy: [] }, rewards: {}
  };
  const session = createProductionBattleSession({
    sourceSaveRevision: 100, missionId: 'mountain_pass',
    deploymentSnapshot: { missionId: 'mountain_pass', theaterId: 'mountain_pass', units: [] },
    report, sequence
  });
  state.battleSessions[session.battleSessionId] = session;
  state.battles = [report];
  const ledger = {
    settlementId: session.settlementId, battleSessionId: session.battleSessionId,
    formalReportHash: session.formalReportHash, reportId: report.id, result,
    reward: {}, losses: { unitIds: [], updatedUnitIds: [] }, appliedAtSaveRevision: 100, status: 'applied'
  };
  ledger.ledgerHash = buildSettlementLedgerHash(ledger);
  state.battleSettlementLedger[session.settlementId] = ledger;
  return { state, session };
}

function measure(name, state, battleSessionId) {
  const fn = () => deriveSalvageOffer(state, battleSessionId);
  for (let index = 0; index < warmup; index += 1) fn();
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = process.hrtime.bigint();
    fn();
    values.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return {
    name, warmup, samples, metric: 'p95',
    p95Ms: Number(p95(values).toFixed(4)),
    maxMs: Number(Math.max(...values).toFixed(4)),
    rawSamplesMs: values.map((value) => Number(value.toFixed(6)))
  };
}

const loadBefore = loadSnapshot();
const guard = await awaitFitEnvironment();
if (!guard.fit) {
  const output = {
    stage: '9-D', version: 1, measurement: 'deterministic post-settlement salvage derivation',
    budgetMs, warmup, samples, metric: 'p95', measurementValid: false, passed: false,
    environment: guard.snapshot, loadBefore, loadAfter: guard.snapshot,
    environmentGuard: { fit: false, threshold: guard.threshold, attempts: guard.attempts, samples: guard.samples },
    scenarios: []
  };
  fs.writeFileSync(path.join(root, 'stage9_d_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
  throw new PerfEnvironmentUnfitError('9-D', guard);
}

const eligible = fixture(BATTLE_RESULT.VICTORY, 1);
const pyrrhic = fixture(BATTLE_RESULT.PYRRHIC, 2);
const invalid = fixture(BATTLE_RESULT.VICTORY, 3);
invalid.state.battleSettlementLedger[invalid.session.settlementId].ledgerHash = 'tampered';
const scenarios = {
  eligibleOffer: measure('eligibleOffer', eligible.state, eligible.session.battleSessionId),
  pyrrhicOffer: measure('pyrrhicOffer', pyrrhic.state, pyrrhic.session.battleSessionId),
  invalidSettlementFailClosed: measure('invalidSettlementFailClosed', invalid.state, invalid.session.battleSessionId)
};
const loadAfter = loadSnapshot();
const environment = {
  platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown',
  cpuCount: os.cpus().length, nodeVersion: process.version
};
assert.ok(Object.values(scenarios).every((row) => row.samples === samples && row.p95Ms < budgetMs), JSON.stringify(scenarios));
const output = {
  stage: '9-D', version: 1, measurement: 'deterministic post-settlement salvage derivation',
  budgetMs, warmup, samples, metric: 'p95', measurementValid: true, passed: true,
  environment, loadBefore, loadAfter,
  environmentGuard: {
    fit: true, qualificationVersion: guard.qualificationVersion, threshold: guard.threshold,
    attempts: guard.attempts, attemptsLimit: guard.attemptsLimit, samples: guard.samples,
    loadBefore: guard.samples?.[0]?.probes?.[0]?.snapshotBefore?.normalizedLoad1 ?? loadBefore.normalizedLoad1,
    loadAfter: loadAfter.normalizedLoad1
  },
  salvageRulesVersion: SALVAGE_RULES.version,
  scenarios
};
fs.writeFileSync(path.join(root, 'stage9_d_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, measurementValid: true, p95Ms: Object.fromEntries(Object.entries(scenarios).map(([id, row]) => [id, row.p95Ms])), loadBefore: output.loadBefore.normalizedLoad1, loadAfter: output.loadAfter.normalizedLoad1, environment }));
