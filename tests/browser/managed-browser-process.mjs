import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getJson, waitForWebSocket } from './cdp-client.mjs';
import { buildChromiumLaunchArgs, resolveChromiumExecutable } from './chromium-resolver.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recentBuffer(limit = 12000) {
  let value = '';
  return {
    push(chunk) { value = (value + String(chunk)).slice(-limit); },
    get value() { return value; }
  };
}

function waitForDevTools(stderr, buffer, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { cleanup(); reject(new Error(`DevTools startup timeout (${timeoutMs}ms), stderr=${buffer.value}`)); }, timeoutMs);
    const onData = (chunk) => {
      text += chunk.toString(); buffer.push(chunk);
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { cleanup(); resolve(match[1]); }
    };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); stderr.off('data', onData); stderr.off('error', onError); };
    stderr.on('data', onData); stderr.on('error', onError);
  });
}

function waitForExitInternal(browser, timeoutMs = 3000) {
  if (browser.exitState?.exited) return Promise.resolve(browser.exitState);
  return Promise.race([
    browser.exitPromise,
    new Promise((resolve) => setTimeout(() => resolve({ exited: false, timedOut: true, pid: browser.child.pid }), timeoutMs))
  ]);
}

export async function launchManagedBrowser(config = {}) {
  const resolution = config.executable
    ? { ok: true, executable: config.executable, checked: [] }
    : resolveChromiumExecutable({ env: config.env, platform: config.platform, arch: config.arch });
  if (!resolution.ok) {
    const error = new Error(`chromium_not_found checked=${resolution.checked.map((row) => row.path).join(', ')}`);
    error.code = resolution.code;
    error.diagnostics = resolution;
    throw error;
  }

  const profileDir = config.userDataDir || await fs.mkdtemp(path.join(config.tempDir || os.tmpdir(), 'iron-command-chromium-'));
  const args = buildChromiumLaunchArgs({
    ...config, userDataDir: profileDir,
    platform: config.platform || process.platform,
    env: config.env || process.env
  });
  args.push(config.url || 'about:blank');
  const child = spawn(resolution.executable, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...(config.env || {}) }
  });
  const stderr = recentBuffer();
  const exitState = { exited: false, code: null, signal: null, error: null, pid: child.pid };
  let resolveExit;
  const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
  let rejectStartup;
  const startupError = new Promise((_, reject) => { rejectStartup = reject; });
  const browser = { child, executable: resolution.executable, args, profileDir, stderr, exitState, exitPromise, devtools: null };
  child.stderr?.on('data', (chunk) => stderr.push(chunk));
  // Register these listeners immediately: failed spawn must never become an unhandled error event.
  child.once('error', (error) => {
    exitState.error = error;
    rejectStartup(error);
    if (!exitState.exited) { exitState.exited = true; exitState.code = null; exitState.signal = null; resolveExit(exitState); }
  });
  child.once('exit', (code, signal) => {
    exitState.exited = true; exitState.code = code; exitState.signal = signal; resolveExit(exitState);
  });

  try {
    const browserWs = await Promise.race([
      waitForDevTools(child.stderr, stderr, config.devtoolsTimeoutMs || 15000),
      startupError
    ]);
    const devtoolsPort = new URL(browserWs).port;
    const version = await getJson(`http://127.0.0.1:${devtoolsPort}/json/version`);
    const browserSocket = await waitForWebSocket(version.webSocketDebuggerUrl, 5000);
    browser.devtools = { browserWs, devtoolsPort: Number(devtoolsPort), version, browserSocket };
    return browser;
  } catch (error) {
    error.browser = { executable: resolution.executable, args, stderr: stderr.value, code: exitState.code, signal: exitState.signal };
    await terminateManagedBrowser(browser, { termTimeoutMs: 500, killTimeoutMs: 500 });
    throw error;
  }
}

export async function waitForBrowserExit(browser, timeoutMs = 3000) {
  return waitForExitInternal(browser, timeoutMs);
}

function sendSignal(browser, signal) {
  const pid = browser?.child?.pid;
  if (!pid) return false;
  try {
    if (process.platform === 'win32') return browser.child.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
    return process.kill(-pid, signal);
  } catch {
    try { return browser.child.kill(signal); } catch { return false; }
  }
}

export async function terminateManagedBrowser(browser, options = {}) {
  if (!browser) return { exited: true, cleaned: true };
  const termTimeoutMs = options.termTimeoutMs ?? 3000;
  const killTimeoutMs = options.killTimeoutMs ?? 1000;
  const cleanupProfile = options.cleanupProfile !== false;
  let exit = await waitForExitInternal(browser, 0);
  if (!exit.exited) {
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(browser.child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else sendSignal(browser, 'SIGTERM');
    exit = await waitForExitInternal(browser, termTimeoutMs);
  }
  if (!exit.exited) {
    sendSignal(browser, 'SIGKILL');
    exit = await waitForExitInternal(browser, killTimeoutMs);
  }
  if (browser.devtools?.browserSocket) { try { browser.devtools.browserSocket.close(); } catch {} }
  if (cleanupProfile && browser.profileDir) await fs.rm(browser.profileDir, { recursive: true, force: true }).catch(() => {});
  return { ...exit, cleaned: !browser.profileDir || !(await fs.stat(browser.profileDir).catch(() => null)) };
}
