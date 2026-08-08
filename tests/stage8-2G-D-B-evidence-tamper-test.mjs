import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDbTamperReference, verifyTamperPayload } from './verify-stage8-2G-D-B-evidence.mjs';

const root = process.cwd();
const reference = buildDbTamperReference();
const cases = [
  ['wrong selected actor', { selectedActorId: 'tampered-actor' }],
  ['wrong HP', { hp: reference.hp + 1 }],
  ['wrong status', { status: '射击' }],
  ['wrong objective', { objective: '错误目标' }],
  ['wrong phase', { phase: 'battle_end' }],
  ['wrong result', { result: 'defeat' }],
  ['wrong reward', { reward: '{}' }],
  ['wrong faction asset', { factionAssetId: 'unit_enemy_scout_car' }],
  ['wrong unit asset', { unitAssetId: 'unit_friendly_mbt' }],
  ['wrong wreck', { wreckAssetId: 'wreck_enemy_support_vehicle' }],
  ['duplicate PNG', { duplicateImageHashes: true }],
  ['authority mutation', { authorityStable: false }]
];
const results = cases.map(([name, mutation]) => { const payload = { ...reference, ...mutation }; const result = verifyTamperPayload(payload, reference); assert.equal(result.ok, false, `tamper accepted: ${name}`); return { name, rejected: true, errors: result.errors }; });
const output = { stage: '8.2G-D-B', version: 1, cases: results, rejectionCount: results.length, requiredMinimum: 11, passed: results.length >= 11 && results.every((item) => item.rejected) };
fs.writeFileSync(path.join(root, 'stage8_2g_db_tamper_results.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true);
console.log(JSON.stringify({ ok: true, stage: output.stage, tamperCases: results.length, rejected: results.length }));
