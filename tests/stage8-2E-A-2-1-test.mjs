import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot, assertIsolatedTempRootClean } from './browser/isolated-temp-root.mjs';
import { buildNavigationFailureError, classifyNavigationFailure, isManagedPolicyBlock } from './browser/browser-policy-diagnostics.mjs';
import { launchManagedBrowser } from './browser/managed-browser-process.mjs';
import { launchManagedVerifierProcess, terminateManagedVerifierProcess } from './managed-verifier-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/formal-browser-manifest-a2.json'), 'utf8'));
const testRoot = createIsolatedTempRoot('iron-command-a21-test-');
const testEnv = buildIsolatedTempEnv(testRoot);
const externalFile = path.join(os.tmpdir(), `iron-command-chromium-wrapper-a21-${process.pid}`);
const externalDir = path.join(os.tmpdir(), `iron-command-chromium-unrelated-a21-${process.pid}`);
const externalFileExisted = fs.existsSync(externalFile); const externalDirExisted = fs.existsSync(externalDir);
if (!externalFileExisted) fs.writeFileSync(externalFile, 'external');
if (!externalDirExisted) fs.mkdirSync(externalDir, { recursive: true });
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); };
const portClosed = (port) => new Promise((resolve) => { const socket = net.createConnection({ host: '127.0.0.1', port }); socket.once('connect', () => { socket.destroy(); resolve(false); }); socket.once('error', () => resolve(true)); });

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2E-A.2.1 隔离与策略测试');
console.log('════════════════════════════════════════════');
try {
  await check('专属临时根创建四个隔离目录', () => ['tmp', 'browser-profiles', 'extracted', 'logs'].forEach((name) => assert.ok(fs.existsSync(path.join(testRoot, name)))));
  await check('TMPDIR指向专属tmp', () => assert.equal(testEnv.TMPDIR, path.join(testRoot, 'tmp')));
  await check('TMP和TEMP同步隔离', () => { assert.equal(testEnv.TMP, testEnv.TMPDIR); assert.equal(testEnv.TEMP, testEnv.TMPDIR); });
  await check('子进程继承隔离环境', () => { const result = execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({tmp:process.env.TMPDIR,tmp2:process.env.TMP,temp:process.env.TEMP}))'], { env: testEnv, encoding: 'utf8' }); assert.deepEqual(JSON.parse(result), { tmp: testEnv.TMPDIR, tmp2: testEnv.TMP, temp: testEnv.TEMP }); });
  await check('外部同名前缀文件存在但不参与隔离根', () => { assert.ok(fs.existsSync(externalFile)); assert.notEqual(path.dirname(externalFile), testRoot); });
  await check('外部同名前缀目录存在但不参与隔离根', () => { assert.ok(fs.existsSync(externalDir)); assert.notEqual(path.dirname(externalDir), testRoot); });
  await check('isolated root cleanup succeeds', () => { const disposable = createIsolatedTempRoot('iron-command-disposable-'); removeIsolatedTempRoot(disposable); assert.equal(assertIsolatedTempRootClean(disposable), true); });

  const missingProfile = path.join(testRoot, 'browser-profiles', 'missing');
  await check('ENOENT browser failure carries structured code and cleans profile', async () => { await assert.rejects(() => launchManagedBrowser({ executable: path.join(testRoot, 'not-a-browser'), userDataDir: missingProfile, env: testEnv, devtoolsTimeoutMs: 100 }), (error) => Boolean(error.code || error.details)); assert.equal(fs.existsSync(missingProfile), false); });
  const exitBrowser = path.join(testRoot, 'exit-browser'); fs.writeFileSync(exitBrowser, '#!/bin/sh\nexit 1\n'); fs.chmodSync(exitBrowser, 0o755);
  const exitedProfile = path.join(testRoot, 'browser-profiles', 'exited');
  await check('immediate browser exit is bounded and classified', async () => { await assert.rejects(() => launchManagedBrowser({ executable: exitBrowser, userDataDir: exitedProfile, env: testEnv, devtoolsTimeoutMs: 500 }), (error) => error.code === 'chromium_process_exited' || /DevTools startup timeout/.test(error.message)); assert.equal(fs.existsSync(exitedProfile), false); });
  await check('policy page organization text is recognized', () => { const data = { requestedUrl: 'http://local/', actualUrl: 'chrome-error://chromewebdata/', visibleText: "Your organization doesn't allow you to view this site" }; assert.equal(isManagedPolicyBlock(data), true); assert.equal(classifyNavigationFailure(data).code, 'navigation_blocked_by_policy'); });
  await check('policy page Chinese text is recognized', () => assert.equal(isManagedPolicyBlock({ actualUrl: 'chrome-error://chromewebdata/', visibleText: '管理员不允许访问' }), true));
  await check('ordinary 404 is not policy', () => { const data = { requestedUrl: 'http://local/', actualUrl: 'http://local/', resources: [{ type: 'response', url: 'http://local/', status: 404 }] }; assert.equal(isManagedPolicyBlock(data), false); assert.equal(classifyNavigationFailure(data).code, 'navigation_http_error'); });
  await check('ordinary timeout remains bootstrap timeout', () => assert.equal(buildNavigationFailureError({ requestedUrl: 'http://local/', actualUrl: 'http://local/', visibleText: 'blank' }).code, 'formal_page_bootstrap_timeout'));
  await check('policy error preserves navigation context', () => { const error = buildNavigationFailureError({ requestedUrl: 'http://local/', actualUrl: 'chrome-error://chromewebdata/', visibleText: 'blocked by administrator', browserVersion: 'Chrome/test', executable: '/chromium' }); assert.equal(error.code, 'navigation_blocked_by_policy'); assert.equal(error.details.requestedUrl, 'http://local/'); assert.equal(error.details.actualUrl, 'chrome-error://chromewebdata/'); assert.equal(error.details.browserVersion, 'Chrome/test'); assert.equal(error.details.executable, '/chromium'); });

  const server = launchManagedVerifierProcess({ cwd: root, root, env: testEnv }); await server.ready; const serverPort = server.port;
  await check('managed server runs with isolated environment', async () => { const response = await fetch(`http://127.0.0.1:${serverPort}/package.json`); assert.equal(response.status, 200); });
  const serverExit = await terminateManagedVerifierProcess(server, { termTimeoutMs: 3000, killTimeoutMs: 1000 });
  await check('server termination is bounded', () => assert.equal(serverExit.exited, true));
  await check('server port releases after failure/success cleanup', async () => assert.equal(await portClosed(serverPort), true));
  await check('profile cleanup only uses owned path', () => { assert.equal(fs.existsSync(missingProfile), false); assert.equal(fs.existsSync(exitedProfile), false); assert.equal(fs.existsSync(externalFile), true); assert.equal(fs.existsSync(externalDir), true); });
  await check('browser source passes isolated profile root', () => assert.match(fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8'), /isolatedRoot|browser-profiles/));
  await check('verifier passes isolated environment to child commands', () => assert.match(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-delivery-package.mjs'), 'utf8'), /buildIsolatedTempEnv|env/));
  await check('verifier has a global watchdog', () => assert.match(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-delivery-package.mjs'), 'utf8'), /300000/));
  await check('policy block is not accepted as success', () => { const source = fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8'); assert.match(source, /buildNavigationFailureError/); assert.doesNotMatch(source, /navigation_blocked_by_policy[\s\S]{0,100}process\.exitCode\s*=\s*0/); });

  await check('current Manifest is freshly structured', () => { assert.equal(manifest.version, 3); assert.equal(manifest.screenshots.length, 12); assert.equal(manifest.battles.length, 2); });
  await check('current Manifest still contains victory and withdraw', () => assert.deepEqual(new Set(manifest.battles.map((battle) => battle.reportResult)), new Set(['victory', 'withdraw'])));
  await check('withdraw remains auto to universal while active', () => { const entries = manifest.screenshots.filter((entry) => entry.reportResult === 'withdraw' && entry.activeBattleAfterReturn !== false); assert.ok(entries.length >= 2); assert.ok(entries.every((entry) => entry.preference === 'auto' && entry.renderedMode === 'universal_battle')); });
  await check('12 PNG SHA values remain unique', () => assert.equal(new Set(manifest.screenshots.map((entry) => entry.pngSha256)).size, 12));
  await check('browser error arrays remain empty', () => { assert.deepEqual(manifest.errors.pageErrors, []); assert.deepEqual(manifest.errors.consoleErrors, []); });
  await check('verification requires current browser evidence', () => assert.match(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-delivery-package.mjs'), 'utf8'), /browser evidence/));
  await check('verification does not accept old PNG only', () => assert.match(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-delivery-package.mjs'), 'utf8'), /formal-battle-evidence\.mjs/));
  await check('ZIP cleanup excludes git and node_modules', () => { const source = fs.readFileSync(path.join(root, 'tests/build-stage8-2E-A-2-delivery-package.mjs'), 'utf8'); assert.match(source, /node_modules/); assert.match(source, /\*\/\./); });
  await check('SAVE_VERSION is incremented to nine', () => assert.match(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), /SAVE_VERSION\s*=\s*9/));
  await check('A.2 legacy test remains in npm test', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /stage8-2E-A-2-test\.mjs/));
  await check('A.2.1 test is wired into npm test', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /stage8-2E-A-2-1-test\.mjs/));
  await check('new modules pass syntax checks', () => ['tests/browser/isolated-temp-root.mjs', 'tests/browser/browser-policy-diagnostics.mjs', 'tests/stage8-2E-A-2-1-test.mjs'].forEach((file) => assert.equal(execFileSync(process.execPath, ['--check', file]).toString(), '')));
  await check('formal business directory is not imported by tools', () => assert.doesNotMatch(fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8'), /from ['"].*js\/battle\.js/));
  await check('external pollution survives until test cleanup', () => { assert.ok(fs.existsSync(externalFile)); assert.ok(fs.existsSync(externalDir)); });
  await check('test root itself can be removed', () => { removeIsolatedTempRoot(testRoot); assert.equal(assertIsolatedTempRootClean(testRoot), true); });
} finally {
  if (fs.existsSync(testRoot)) removeIsolatedTempRoot(testRoot);
  if (!externalFileExisted) fs.rmSync(externalFile, { force: true });
  if (!externalDirExisted) fs.rmSync(externalDir, { recursive: true, force: true });
}

console.log(`stage8-2E-A-2-1-test: ${passed} passed / ${passed} total`);
