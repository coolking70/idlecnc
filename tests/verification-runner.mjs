import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

const DEFAULT_GLOBAL_TIMEOUT_MS = 900000;
const MIN_GLOBAL_TIMEOUT_MS = 60000;
const MAX_GLOBAL_TIMEOUT_MS = 1800000;
const DEFAULT_HEARTBEAT_MS = 30000;
const DEFAULT_STAGE_TIMEOUTS = Object.freeze({
  npm: 300000,
  node: 120000,
  crossProcess: 180000,
  browser: 120000,
  serverClose: 3000
});
const BASE_READY_TIMEOUT_MULTIPLIER = 1.25;
const MAX_READY_TIMEOUT_MULTIPLIER = 3;
const LOAD_NORMALIZATION_THRESHOLD = 0.75;
const LOAD_MULTIPLIER_SLOPE = 1.25;

const asPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

function configuredGlobalTimeout(value = process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS) {
  const parsed = asPositiveInteger(value);
  return parsed && parsed >= MIN_GLOBAL_TIMEOUT_MS && parsed <= MAX_GLOBAL_TIMEOUT_MS
    ? parsed
    : DEFAULT_GLOBAL_TIMEOUT_MS;
}

function killProcessGroup(child, signal) {
  if (!child?.pid) return false;
  try {
    return process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal);
  } catch {
    try { return child.kill(signal); } catch { return false; }
  }
}

function recent(value, limit = 12000) {
  return String(value || '').slice(-limit);
}

function stageName(stage) {
  return typeof stage === 'string' ? stage : stage.name || stage.label || 'unnamed stage';
}

function stageTimeout(runner, stage) {
  const value = typeof stage === 'object' && stage.timeoutMs;
  return value ?? runner.stageTimeouts[stage.kind || 'node'] ?? runner.stageTimeouts.node;
}

export function getVerificationLoadSnapshot() {
  const cpuInfo = os.cpus();
  const cpuCount = Math.max(1, cpuInfo.length || 1);
  const loadAverage = os.loadavg().map((value) => Number.isFinite(value) ? Number(value.toFixed(3)) : 0);
  const normalizedLoad1 = Number((loadAverage[0] / cpuCount).toFixed(3));
  const pressure = Math.max(0, normalizedLoad1 - LOAD_NORMALIZATION_THRESHOLD);
  const timeoutMultiplier = Number(Math.min(
    MAX_READY_TIMEOUT_MULTIPLIER,
    BASE_READY_TIMEOUT_MULTIPLIER + pressure * LOAD_MULTIPLIER_SLOPE
  ).toFixed(3));
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuCount,
    cpuModel: cpuInfo[0]?.model || 'unknown',
    loadAverage,
    normalizedLoad1,
    timeoutMultiplier,
  };
}

export function getAdaptiveTimeoutMs(requestedMs, load = getVerificationLoadSnapshot()) {
  const timeoutMs = asPositiveInteger(requestedMs) || 1;
  const multiplier = Number.isFinite(load?.timeoutMultiplier)
    ? Math.max(1, Math.min(MAX_READY_TIMEOUT_MULTIPLIER, load.timeoutMultiplier))
    : BASE_READY_TIMEOUT_MULTIPLIER;
  return Math.max(timeoutMs, Math.ceil(timeoutMs * multiplier));
}

function log(runner, line) {
  (runner.logger || console).log(line);
}

function errorLog(runner, line) {
  (runner.logger || console).error(line);
}

export function buildChildTestEnv(isolatedEnv = process.env) {
  const childEnv = { ...isolatedEnv };
  delete childEnv.IRON_COMMAND_VERIFY_TIMEOUT_MS;
  delete childEnv.IRON_COMMAND_VERIFY_STAGE_DELAY_MS;
  return childEnv;
}

function registerChild(runner, child, metadata = {}) {
  const record = { child, ...metadata };
  runner.activeChildren.set(child.pid, record);
  return record;
}

function unregisterChild(runner, child) {
  if (child?.pid) runner.activeChildren.delete(child.pid);
}

