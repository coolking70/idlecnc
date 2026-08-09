import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const evidence = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'stage8_2g_dc_camera_feedback_check.json'), 'utf8'));
assert.equal(evidence.passed, true); assert.ok(evidence.rows.every((row) => Math.abs(Number(row.amplitude) || 0) <= evidence.limits.maxTranslation)); assert.ok(evidence.rows.every((row) => Number(row.unclampedAmplitude || 0) >= Number(row.amplitude || 0)));
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C', rows: evidence.rows.length, maxAmplitude: Math.max(...evidence.rows.map((row) => Number(row.amplitude) || 0)), bounded: true }));
