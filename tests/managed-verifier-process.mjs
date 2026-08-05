import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function waitForExit(processHandle, timeoutMs = 3000) {
  if (processHandle.state.exited) return Promise.resolve(processHandle.state);
  return Promise.race([
    processHandle.exitPromise,
    new Promise((resolve) => setTimeout(() => resolve({ ...processHandle.state, timedOut: true }), timeoutMs))
  ]);
}

export function launchManagedVerifierProcess({ cwd, root = cwd, port = 0, node = process.execPath } = {}) {
  const source = `import { createServer } from './scripts/serve.mjs'; const server = createServer(${JSON.stringify(root)}); server.listen(${Number(port) || 0}, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));`;
  const child = spawn(node, ['--input-type=module', '-e', source], { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { pid: child.pid, exited: false, code: null, signal: null, error: null };
  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  const handle = { child, state, exitPromise, port: null, stderr: '' };
  let stdout = '';
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error('managed verifier server start timeout')), 10000);
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const line = stdout.split(/\r?\n/)[0];
    try {
      const payload = JSON.parse(line);
      handle.port = Number(payload.port);
      clearTimeout(timer);
      resolveReady(handle);
    } catch {}
  });
  child.stderr.on('data', (chunk) => { handle.stderr = (handle.stderr + chunk.toString()).slice(-12000); });
  // Attach both listeners synchronously after spawn to avoid the exit/error race.
  child.once('error', (error) => { state.error = error; state.exited = true; resolveExit(state); rejectReady(error); });
  child.once('exit', (code, signal) => { state.exited = true; state.code = code; state.signal = signal; resolveExit(state); if (!handle.port) rejectReady(new Error(`managed verifier server exited ${code || signal}`)); });
  handle.ready = ready;
  return handle;
}

function signalProcess(handle, signal) {
  const pid = handle?.child?.pid;
  if (!pid) return false;
  try { return process.platform === 'win32' ? handle.child.kill(signal) : process.kill(-pid, signal); } catch {
    try { return handle.child.kill(signal); } catch { return false; }
  }
}

export async function terminateManagedVerifierProcess(handle, options = {}) {
  if (!handle) return { exited: true, cleaned: true };
  const termTimeoutMs = options.termTimeoutMs ?? 3000;
  const killTimeoutMs = options.killTimeoutMs ?? 1000;
  let state = await waitForExit(handle, 0);
  if (!state.exited) {
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(handle.child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else signalProcess(handle, 'SIGTERM');
    state = await waitForExit(handle, termTimeoutMs);
  }
  if (!state.exited) { signalProcess(handle, 'SIGKILL'); state = await waitForExit(handle, killTimeoutMs); }
  return state;
}

export { waitForExit };
