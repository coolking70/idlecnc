import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const evidence = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'stage8_2g_dc_audio_cue_check.json'), 'utf8'));
assert.equal(evidence.passed, true); const cues = evidence.rows.flatMap((row) => row.cues); assert.ok(cues.some((cue) => cue.eventType === 'fire')); assert.ok(cues.some((cue) => cue.eventType === 'impact')); assert.ok(cues.every((cue) => cue.shotId || cue.eventId || cue.eventType === 'result'));
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C', rows: evidence.rows.length, cueCount: cues.length, traceable: true }));