export function registerVerificationChild(runner, child, metadata = {}) {
  return registerChild(runner, child, metadata);
}

export function unregisterVerificationChild(runner, child) {
  unregisterChild(runner, child);
}

export function registerVerificationServer(runner, key, server) {
  const id = key || server?.pid || server?.child?.pid || `server-${runner.activeServers.size + 1}`;
  runner.activeServers.set(id, server);
  return id;
}

export function unregisterVerificationServer(runner, key) {
  runner.activeServers.delete(key);
}

export function createVerificationRunner(options = {}) {
  const startedAt = Date.now();
  const requestedGlobal = options.globalTimeoutMs ?? configuredGlobalTimeout();
  const globalTimeoutMs = asPositiveInteger(requestedGlobal) && requestedGlobal <= MAX_GLOBAL_TIMEOUT_MS
    ? requestedGlobal
    : DEFAULT_GLOBAL_TIMEOUT_MS;
  let rejectGlobalAbort;
  const globalAbortPromise = new Promise((_, reject) => { rejectGlobalAbort = reject; });
  // A runner may be created without ever entering a stage. Keep the deferred
  // abort promise observed so a later watchdog expiry cannot become unhandled.
  globalAbortPromise.catch(() => {});
  const runner = {
    startedAt,
    deadlineAt: startedAt + globalTimeoutMs,
    globalTimeoutMs,
    currentStage: null,
    activeChildren: new Map(),
    activeServers: new Map(),
    isolatedRoot: options.isolatedRoot || null,
    extractedRoot: options.extractedRoot || null,
    aborted: false,
    abortReason: null,
    stageResults: [],
    stageTimeouts: { ...DEFAULT_STAGE_TIMEOUTS, ...(options.stageTimeouts || {}) },
    adaptiveTimeouts: options.adaptiveTimeouts !== false,
    timeoutProfiles: new WeakMap(),
    timeoutObservations: [],
    stageDelayMs: asPositiveInteger(options.stageDelayMs ?? process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS) || 0,
    heartbeatMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    logger: options.logger || console,
    cleanupDone: false,
    timeoutCleanupPromise: null,
    globalTimer: null,
    abortController: new AbortController(),
    abortSignal: null,
    globalAbortPromise,
    rejectGlobalAbort
  };
  runner.abortSignal = runner.abortController.signal;
  runner.globalTimer = setTimeout(() => {
    const timedOutStage = runner.currentStage || 'none';
    requestVerificationAbort(runner, 'global_verification_timeout');
    runner.timeoutCleanupPromise = (async () => {
      await abortVerification(runner, 'global_verification_timeout');
      await cleanupVerificationRunner(runner);
      runner.timedOutStage = timedOutStage;
      errorLog(runner, `GLOBAL TIMEOUT currentStage=${timedOutStage} elapsed=${Date.now() - runner.startedAt}ms`);
      process.exitCode = 124;
    })().catch((error) => {
      errorLog(runner, `GLOBAL TIMEOUT CLEANUP FAILED ${error.stack || error}`);
      process.exitCode = 124;
    });
  }, globalTimeoutMs);
  runner.globalTimer.unref?.();
  return runner;
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode) return { code: child.exitCode, signal: child.signalCode };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => finish({ code: child.exitCode, signal: child.signalCode, timedOut: true }), timeoutMs);
    child.once('exit', (code, signal) => finish({ code, signal }));
    child.once('error', () => finish({ code: child.exitCode, signal: child.signalCode }));
  });
}

async function terminateChild(runner, record, termTimeoutMs = 1500, killTimeoutMs = 1000) {
  const child = record.child;
  let killedBySigkill = false;
  let final = await waitForChildExit(child, 0);
  if (final.timedOut) {
    killProcessGroup(child, 'SIGTERM');
    final = await waitForChildExit(child, termTimeoutMs);
  }
  if (final.timedOut) {
    killedBySigkill = true;
    killProcessGroup(child, 'SIGKILL');
    final = await waitForChildExit(child, killTimeoutMs);
  }
  unregisterChild(runner, child);
  return { ...final, killedBySigkill };
}

