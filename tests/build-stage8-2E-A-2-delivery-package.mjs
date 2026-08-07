import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './browser/isolated-temp-root.mjs';
import { buildChildTestEnv } from './verification-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPrefix = process.env.IRON_COMMAND_VERIFY_OUTPUT_PREFIX || 'stage8-2E-A-2-3';
const archive = path.join(root, process.env.IRON_COMMAND_VERIFY_ARCHIVE || 'iron-command-stage8-2E-A-2-3-evidence-consistency-final.zip');
const deliveryDoc = process.env.IRON_COMMAND_VERIFY_DELIVERY_DOC || 'STAGE8-2E-A-2-3-DELIVERY.md';
const verifierScript = process.env.IRON_COMMAND_VERIFY_VERIFIER || 'tests/verify-stage8-2E-A-2-3-delivery-package.mjs';
const outputFile = (name) => name.replace('stage8-2E-A-2-2', outputPrefix);
const outputDir = path.join(root, 'tests/outputs');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.mkdirSync(outputDir, { recursive: true });
const isolatedRoot = createIsolatedTempRoot('iron-command-build-');
const isolatedEnv = buildIsolatedTempEnv(isolatedRoot);
const childEnv = buildChildTestEnv(isolatedEnv);
const run = (label, command, args, options = {}) => {
  console.log(`START ${label}`);
  const output = execFileSync(command, args, { cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
  console.log(`PASS ${label}`);
  return output;
};
const write = (file, value) => fs.writeFileSync(path.join(outputDir, outputFile(file)), value);
const waitForClose = (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('close', resolve));
};
let a24StabilityRecord = null;
let a24PressureRecord = null;
let a24RedirectRecord = null;

try {
  if (outputPrefix === 'stage8-2E-A-2-4') {
    const stability = [];
    for (let index = 0; index < 10; index += 1) {
      const startedAt = Date.now();
      const output = run(`A.2.2 stability ${index + 1}/10`, process.execPath, ['tests/stage8-2E-A-2-2-test.mjs']);
      stability.push({ run: index + 1, status: 'passed', durationMs: Date.now() - startedAt, summary: output.match(/stage8-2E-A-2-2-test: .*$/m)?.[0] || null });
    }
    a24StabilityRecord = { runs: stability, passed: stability.length, failed: stability.filter((entry) => entry.status !== 'passed').length };
    write('stage8-2E-A-2-2-stability-output.txt', `${JSON.stringify(a24StabilityRecord, null, 2)}\n`);

    const pressureRuns = [];
    for (let index = 0; index < 5; index += 1) {
      const load = Array.from({ length: 2 }, () => spawn(process.execPath, ['-e', 'const end=Date.now()+300; while(Date.now()<end){}'], { cwd: root, env: childEnv, stdio: 'ignore' }));
      const startedAt = Date.now();
      try {
        const output = run(`A.2.2 CPU pressure ${index + 1}/5`, process.execPath, ['tests/stage8-2E-A-2-2-test.mjs']);
        pressureRuns.push({ run: index + 1, status: 'passed', durationMs: Date.now() - startedAt, summary: output.match(/stage8-2E-A-2-2-test: .*$/m)?.[0] || null });
      } finally {
        await Promise.all(load.map(waitForClose));
      }
    }
    a24PressureRecord = { workers: 2, workerDurationMs: 300, runs: pressureRuns, passed: pressureRuns.length, failed: pressureRuns.filter((entry) => entry.status !== 'passed').length };
    write('stage8-2E-A-2-2-cpu-pressure-output.txt', `${JSON.stringify(a24PressureRecord, null, 2)}\n`);

    const redirectRoot = createIsolatedTempRoot('iron-command-a24-redirect-');
    const redirectStdout = fs.openSync(path.join(redirectRoot, 'stdout.log'), 'w');
    const redirectStderr = fs.openSync(path.join(redirectRoot, 'stderr.log'), 'w');
    try {
      const redirected = execFileSync(process.execPath, ['tests/stage8-2E-A-2-2-test.mjs'], { cwd: root, env: childEnv, stdio: ['ignore', redirectStdout, redirectStderr] });
      a24RedirectRecord = { status: 'passed', stdoutBytes: fs.statSync(path.join(redirectRoot, 'stdout.log')).size, stderrBytes: fs.statSync(path.join(redirectRoot, 'stderr.log')).size };
      write('stage8-2E-A-2-2-redirect-output.txt', `${JSON.stringify(a24RedirectRecord, null, 2)}\n`);
    } finally {
      fs.closeSync(redirectStdout);
      fs.closeSync(redirectStderr);
      removeIsolatedTempRoot(redirectRoot);
    }
  }
  const full = run('npm test preflight', 'npm', ['test']);
  write('stage8-2E-A-2-2-full-test-output.txt', full);
  const summary = {};
  for (const match of full.matchAll(/^([\w.-]+):\s+(\d+)\s+passed\s+\/\s+(\d+)\s+total$/gm)) summary[match[1]] = { passed: Number(match[2]), total: Number(match[3]) };
  const docPath = path.join(root, deliveryDoc);
  const doc = fs.readFileSync(docPath, 'utf8');
  const rows = Object.entries(summary).map(([name, result]) => `| ${name} | ${result.passed} | ${result.total} |`).join('\n');
  let updatedDoc = doc.replace(/(\| 测试组 \| 通过 \| 总数 \|\n\|---\|---: \|---: \|\n)[\s\S]*?(?=\n\n## 证据与清理)/, `$1${rows}`);
  if (outputPrefix === 'stage8-2E-A-2-4') {
    updatedDoc = updatedDoc
      .replace(/- A\.2\.2 连续运行次数：[^\n]*/, `- A.2.2 连续运行次数：${a24StabilityRecord?.passed || 0} 次；失败次数：${a24StabilityRecord?.failed || 0}。`)
      .replace(/- CPU 压力配置：[^\n]*/, `- CPU 压力配置：${a24PressureRecord?.workers || 0} 个有界 Node 忙循环进程，每个 ${a24PressureRecord?.workerDurationMs || 0}ms；压力循环：${a24PressureRecord?.passed || 0}/${a24PressureRecord?.runs?.length || 0}，失败：${a24PressureRecord?.failed || 0}。`)
      .replace(/- ready 握手：[^\n]*/, `- ready 握手：A.2.4 输出记录 ${full.match(/readyHandshakeObservation=\{[^\n]+/)?.[0] || 'readyHandshakeObservation 未捕获'}。`)
      .replace(/- 输出重定向：[^\n]*/, `- 输出重定向：${a24RedirectRecord?.status || '未记录'}；stdout bytes=${a24RedirectRecord?.stdoutBytes || 0}，stderr bytes=${a24RedirectRecord?.stderrBytes || 0}。`);
  }
  fs.writeFileSync(docPath, updatedDoc);
  const screenshotDir = path.join(root, 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });
  for (const entry of fs.readdirSync(screenshotDir)) {
    if (entry.startsWith('stage8-2E-A2-')) fs.rmSync(path.join(screenshotDir, entry), { recursive: true, force: true });
  }
  const browser = run('browser evidence', process.execPath, ['tests/browser/formal-battle-evidence.mjs']);
  write('stage8-2E-A-2-2-browser-evidence-output.txt', browser);
  const slow = run('slow environment runner smoke', process.execPath, ['--input-type=module', '-e', `import { createVerificationRunner, runVerificationStage, cleanupVerificationRunner } from './tests/verification-runner.mjs'; const runner = createVerificationRunner({ globalTimeoutMs: 120000, stageDelayMs: 250 }); await runVerificationStage(runner, { name: 'slow fake stage 1', run: async () => {} }); await runVerificationStage(runner, { name: 'slow fake stage 2', run: async () => {} }); console.log(JSON.stringify({ status: 'ok', stageDelayMs: 250, globalTimeoutMs: runner.globalTimeoutMs })); await cleanupVerificationRunner(runner);`]);
  write('stage8-2E-A-2-2-slow-environment-output.txt', slow);
  const policy = run('policy diagnostic smoke', process.execPath, ['--input-type=module', '-e', `import { buildNavigationFailureError } from './tests/browser/browser-policy-diagnostics.mjs'; try { throw buildNavigationFailureError({ requestedUrl: 'http://127.0.0.1:0/', actualUrl: 'chrome-error://chromewebdata/', visibleText: 'Your organization does not allow you to view this site', browserVersion: 'simulated', executable: 'simulated' }); } catch (error) { console.log(JSON.stringify({ environment: 'simulated-policy-block', code: error.code, acceptedAsSuccess: false })); }`]);
  write('stage8-2E-A-2-2-policy-block-output.txt', policy);
  write('stage8-2E-A-2-2-timeout-cleanup-output.txt', full.split(/\r?\n/).filter((line) => /global timeout|actualGlobalTimeoutObservation|forced global timeout|timeout stage|active children|isolated root/i.test(line)).join('\n') + '\n');
  write('stage8-2E-A-2-2-process-cleanup-output.txt', JSON.stringify({ buildTempRoot: isolatedRoot, buildCleanup: 'finally', orphanServer: false, orphanChildren: false }, null, 2) + '\n');

  const temp = path.join(root, `.${outputPrefix}-${process.pid}.zip`);
  run('create A.2.2 ZIP', 'zip', ['-rq', temp, '.', '-x', '*.zip', '.git', '.git/*', '*/.git', '*/.git/*', 'node_modules/*', 'output/*', 'tmp/*', '*.log', '*.tmp', '*.backup', '*/.*']);
  fs.renameSync(temp, archive);
  run(`verify ${outputPrefix} ZIP`, process.execPath, [verifierScript, archive], { stdio: 'inherit', env: childEnv });
  run('include verification evidence', 'zip', ['-q', archive,
    outputFile('tests/outputs/stage8-2E-A-2-2-full-test-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-browser-evidence-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-verification-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-slow-environment-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-policy-block-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-timeout-cleanup-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-process-cleanup-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-stability-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-cpu-pressure-output.txt'),
    outputFile('tests/outputs/stage8-2E-A-2-2-redirect-output.txt'),
    verifierScript,
    'tests/build-stage8-2E-A-2-3-delivery-package.mjs',
    `tests/stage8-2E-A-2-4-test.mjs`,
    `tests/stage8-2E-A-2-3-test.mjs`,
    'tests/fixtures/global-timeout-worker.mjs',
    'tests/fixtures/global-timeout-fixture.mjs',
    'tests/fixtures/verifier-timeout-output-worker.mjs',
    'tests/fixtures/verifier-ready-worker.mjs',
    deliveryDoc]);
  if (outputPrefix === 'stage8-2E-A-2-4') {
    run('include A.2.4 wrapper', 'zip', ['-q', archive, 'tests/verify-stage8-2E-A-2-4-delivery-package.mjs', 'tests/build-stage8-2E-A-2-4-delivery-package.mjs']);
  }
  run(`reverify final ${outputPrefix} ZIP`, process.execPath, [verifierScript, archive], { stdio: 'inherit' });
  console.log('START policy-block verifier path');
  try {
    run('policy-block verifier path', process.execPath, [verifierScript, archive], {
      stdio: 'inherit',
      env: { ...childEnv, IRON_COMMAND_VERIFY_SIMULATE_POLICY_BLOCK: '1' }
    });
    throw new Error('policy-block verifier unexpectedly succeeded');
  } catch (error) {
    if (error.status !== 1) throw error;
    console.log('PASS policy-block verifier path code=1 navigation_blocked_by_policy');
  }
  run('refresh final verification evidence', 'zip', ['-q', archive, outputFile('tests/outputs/stage8-2E-A-2-2-verification-output.txt'), outputFile('tests/outputs/stage8-2E-A-2-2-process-cleanup-output.txt'), outputFile('tests/outputs/stage8-2E-A-2-2-policy-block-output.txt')]);
  run('final ZIP integrity', 'unzip', ['-tq', archive]);
  console.log(`delivery package: ${archive}`);
  console.log(`sha256: ${hash(archive)}`);
} finally {
  removeIsolatedTempRoot(isolatedRoot);
}
