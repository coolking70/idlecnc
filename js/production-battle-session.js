/**
 * Stage 8.2G-E-A production battle session contract.
 *
 * This module owns integration identity only. It never calculates a battle
 * result, reward, damage, repair, or settlement plan.
 */

import { stableStringify } from './battle-presentation/core/report-normalizer.js';
import { deepClone } from './utils.js';

export const SESSION_ORIGIN = Object.freeze({
  PRODUCTION: 'production',
  DEBUG: 'debug',
  FIXTURE: 'fixture'
});

export const SESSION_LIFECYCLE = Object.freeze({
  CREATED: 'created',
  RUNNING: 'running',
  FORMAL_COMPLETED: 'formal_completed',
  SETTLEMENT_PENDING: 'settlement_pending',
  SETTLED: 'settled',
  RETURNED: 'returned',
  REPLAY: 'replay'
});

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

const initialHash = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

const rightRotate = (value, bits) => (value >>> bits) | (value << (32 - bits));

/** Synchronous SHA-256 for deterministic browser-side identity contracts. */
export function sha256(text) {
  const source = String(text);
  const bytes = new TextEncoder().encode(source);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const highLength = Math.floor(bitLength / 0x100000000);
  const lowLength = bitLength >>> 0;
  padded[paddedLength - 8] = (highLength >>> 24) & 0xff;
  padded[paddedLength - 7] = (highLength >>> 16) & 0xff;
  padded[paddedLength - 6] = (highLength >>> 8) & 0xff;
  padded[paddedLength - 5] = highLength & 0xff;
  padded[paddedLength - 4] = (lowLength >>> 24) & 0xff;
  padded[paddedLength - 3] = (lowLength >>> 16) & 0xff;
  padded[paddedLength - 2] = (lowLength >>> 8) & 0xff;
  padded[paddedLength - 1] = lowLength & 0xff;

  const hash = initialHash.slice();
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] = ((padded[base] << 24) | (padded[base + 1] << 16)
        | (padded[base + 2] << 8) | padded[base + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const valueA = words[index - 15];
      const valueB = words[index - 2];
      const sigma0 = rightRotate(valueA, 7) ^ rightRotate(valueA, 18) ^ (valueA >>> 3);
      const sigma1 = rightRotate(valueB, 17) ^ rightRotate(valueB, 19) ^ (valueB >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA_K[index] + words[index]) >>> 0;
      const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function canonicalHash(value) {
  return sha256(stableStringify(value));
}

export function cloneJson(value) {
  return deepClone(value);
}

export function ensureBattleSessionState(state) {
  if (!state || typeof state !== 'object') return state;
  if (!state.battleSessions || typeof state.battleSessions !== 'object' || Array.isArray(state.battleSessions)) state.battleSessions = {};
  if (!state.battleSettlementLedger || typeof state.battleSettlementLedger !== 'object' || Array.isArray(state.battleSettlementLedger)) state.battleSettlementLedger = {};
  if (!Number.isInteger(state.battleSessionSequence) || state.battleSessionSequence < 0) state.battleSessionSequence = 0;
  if (typeof state.activeBattleSessionId !== 'string') state.activeBattleSessionId = null;
  return state;
}

export function buildAuthorityHashes(report) {
  const source = report && typeof report === 'object' ? report : {};
  const events = Array.isArray(source.events) ? source.events : [];
  return {
    formalReportHash: canonicalHash(source),
    shotHash: canonicalHash(events.filter((event) => ['shot', 'fire', 'attack', 'projectile'].includes(event?.type))),
    repairHash: canonicalHash(events.filter((event) => ['repair', 'repairing'].includes(event?.type))),
    resultHash: canonicalHash({ result: source.result ?? null, capture: source.capture === true, rewards: source.rewards || {}, losses: source.losses || {}, final: source.final || {} })
  };
}

export function buildSettlementId(battleSessionId, formalReportHash) {
  return `settlement-${canonicalHash({ battleSessionId, formalReportHash })}`;
}

export function buildSettlementLedgerHash(ledger) {
  const source = cloneJson(ledger) || {};
  delete source.ledgerHash;
  return canonicalHash(source);
}

export function validateSettlementLedger(ledger, session) {
  const problems = [];
  if (!ledger || typeof ledger !== 'object') problems.push('settlement ledger missing');
  if (!ledger?.ledgerHash || buildSettlementLedgerHash(ledger) !== ledger.ledgerHash) problems.push('settlement ledger hash mismatch');
  if (session && ledger?.settlementId !== session.settlementId) problems.push('settlement ledger ID mismatch');
  if (session && ledger?.battleSessionId !== session.battleSessionId) problems.push('settlement ledger session mismatch');
  if (session && ledger?.formalReportHash !== session.formalReportHash) problems.push('settlement ledger report binding mismatch');
  if (ledger?.status !== 'applied') problems.push('settlement ledger is not applied');
  return { ok: problems.length === 0, problems };
}

export function createProductionBattleSession({
  sourceSaveRevision = 0,
  missionId,
  deploymentSnapshot,
  report,
  sequence = 0,
  sessionOrigin = SESSION_ORIGIN.PRODUCTION,
  createdAtGameTime = 0,
  salvageRulesVersion = 0
}) {
  const deployment = cloneJson(deploymentSnapshot) || {};
  const authority = buildAuthorityHashes(report);
  const deploymentHash = canonicalHash(deployment);
  const stableMissionId = String(missionId || deployment.missionId || 'unknown-mission');
  const battleSessionId = `battle-session-${Math.max(0, Math.floor(Number(sourceSaveRevision) || 0))}-${stableMissionId}-${deploymentHash.slice(0, 20)}-${Math.max(0, Math.floor(Number(sequence) || 0))}`;
  return {
    battleSessionId,
    missionId: stableMissionId,
    deploymentSnapshot: deployment,
    deploymentSnapshotId: `deployment-${deploymentHash}`,
    deploymentHash,
    sourceSaveRevision: Math.max(0, Math.floor(Number(sourceSaveRevision) || 0)),
    formalReportId: report?.id || null,
    ...authority,
    sourceReportHash: authority.formalReportHash,
    sessionOrigin: sessionOrigin === SESSION_ORIGIN.PRODUCTION ? SESSION_ORIGIN.PRODUCTION : String(sessionOrigin || SESSION_ORIGIN.DEBUG),
    lifecycle: SESSION_LIFECYCLE.CREATED,
    settlementId: buildSettlementId(battleSessionId, authority.formalReportHash),
    settlementStatus: 'pending',
    presentationState: { phase: 'battle', elapsed: 0 },
    settlementState: { status: 'pending', settlementId: buildSettlementId(battleSessionId, authority.formalReportHash), locked: false },
    returnState: { status: 'not_started', elapsed: 0, duration: 5 },
    presentationTime: 0,
    createdAtGameTime: Number.isFinite(Number(createdAtGameTime)) ? Number(createdAtGameTime) : 0,
    settledAtGameTime: null,
    returnedAtGameTime: null,
    replayReadOnly: false,
    settlementLocked: false,
    // Stage 9-D metadata only. Formal identity, hashes and lifecycle remain
    // unchanged; callers must explicitly opt into a salvage rules version.
    salvageRulesVersion: Number.isInteger(salvageRulesVersion) && salvageRulesVersion >= 0
      ? salvageRulesVersion : 0,
    version: 1
  };
}

export function validateSessionBinding(session, {
  report, deploymentSnapshot, battleSessionId, deploymentSnapshotId,
  deploymentHash, sourceSaveRevision, settlementId, sourceReportHash
} = {}) {
  const problems = [];
  if (!session || typeof session !== 'object') problems.push('battle session missing');
  if (session?.sessionOrigin !== SESSION_ORIGIN.PRODUCTION) problems.push('session origin is not production');
  if (!session?.battleSessionId || !session?.deploymentHash || !session?.formalReportHash) problems.push('session identity incomplete');
  if (!session?.deploymentSnapshotId || !session?.sourceReportHash) problems.push('session binding fields incomplete');
  if (session?.sourceReportHash && session.sourceReportHash !== session.formalReportHash) problems.push('source report hash mismatch');
  if (battleSessionId && battleSessionId !== session?.battleSessionId) problems.push('battle session ID mismatch');
  if (deploymentSnapshotId && deploymentSnapshotId !== session?.deploymentSnapshotId) problems.push('deployment snapshot ID mismatch');
  if (sourceSaveRevision !== undefined && Number(sourceSaveRevision) !== Number(session?.sourceSaveRevision)) problems.push('source save revision mismatch');
  if (settlementId && settlementId !== session?.settlementId) problems.push('settlement ID mismatch');
  if (sourceReportHash && sourceReportHash !== session?.sourceReportHash) problems.push('source report hash binding mismatch');
  if (deploymentSnapshot && canonicalHash(deploymentSnapshot) !== session.deploymentHash) problems.push('deployment hash mismatch');
  if (deploymentHash && deploymentHash !== session?.deploymentHash) problems.push('deployment hash binding mismatch');
  if (report && buildAuthorityHashes(report).formalReportHash !== session.formalReportHash) problems.push('formal report hash mismatch');
  if (report && report.id !== session.formalReportId) problems.push('formal report id mismatch');
  return { ok: problems.length === 0, problems };
}