function commandSpec(stage) {
  if (typeof stage === 'function') return null;
  return stage.command ? stage : null;
}

function patternMatches(pattern, value) {
  if (!pattern) return false;
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.replace('g', '');
    return new RegExp(pattern.source, flags).test(value);
  }
  return String(value).includes(String(pattern));
}

function commandStageWallTimeout(runner, stage) {
  const profile = commandTimeoutProfile(runner, stage);
  if (profile.waitsForReady) {
    return profile.effectiveStartupTimeoutMs + profile.effectiveTimeoutMs;
  }
  return profile.effectiveTimeoutMs;
}

function commandTimeoutProfile(runner, stage) {
  const declaredTimeoutMs = stageTimeout(runner, stage);
  const declaredStartupTimeoutMs = asPositiveInteger(stage.startupTimeoutMs) || 5000;
  const waitsForReady = Boolean(stage?.readyPattern && stage.startTimeoutAfterReady);
  if (!waitsForReady || runner.adaptiveTimeouts === false) {
    return {
      waitsForReady,
      declaredTimeoutMs,
      declaredStartupTimeoutMs,
      effectiveTimeoutMs: declaredTimeoutMs,
      effectiveStartupTimeoutMs: declaredStartupTimeoutMs,
      load: null,
    };
  }
  const cached = runner.timeoutProfiles.get(stage);
  if (cached) return cached;
  const load = getVerificationLoadSnapshot();
  const profile = {
    waitsForReady,
    declaredTimeoutMs,
    declaredStartupTimeoutMs,
    effectiveTimeoutMs: getAdaptiveTimeoutMs(declaredTimeoutMs, load),
    effectiveStartupTimeoutMs: getAdaptiveTimeoutMs(declaredStartupTimeoutMs, load),
    load,
  };
  runner.timeoutProfiles.set(stage, profile);
  runner.timeoutObservations.push({
    stage: stageName(stage),
    declaredTimeoutMs,
    effectiveTimeoutMs: profile.effectiveTimeoutMs,
    declaredStartupTimeoutMs,
    effectiveStartupTimeoutMs: profile.effectiveStartupTimeoutMs,
    load,
  });
  return profile;
}

function structuredCauseCode(output) {
  const lines = String(output || '').split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const payload = JSON.parse(line);
      if (payload && payload.ok === false && typeof payload.code === 'string') return payload.code;
    } catch {}
  }
  return null;
}

