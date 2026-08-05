import { execFileSync, spawn } from 'node:child_process';

export function spawnManagedProcess(command, args = [], options = {}) {
  const detached = options.detached ?? process.platform !== 'win32';
  const child = spawn(command, args, { ...options, detached });
  const managed = { child, pid: child.pid, startedAt: performance.now(), stdout: '', stderr: '', detached };
  if (child.stdout) child.stdout.on('data', (chunk) => { managed.stdout += chunk.toString(); });
  if (child.stderr) child.stderr.on('data', (chunk) => { managed.stderr += chunk.toString(); });
  return managed;
}

export function processExists(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function timeoutAfter(milliseconds, label = 'timeout') {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(label)), milliseconds));
}

export function waitForChildClose(child, milliseconds = 3000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return Promise.race([
    new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal }))),
    timeoutAfter(milliseconds, 'process_close_timeout')
  ]);
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch { return false; }
}

export async function terminateProcessTree(managed, options = {}) {
  const graceMs = options.graceMs ?? 1500; const forceMs = options.forceMs ?? 1500;
  if (!managed?.child || !managed.pid) return { closed: true, forced: false, pid: managed?.pid || null, durationMs: 0 };
  const started = performance.now(); let forced = false; let signalSent = false;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(managed.pid), '/T', '/F'], { stdio: 'ignore' }); signalSent = true; forced = true; } catch { /* fall through to child.kill */ }
  } else {
    signalSent = signalGroup(managed.pid, 'SIGTERM');
    if (!signalSent) { try { managed.child.kill('SIGTERM'); signalSent = true; } catch { /* already closed */ } }
  }
  try { await waitForChildClose(managed.child, graceMs); return { closed: true, forced, pid: managed.pid, durationMs: performance.now() - started, signalSent }; } catch { /* escalate below */ }
  forced = true;
  if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(managed.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } }
  else { signalGroup(managed.pid, 'SIGKILL'); try { managed.child.kill('SIGKILL'); } catch { /* already gone */ } }
  try { await waitForChildClose(managed.child, forceMs); } catch { /* report closed status below */ }
  return { closed: !processExists(managed.pid), forced, pid: managed.pid, durationMs: performance.now() - started, signalSent, timedOut: processExists(managed.pid) };
}

export function recentStderr(managed, limit = 2000) { return String(managed?.stderr || '').slice(-limit); }
