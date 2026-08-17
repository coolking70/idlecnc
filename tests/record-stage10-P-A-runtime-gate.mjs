import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Records one real runtime gate execution for Stage 10-P-A delivery closure.
//
//   node tests/record-stage10-P-A-runtime-gate.mjs <label> -- <command> [args...]
//
// The recorder runs <command>, appends/overwrites { label, command, exitCode,
// startedAt, finishedAt, durationMs } for this label in
// evidence/stage10-P-A/stage10-P-A-runtime-gates.json, and exits with the
// command's real exit code. The record file is bound to the git HEAD it was
// produced at: when the current HEAD differs from the stored one the file is
// reset, so stale records from an older head can never satisfy a later gate.
//
// Consumers (machine evidence and final runtime closure) must additionally
// verify the stored headSha equals the current HEAD and that each required
// label has exitCode 0. Missing records fail closed.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recordPath = path.join(root, 'evidence/stage10-P-A/stage10-P-A-runtime-gates.json');
const separator = process.argv.indexOf('--');
if (separator === -1 || process.argv.length < separator + 3) {
  console.error('usage: node tests/record-stage10-P-A-runtime-gate.mjs <label> -- <command> [args...]');
  process.exit(2);
}
const label = process.argv[2];
const command = process.argv[separator + 1];
const args = process.argv.slice(separator + 2);
if (!label || !/^[a-z0-9-]+$/.test(label) || !command) {
  console.error('usage: node tests/record-stage10-P-A-runtime-gate.mjs <label> -- <command> [args...]');
  process.exit(2);
}

const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (headSha.status !== 0) {
  console.error(`runtime gate recorder needs a git HEAD: ${headSha.stderr}`);
  process.exit(2);
}
const currentHead = headSha.stdout.trim();

let store = { headSha: currentHead, gates: {} };
if (fs.existsSync(recordPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.headSha === currentHead && parsed.gates && typeof parsed.gates === 'object') {
      store = parsed;
    }
  } catch {
    store = { headSha: currentHead, gates: {} };
  }
}

const startedAt = new Date().toISOString();
const timedCommandStart = process.hrtime.bigint();
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env, maxBuffer: 32 * 1024 * 1024 });
const durationMs = Number((process.hrtime.bigint() - timedCommandStart) / 1_000_000n);
const finishedAt = new Date().toISOString();
const exitCode = result.status === null ? (result.signal ? 124 : 1) : result.status;

store.gates[label] = {
  label,
  command: [command, ...args].join(' '),
  exitCode,
  signal: result.signal || null,
  startedAt,
  finishedAt,
  durationMs
};
fs.mkdirSync(path.dirname(recordPath), { recursive: true });
fs.writeFileSync(recordPath, `${JSON.stringify(store, null, 2)}\n`);
console.log(`[runtime-gate] ${label}: exitCode=${exitCode} durationMs=${durationMs} head=${currentHead.slice(0, 12)}`);
process.exit(exitCode);