async function executeCommandStage(runner, stage) {
  const name = stageName(stage);
  const profile = commandTimeoutProfile(runner, stage);
  const timeoutMs = profile.effectiveTimeoutMs;
  const startupTimeoutMs = profile.effectiveStartupTimeoutMs;
  const waitsForReady = profile.waitsForReady;
  const child = spawn(stage.command, stage.args || [], {
    cwd: stage.cwd,
    env: stage.env || process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = registerChild(runner, child, { stage: name });
  let stdout = '';
  let stderr = '';
  let readyAt = null;
  child.stdout?.on('data', (chunk) => { stdout = recent(stdout + chunk.toString(), 128 * 1024); process.stdout.write(chunk); });
  child.stderr?.on('data', (chunk) => { stderr = recent(stderr + chunk.toString(), 128 * 1024); process.stderr.write(chunk); });
  const result = await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let startupTimer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(startupTimer);
      fn(value);
    };
    const timeoutError = async (kind) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(startupTimer);
      const termination = await terminateChild(runner, record);
      const isStartup = kind === 'startup';
      const error = new Error(`${name} ${isStartup ? 'startup timeout' : `timeout after ${profile.declaredTimeoutMs}ms`}\nstage=${name}\npid=${child.pid}\nkilledBySigkill=${termination.killedBySigkill}\nfinalCode=${termination.code}\nfinalSignal=${termination.signal}\nready=${Boolean(readyAt)}\ndeclaredTimeoutMs=${profile.declaredTimeoutMs}\neffectiveTimeoutMs=${timeoutMs}\ndeclaredStartupTimeoutMs=${profile.declaredStartupTimeoutMs}\neffectiveStartupTimeoutMs=${startupTimeoutMs}\nrecent stdout:\n${recent(stdout)}\nrecent stderr:\n${recent(stderr)}`);
      error.code = isStartup ? 'verification_stage_startup_timeout' : 'verification_stage_timeout';
      error.stage = name;
      error.pid = child.pid;
      error.timeoutMs = profile.declaredTimeoutMs;
      error.effectiveTimeoutMs = timeoutMs;
      error.startupTimeoutMs = profile.declaredStartupTimeoutMs;
      error.effectiveStartupTimeoutMs = startupTimeoutMs;
      error.timeoutLoad = profile.load;
      error.stdout = stdout;
      error.stderr = stderr;
      error.killedBySigkill = termination.killedBySigkill;
      reject(error);
    };
    const startBusinessTimer = () => {
      if (timer || settled) return;
      timer = setTimeout(() => { timeoutError('business'); }, timeoutMs);
    };
    const inspectReady = () => {
      if (!waitsForReady || readyAt || !patternMatches(stage.readyPattern, `${stdout}\n${stderr}`)) return;
      readyAt = Date.now();
      record.readyAt = readyAt;
      clearTimeout(startupTimer);
      startupTimer = null;
      startBusinessTimer();
    };
    const onStdout = (chunk) => {
      stdout = recent(stdout + chunk.toString(), 128 * 1024);
      process.stdout.write(chunk);
      inspectReady();
    };
    const onStderr = (chunk) => {
      stderr = recent(stderr + chunk.toString(), 128 * 1024);
      process.stderr.write(chunk);
      inspectReady();
    };
    child.stdout?.removeAllListeners('data');
    child.stderr?.removeAllListeners('data');
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    if (waitsForReady) {
      startupTimer = setTimeout(() => { timeoutError('startup'); }, startupTimeoutMs);
    } else {
      startBusinessTimer();
    }
    child.once('error', (error) => finish(reject, Object.assign(new Error(`${name} spawn failed: ${error.message}`), { cause: error, causeCode: error.code, stage: name, pid: child.pid, stdout, stderr })));
    child.once('exit', (code, signal) => finish(resolve, { code, signal, stdout, stderr, pid: child.pid, readyAt, startupDurationMs: readyAt ? readyAt - runner.startedAt : null }));
  });
  unregisterChild(runner, child);
  if (result.code !== 0) {
    const error = new Error(`${name} failed code=${result.code} signal=${result.signal}\nrecent stdout:\n${recent(stdout)}\nrecent stderr:\n${recent(stderr)}`);
    Object.assign(error, { code: result.code ?? 1, signal: result.signal, stage: name, pid: result.pid, stdout, stderr, causeCode: structuredCauseCode(`${stdout}\n${stderr}`), killedBySigkill: false });
    throw error;
  }
  return result;
}

async function heartbeat(runner, stage, promise) {
  if (!runner.heartbeatMs || runner.heartbeatMs <= 0) return promise;
  const timer = setInterval(() => {
    const remaining = Math.max(0, runner.deadlineAt - Date.now());
    log(runner, `HEARTBEAT\nstage=${stageName(stage)}\nelapsed=${Math.round((Date.now() - runner.startedAt) / 1000)}s\nremaining=${Math.round(remaining / 1000)}s\npid=${[...runner.activeChildren.keys()][0] || 'none'}`);
  }, runner.heartbeatMs);
  try { return await promise; } finally { clearInterval(timer); }
}

function withStageTimeout(runner, stage, promise) {
  const name = stageName(stage);
  const timeoutMs = commandSpec(stage) ? commandStageWallTimeout(runner, stage) : stageTimeout(runner, stage);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      await abortVerification(runner, 'stage_timeout');
      reject(Object.assign(new Error(`${name} timeout after ${timeoutMs}ms`), { code: 'verification_stage_timeout', stage: name, timeoutMs }));
    }, timeoutMs);
  });
  const globalAbort = runner.globalAbortPromise.catch((error) => { throw error; });
  return Promise.race([promise, timeout, globalAbort]).finally(() => clearTimeout(timer));
}

