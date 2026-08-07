import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'tests/evidence');
const logFile = path.join(evidenceDir, 'stage8_2g_a11_full_npm_test.log');
const jsonFile = path.join(evidenceDir, 'stage8_2g_a11_full_npm_test.json');
const hardTimeoutMs = Number(process.env.IRON_COMMAND_FULL_TEST_TIMEOUT_MS) > 0 ? Number(process.env.IRON_COMMAND_FULL_TEST_TIMEOUT_MS) : 900000;
const cleanExtract = process.env.IRON_COMMAND_CLEAN_EXTRACT === 'true';
const startedAt = new Date();
fs.mkdirSync(evidenceDir, { recursive: true });
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const testFiles = packageJson.scripts.test.split(/\s+&&\s+/).map((entry) => entry.replace(/^node\s+/, '').trim()).filter(Boolean);
const npmVersion = (spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], { encoding: 'utf8' }).stdout || '').trim();
const log = fs.createWriteStream(logFile, { flags: 'w' });
const write = (value) => { process.stdout.write(value); log.write(value); };
write(`stage=8.2G-A.1.1\nstartedAt=${startedAt.toISOString()}\ncommand=npm test\ncleanExtract=${cleanExtract}\nnode=${process.version}\nnpm=${npmVersion}\nos=${process.platform} ${process.arch} ${os.release()}\nworkingDirectory=${root}\ntestFiles=${testFiles.join(',')}\n--- npm test output ---\n`);

const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], { cwd: root, env: { ...process.env }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let settled = false;
let timeoutHandle;
const append = (chunk) => { const text = chunk.toString(); output += text; write(text); };
child.stdout.on('data', append); child.stderr.on('data', append);
const killGroup = (signal) => {
  try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
};
const finish = (exitCode, signal, timedOut = false) => {
  if (settled) return;
  settled = true; clearTimeout(timeoutHandle);
  const finishedAt = new Date();
  const assertionRecords = [];
  for (const match of output.matchAll(/(?:测试总数[:：]\s*|: |：)(\d+)\s+(?:通过[:：]\s*)?(\d+)\s+(?:失败[:：]\s*)?(\d+)?\s*(?:总|passed)/g)) assertionRecords.push({ passed: Number(match[2] || match[1]), total: Number(match[1] || match[2]) });
  for (const match of output.matchAll(/(?:^|\n)[^\n:]+:\s*(\d+)\s+passed\s*\/\s*(\d+)\s+total/g)) assertionRecords.push({ passed: Number(match[1]), total: Number(match[2]) });
  for (const match of output.matchAll(/(?:\n|^)(?:[^\n]*):\s*(\d+)\s+(?:plans|checks|contacts|convoy plans) passed/g)) assertionRecords.push({ passed: Number(match[1]), total: Number(match[1]) });
  const total = assertionRecords.reduce((sum, record) => sum + record.total, 0);
  const passed = assertionRecords.reduce((sum, record) => sum + record.passed, 0);
  const failed = timedOut || exitCode !== 0 ? Math.max(1, total - passed) : 0;
  const slowestTests = [...output.matchAll(/(?:PASS|passed)\s+([^\n]*?)(?:\s+duration=|\s+in\s+)(\d+(?:\.\d+)?)s/g)].map((match) => ({ name: match[1].trim(), durationMs: Math.round(Number(match[2]) * 1000) })).sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
  const result = { stage: '8.2G-A.1.1', command: 'npm test', cleanExtract, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: finishedAt - startedAt, exitCode: timedOut ? 124 : (exitCode ?? 1), total, passed, failed, skipped: 0, testFiles, slowestTests, environment: { os: `${process.platform} ${process.arch} ${os.release()}`, node: process.version, npm: npmVersion }, logFile: 'tests/evidence/stage8_2g_a11_full_npm_test.log', timeout: { hardTimeoutMs, timedOut, signal: signal || null }, process: { pid: child.pid, activeAfterExit: false } };
  fs.writeFileSync(jsonFile, JSON.stringify(result, null, 2) + '\n');
  write(`\n--- result ---\nfinishedAt=${finishedAt.toISOString()}\nexitCode=${result.exitCode}\ntotal=${total}\npassed=${passed}\nfailed=${failed}\nskipped=0\ndurationMs=${result.durationMs}\nslowestTests=${JSON.stringify(slowestTests)}\n`);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
  log.end();
};
child.once('error', (error) => { write(`\nspawnError=${error.stack || error}\n`); finish(1, null, false); });
child.once('close', (code, signal) => finish(code, signal, false));
timeoutHandle = setTimeout(() => { write(`\nHARD_TIMEOUT pid=${child.pid} timeoutMs=${hardTimeoutMs}\n`); killGroup('SIGTERM'); setTimeout(() => killGroup('SIGKILL'), 1500).unref?.(); }, hardTimeoutMs);
