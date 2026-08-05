import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildChromiumLaunchArgs, listChromiumCandidates, resolveChromiumExecutable, validateChromiumExecutable } from './browser/chromium-resolver.mjs';
import { launchManagedBrowser, terminateManagedBrowser, waitForBrowserExit } from './browser/managed-browser-process.mjs';
import { launchManagedVerifierProcess, terminateManagedVerifierProcess, waitForExit } from './managed-verifier-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'screenshots/stage8-2E-A2-screenshot-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); };
const tempExe = (dir, name) => { const file = path.join(dir, name); fs.writeFileSync(file, '#!/bin/sh\nexit 0\n'); fs.chmodSync(file, 0o755); return file; };
const portClosed = (port) => new Promise((resolve) => { const socket = net.createConnection({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); });

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2E-A.2 收尾测试');
console.log('════════════════════════════════════════════');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-a2-test-'));
try {
  const explicit = tempExe(dir, 'explicit-chromium');
  await check('environment variable priority', () => { const result = resolveChromiumExecutable({ env: { IRON_COMMAND_CHROMIUM: explicit, PATH: '' }, platform: 'linux' }); assert.equal(result.executable, explicit); });
  await check('PATH chromium discovery', () => { const bin = path.join(dir, 'bin'); fs.mkdirSync(bin); const found = tempExe(bin, 'chromium'); const result = resolveChromiumExecutable({ env: { PATH: bin }, platform: 'linux' }); assert.equal(result.executable, found); });
  await check('macOS Chrome candidates', () => assert.ok(listChromiumCandidates({ env: { PATH: '' }, platform: 'darwin' }).includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')));
  await check('Windows Chrome candidates', () => assert.ok(listChromiumCandidates({ env: { PATH: '', PROGRAMFILES: 'C:/Program Files', 'PROGRAMFILES(X86)': 'C:/Program Files (x86)', LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, platform: 'win32' }).some((value) => value.endsWith('chrome.exe'))));
  await check('missing browser returns structured error', () => { const result = resolveChromiumExecutable({ env: { PATH: '' }, platform: 'win32' }); assert.equal(result.ok, false); assert.equal(result.code, 'chromium_not_found'); assert.ok(Array.isArray(result.checked)); });
  await check('executable validation accepts executable file', () => assert.equal(validateChromiumExecutable(explicit).ok, true));
  await check('executable validation rejects missing file', () => assert.equal(validateChromiumExecutable(path.join(dir, 'missing')).ok, false));
  await check('Linux root gets no-sandbox', () => assert.ok(buildChromiumLaunchArgs({ platform: 'linux', uid: 0 }).includes('--no-sandbox')));
  await check('Linux non-root does not get no-sandbox', () => assert.equal(buildChromiumLaunchArgs({ platform: 'linux', uid: 501 }).includes('--no-sandbox'), false));
  await check('disable-dev-shm-use is default', () => assert.ok(buildChromiumLaunchArgs({ platform: 'linux', uid: 501 }).includes('--disable-dev-shm-usage')));
  await check('extra args are parsed', () => assert.deepEqual(buildChromiumLaunchArgs({ extraArgs: '--window-size=800,600 --lang="zh-CN"' }).slice(-2), ['--window-size=800,600', '--lang=zh-CN']));
  await check('spawn failure is structured and handled', async () => { await assert.rejects(() => launchManagedBrowser({ executable: path.join(dir, 'missing-browser'), devtoolsTimeoutMs: 100 }), (error) => Boolean(error.code || error.message)); });

  const server = launchManagedVerifierProcess({ cwd: root, root });
  await server.ready;
  await check('managed verifier server starts on an ephemeral port', () => assert.ok(server.port > 0));
  await check('managed verifier server serves project root', async () => { const response = await fetch(`http://127.0.0.1:${server.port}/package.json`); assert.equal(response.status, 200); });
  const serverExit = await terminateManagedVerifierProcess(server, { termTimeoutMs: 3000, killTimeoutMs: 1000 });
  await check('SIGTERM server shutdown completes', () => assert.equal(serverExit.exited, true));
  await check('server port is released', async () => assert.equal(await portClosed(server.port), true));
  await check('already exited process does not wait forever', async () => { const result = await waitForExit(server, 20); assert.equal(result.exited, true); });

  await check('browser wait helper handles an exited process', async () => { const result = await waitForBrowserExit({ exitState: { exited: true, code: 0 } }, 20); assert.equal(result.exited, true); });
  await check('browser launch args include headless DevTools', () => { const args = buildChromiumLaunchArgs({}); assert.ok(args.includes('--headless=new')); assert.ok(args.includes('--remote-debugging-port=0')); });
  await check('managed browser module exports termination APIs', () => { assert.equal(typeof terminateManagedBrowser, 'function'); assert.equal(typeof waitForBrowserExit, 'function'); });
  await check('verifier source has bounded shutdown', () => { const source = fs.readFileSync(path.join(root, 'tests/managed-verifier-process.mjs'), 'utf8'); assert.match(source, /termTimeoutMs|SIGKILL|waitForExit/); });
  await check('browser source has navigation diagnostics', () => { const source = fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8'); assert.match(source, /document\.title|readyState|resources|httpServer/); });

  const screenshots = manifest.screenshots;
  await check('Manifest has 12 screenshots', () => assert.equal(screenshots.length, 12));
  await check('all screenshot SHAs are unique', () => assert.equal(new Set(screenshots.map((entry) => entry.pngSha256)).size, 12));
  await check('Manifest has reportResult fields', () => assert.ok(screenshots.every((entry) => ['victory', 'withdraw'].includes(entry.reportResult))));
  await check('victory screenshots are victory results', () => assert.ok(screenshots.filter((entry) => entry.reportId === manifest.battles.find((battle) => battle.reportResult === 'victory')?.reportId).every((entry) => entry.reportResult === 'victory')));
  const withdraw = screenshots.find((entry) => entry.file.endsWith('legacy-withdraw.png'));
  const victory = screenshots.find((entry) => entry.reportResult === 'victory');
  await check('withdraw evidence has independent battle id', () => assert.notEqual(withdraw.battleId, victory.battleId));
  await check('withdraw evidence has independent report id', () => assert.notEqual(withdraw.reportId, victory.reportId));
  await check('withdraw evidence is automatically legacy', () => { assert.equal(withdraw.renderedMode, 'legacy'); assert.ok(['auto', 'contract'].includes(withdraw.preference)); });
  await check('withdraw has exactly one retreat event', () => assert.equal(withdraw.retreatEventCount, 1));
  await check('withdraw has no capture', () => assert.equal(withdraw.capture, false));
  await check('withdraw has empty rewards', () => assert.deepEqual(withdraw.rewards, {}));
  await check('withdraw evidence has no victory-only DOM text', () => assert.doesNotMatch(withdraw.stateSignature, /首占奖励|目标已占领/));
  await check('mode legacy evidence remains victory', () => { const entry = screenshots.find((row) => row.file.endsWith('mode-legacy.png')); assert.equal(entry.reportResult, 'victory'); assert.equal(entry.preference, 'legacy'); });
  await check('legacy evidence classes are separated', () => assert.notEqual(screenshots.find((row) => row.file.endsWith('mode-legacy.png')).battleId, withdraw.battleId));
  await check('Canvas and state signatures exist', () => assert.ok(screenshots.every((entry) => entry.canvasSignature && entry.stateSignature)));
  await check('report fingerprints exist', () => assert.ok(screenshots.every((entry) => entry.reportFingerprint)));
  await check('withdraw returning evidence remains legacy', () => { const entry = screenshots.find((row) => row.file.endsWith('withdraw-returning.png')); assert.equal(entry.renderedMode, 'legacy'); assert.equal(entry.reportResult, 'withdraw'); });
  await check('base evidence has no active battle marker', () => { const entry = screenshots.find((row) => row.file.endsWith('base-after-return.png')); assert.equal(entry.activeBattleAfterReturn, false); });
  await check('browser errors arrays are empty', () => { const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); assert.deepEqual(data.errors, { pageErrors: [], consoleErrors: [] }); });
  await check('A.2 source uses managed resolver', () => { const source = fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8'); assert.match(source, /launchManagedBrowser/); assert.doesNotMatch(source, /\/Applications\/Google Chrome\.app/); });
  await check('A.2 source has real withdraw helper', () => assert.match(fs.readFileSync(path.join(root, 'tests/browser/formal-withdraw-evidence.mjs'), 'utf8'), /result === 'withdraw'/));
  await check('A.2 source never uses Playwright or Puppeteer', () => assert.doesNotMatch(fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8'), /playwright|puppeteer/i));
  await check('SAVE_VERSION remains seven', () => assert.match(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), /SAVE_VERSION\s*=\s*7|SAVE_VERSION:\s*7/));
  await check('formal boundary hash remains declared', () => { const boundary = JSON.parse(fs.readFileSync(path.join(root, 'tests/stage8-2E-A-1-boundary.json'), 'utf8')); assert.equal(boundary.formalBoundaryHash, '52a92e55dd5db9649af3fc049b4afc299f6f7084540bcf9abb973d62f1a2af8f'); });
  await check('all new JavaScript passes syntax check', () => { for (const file of ['tests/browser/chromium-resolver.mjs', 'tests/browser/managed-browser-process.mjs', 'tests/browser/formal-withdraw-evidence.mjs', 'tests/browser/formal-battle-evidence.mjs', 'tests/managed-verifier-process.mjs', 'tests/stage8-2E-A-2-test.mjs']) assert.equal(execFileSync(process.execPath, ['--check', file]).toString(), ''); });
  await check('manifest file hashes match PNG bytes', () => screenshots.forEach((entry) => assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'screenshots', entry.file))).digest('hex'), entry.pngSha256, entry.file)));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`stage8-2E-A-2-test: ${passed} passed / ${passed} total`);