export async function runVerificationStage(runner, stage) {
  if (runner.aborted) throw Object.assign(new Error(`verification aborted: ${runner.abortReason}`), { code: runner.abortReason });
  const name = stageName(stage);
  const timeoutProfile = commandSpec(stage) ? commandTimeoutProfile(runner, stage) : null;
  runner.currentStage = name;
  if (runner.stageDelayMs) await new Promise((resolve) => setTimeout(resolve, runner.stageDelayMs));
  const startedAt = Date.now();
  log(runner, `START ${name}`);
  if (timeoutProfile?.load) log(runner, `TIMEOUT_PROFILE ${JSON.stringify(timeoutProfile)}`);
  try {
    const spec = commandSpec(stage);
    const stagePromise = spec ? executeCommandStage(runner, stage) : stage.run(runner);
    const result = await heartbeat(runner, stage, withStageTimeout(runner, stage, stagePromise));
    const record = {
      stage: name,
      status: 'passed',
      durationMs: Date.now() - startedAt,
      exitCode: result?.code ?? 0,
      ...(timeoutProfile?.load ? { timeoutProfile } : {}),
    };
    runner.stageResults.push(record);
    log(runner, `PASS ${name} duration=${(record.durationMs / 1000).toFixed(2)}s`);
    return result;
  } catch (error) {
    const record = {
      stage: name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      exitCode: error.code ?? 1,
      causeCode: error.causeCode,
      error: error.message,
      ...(timeoutProfile?.load ? { timeoutProfile } : {}),
    };
    runner.stageResults.push(record);
    errorLog(runner, `FAIL ${name}\ncode=${record.exitCode}\nduration=${(record.durationMs / 1000).toFixed(2)}s`);
    throw error;
  } finally {
    runner.currentStage = null;
  }
}

export async function abortVerification(runner, reason = 'aborted') {
  requestVerificationAbort(runner, reason);
  const children = [...runner.activeChildren.values()];
  const servers = [...runner.activeServers.values()];
  await Promise.allSettled(children.map((record) => terminateChild(runner, record)));
  await Promise.allSettled(servers.map(async (server) => {
    if (typeof server?.terminate === 'function') return server.terminate();
    if (typeof server?.close === 'function') return new Promise((resolve) => server.close(resolve));
    if (server?.child) return terminateChild(runner, { child: server.child });
    return undefined;
  }));
  runner.activeServers.clear();
}

export function requestVerificationAbort(runner, reason = 'aborted') {
  if (!runner.aborted) {
    runner.aborted = true;
    runner.abortReason = reason;
    try { runner.abortController.abort(reason); } catch {}
    if (reason === 'global_verification_timeout') {
      runner.rejectGlobalAbort?.(Object.assign(new Error(`verification aborted: ${reason}`), { code: reason }));
    }
  } else {
    runner.abortReason ||= reason;
  }
  return runner.abortReason;
}

export async function cleanupVerificationRunner(runner) {
  if (runner.cleanupDone) return;
  runner.cleanupDone = true;
  if (runner.globalTimer) clearTimeout(runner.globalTimer);
  if (runner.activeChildren.size || runner.activeServers.size) await abortVerification(runner, runner.abortReason || 'cleanup');
  for (const target of [runner.extractedRoot, runner.isolatedRoot]) {
    if (target) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch (error) { errorLog(runner, `cleanup failed ${target}: ${error.message}`); }
    }
  }
}

export function collectTestSummary(outputs) {
  const text = Array.isArray(outputs) ? outputs.join('\n') : String(outputs || '');
  const summary = {};
  const pattern = /^([\w.-]+):\s+(\d+)\s+passed\s+\/\s+(\d+)\s+total$/gm;
  for (const match of text.matchAll(pattern)) summary[match[1]] = { passed: Number(match[2]), total: Number(match[3]) };
  return summary;
}

export const verificationTimeouts = Object.freeze({ DEFAULT_GLOBAL_TIMEOUT_MS, MIN_GLOBAL_TIMEOUT_MS, MAX_GLOBAL_TIMEOUT_MS, ...DEFAULT_STAGE_TIMEOUTS });
