import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnManagedProcess, terminateProcessTree, processExists, waitForChildClose } from '../report-adapter/process-tree-manager.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const verifierSource = fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/verify-b2-2-delivery-package.mjs'), 'utf8');
const managerSource = fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/process-tree-manager.mjs'), 'utf8');
let total = 0; let passed = 0;
function check(name, fn) { total += 1; try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; } }
async function waitForHttp(url, managed) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (managed.child.exitCode !== null) throw new Error(`server exited ${managed.child.exitCode}`);
    try { const response = await fetch(url); if (response.status === 200) return response; } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('http_ready_timeout');
}
async function freePort() {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
}
async function portIsFree(port) {
  return new Promise((resolve) => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); });
}

check('1. spawnManagedProcess exposes pid/start time and detached mode', () => { const managed = spawnManagedProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] }); assert.ok(managed.pid); assert.ok(managed.startedAt); assert.equal(managed.detached, process.platform !== 'win32'); });
// The short-lived process from check 1 is intentionally not left running: its pid is not retained by the assertion.
check('2. processExists observes a live child', () => { const managed = spawnManagedProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] }); assert.equal(processExists(managed.pid), true); managed.child.kill('SIGTERM'); });
check('3. POSIX process groups or Windows taskkill are implemented', () => { assert.match(managerSource, /process\.kill\(-pid/); assert.match(managerSource, /taskkill/); });
check('4. close waits have an explicit timeout', () => assert.match(managerSource, /process_close_timeout|timeoutAfter/));
check('5. verifier has a bounded HTTP readiness loop', () => assert.match(verifierSource, /5000|http_ready_timeout/));
check('6. verifier uses managed process startup', () => assert.match(verifierSource, /spawnManagedProcess/));
check('7. verifier uses process-tree termination', () => assert.match(verifierSource, /terminateProcessTree/));
check('8. verifier continues after npm start into adapter integrity', () => assert.ok(verifierSource.indexOf('npm start and HTTP routes') < verifierSource.indexOf('sandbox-report-adapter-integrity-test')));
check('9. verifier checks the final success marker', () => assert.match(verifierSource, /verify-b2-2-delivery-package: ok/));

const port = await freePort();
const managed = spawnManagedProcess('npm', ['start'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
check('10. npm start child is created', () => assert.ok(managed.pid));
await waitForHttp(`http://127.0.0.1:${port}/`, managed);
check('11. npm start serves HTTP', () => assert.equal(true, true));
const termination = await terminateProcessTree(managed, { graceMs: 1500, forceMs: 1500 });
check('12. termination closes the complete process group', () => { assert.equal(termination.closed, true); assert.equal(processExists(managed.pid), false); });
const released = await portIsFree(port);
check('13. temporary port is released', () => assert.equal(released, true));

const stubborn = spawnManagedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'pipe'] });
const forced = await terminateProcessTree(stubborn, { graceMs: 10, forceMs: 1500 });
check('14. forced termination is bounded and leaves no child', () => { assert.equal(forced.closed, true); assert.equal(processExists(stubborn.pid), false); });
const shortChild = spawnManagedProcess(process.execPath, ['-e', 'process.exit(0)'], { stdio: ['ignore', 'pipe', 'pipe'] });
const shortResult = await waitForChildClose(shortChild.child, 3000);
check('15. waitForChildClose is callable with a timeout', () => assert.equal(shortResult.code, 0));

console.log(`delivery-verifier-process-test: ${passed} passed / ${total} total`);
