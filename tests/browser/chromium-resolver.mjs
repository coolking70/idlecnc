import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const EXPLICIT_ENV = ['IRON_COMMAND_CHROMIUM', 'CHROME_BIN', 'CHROMIUM_BIN'];
const PATH_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function homeCandidates(platform = process.platform) {
  const home = os.homedir();
  if (platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    path.join(home, 'Applications/Chromium.app/Contents/MacOS/Chromium')
  ];
  if (platform === 'win32') {
    const roots = unique([process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]);
    return roots.flatMap((root) => [
      path.join(root, 'Google/Chrome/Application/chrome.exe'),
      path.join(root, 'Chromium/Application/chrome.exe'),
      path.join(root, 'Microsoft/Edge/Application/msedge.exe')
    ]);
  }
  return [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chrome', '/snap/bin/chromium',
    path.join(home, '.local/bin/chromium')
  ];
}

export function validateChromiumExecutable(file) {
  if (!file) return { ok: false, file: file || null, reason: 'empty_path' };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { ok: false, file, reason: 'not_a_file' };
    fs.accessSync(file, fs.constants.X_OK);
    return { ok: true, file };
  } catch (error) {
    return { ok: false, file, reason: error.code || error.message || 'not_executable' };
  }
}

function resolveFromPath(name, env = process.env) {
  try {
    const result = execFileSync('which', [name], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return result || null;
  } catch {
    return null;
  }
}

export function listChromiumCandidates(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const candidates = [];
  for (const key of EXPLICIT_ENV) if (env[key]) candidates.push(env[key]);
  for (const name of PATH_NAMES) candidates.push(resolveFromPath(name, env) || name);
  candidates.push(...homeCandidates(platform));
  return unique(candidates);
}

export function resolveChromiumExecutable(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const checked = [];
  for (const candidate of listChromiumCandidates({ ...options, env, platform })) {
    const result = validateChromiumExecutable(candidate);
    checked.push({ path: candidate, ...result });
    if (result.ok) return { ok: true, executable: candidate, checked, platform, arch: options.arch || process.arch };
  }
  return { ok: false, code: 'chromium_not_found', checked, platform, arch: options.arch || process.arch };
}

export function buildChromiumLaunchArgs(options = {}) {
  const args = [
    '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0'
  ];
  if (options.userDataDir) args.push(`--user-data-dir=${options.userDataDir}`);
  if ((options.platform || process.platform) === 'linux' && (options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : null)) === 0) args.push('--no-sandbox');
  const extra = options.extraArgs ?? ((options.env || process.env).IRON_COMMAND_CHROMIUM_EXTRA_ARGS || '');
  if (Array.isArray(extra)) args.push(...extra);
  else if (typeof extra === 'string' && extra.trim()) args.push(...extra.match(/(?:[^\s"]+|"[^"]*")+/g).map((value) => value.replace(/^"|"$/g, '')));
  return args;
}

export { EXPLICIT_ENV, PATH_NAMES };
