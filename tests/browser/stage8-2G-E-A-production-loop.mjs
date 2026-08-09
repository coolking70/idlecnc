import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_ea_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_ea_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-E-A');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-E-A' || machine.frameCount !== 11 || machine.fixtureLoaderUsed === true) throw new Error('E-A machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-EA-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const hashes = new Set();
  const frames = [];
  let server; let browser; let cdp;

  try {
    server = localStaticServer(root);
    const port = await listenEphemeral(server);
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('E-A page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });

    const clickTab = async (id) => { await cdp.evaluate(`document.querySelector('button[data-tab="${id}"]')?.click()`); await sleep(100); };
    const state = async () => cdp.evaluate(call('getState'));
    const waitUntil = async (predicate, label, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const current = await state();
        if (predicate(current)) return current;
        await sleep(250);
      }
      throw new Error(`E-A wait timeout: ${label}`);
    };
    const capture = async (target, extra = {}) => {
      await sleep(150);
      const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath);
      const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error(`duplicate E-A PNG ${target.file}`);
      hashes.add(imageSha256);
      const current = await state();
      const domText = await cdp.evaluate('document.body?.innerText || ""');
      frames.push({ ...target, ...extra, state: { saveRevision: current.saveRevision, activeBattleSessionId: current.activeBattleSessionId, activeBattle: current.activeBattle ? { id: current.activeBattle.id, battleSessionId: current.activeBattle.battleSessionId, settled: current.activeBattle.settled, replayReadOnly: current.activeBattle.replayReadOnly === true, elapsed: current.activeBattle.elapsed } : null, sessionCount: Object.keys(current.battleSessions || {}).length, ledgerCount: Object.keys(current.battleSettlementLedger || {}).length }, domTextLength: domText.length, imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
    };

    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 1));
    await clickTab('overview');
    await capture(machine.frames[0], { productionEntry: true, phase: 'base' });

    const build = await cdp.evaluate(call('build', 'barracks'));
    if (!build?.ok) throw new Error(`barracks build failed: ${JSON.stringify(build)}`);
    await cdp.evaluate(call('setSpeed', 4));
    await waitUntil((current) => current.buildings?.some((building) => building.type === 'barracks' && building.status === 'operational'), 'barracks ready');
    await cdp.evaluate(call('setSpeed', 0));
    await clickTab('production');
    await capture(machine.frames[1], { productionEntry: true, phase: 'barracks_ready' });

    const p1 = await cdp.evaluate(call('produce', 'infantry'));
    const p2 = await cdp.evaluate(call('produce', 'infantry'));
    if (!p1?.ok || !p2?.ok) throw new Error(`infantry production failed: ${JSON.stringify({ p1, p2 })}`);
    await cdp.evaluate(call('setSpeed', 4));
    await waitUntil((current) => (current.units || []).filter((unit) => unit.type === 'infantry').length >= 2, 'two infantry ready');
    await cdp.evaluate(call('setSpeed', 0));
    await clickTab('production');
    await capture(machine.frames[2], { productionEntry: true, phase: 'units_ready' });

    const formation = await cdp.evaluate(call('createFormation', 'E-A 正式编队'));
    if (!formation?.ok) throw new Error(`formation create failed: ${JSON.stringify(formation)}`);
    const currentState = await state();
    const formationId = formation.formation.id;
    for (const unit of currentState.units.filter((item) => item.type === 'infantry' && item.status === 'ready')) {
      const added = await cdp.evaluate(call('addUnit', formationId, unit.id));
      if (!added?.ok) throw new Error(`formation add failed: ${JSON.stringify(added)}`);
    }
    await clickTab('formations');
    await capture(machine.frames[3], { productionEntry: true, phase: 'formation_deployment', formationId });

    await cdp.evaluate(call('save'));
    await clickTab('theater');
    await capture(machine.frames[4], { productionEntry: true, phase: 'formal_theater_entry' });
    const dispatched = await cdp.evaluate(call('dispatch', formationId, 'scrap_mine', 'cautious', 82001));
    if (!dispatched?.ok) throw new Error(`formal dispatch failed: ${JSON.stringify(dispatched)}`);
    await cdp.evaluate(call('setSpeed', 0));
    await clickTab('theater');
    await capture(machine.frames[5], { productionEntry: true, phase: 'battle_running', sessionId: dispatched.activeBattle.battleSessionId });

    await cdp.evaluate(call('save'));
    const reload = await cdp.evaluate(call('load'));
    if (reload?.ok === false) throw new Error(`running session reload failed: ${JSON.stringify(reload)}`);
    await clickTab('theater');
    await capture(machine.frames[6], { productionEntry: true, phase: 'reload_running_session', reloadPreservedSession: true });

    const settled = await cdp.evaluate(call('tickBattle', 999));
    if (!settled?.ok || !settled.activeBattle?.settled) throw new Error(`formal settlement failed: ${JSON.stringify(settled)}`);
    await cdp.evaluate(call('save'));
    await clickTab('theater');
    await capture(machine.frames[7], { productionEntry: true, phase: 'formal_result_settlement', settlementApplied: true });

    await clickTab('reports');
    await capture(machine.frames[8], { productionEntry: true, phase: 'formal_report_bound', reportBound: true });
    const closed = await cdp.evaluate(call('skipBattleReturn'));
    if (!closed?.ok) throw new Error(`formal return failed: ${JSON.stringify(closed)}`);
    const replay = await cdp.evaluate(call('replayBattle', dispatched.activeBattle.battleSessionId));
    if (!replay?.ok || replay.readOnly !== true) throw new Error(`replay start failed: ${JSON.stringify(replay)}`);
    await clickTab('theater');
    await capture(machine.frames[9], { productionEntry: true, phase: 'replay_readonly', replayReadOnly: true });

    await cdp.evaluate(call('tickBattle', 999));
    await cdp.evaluate(call('tickBattleReturn', 999));
    await clickTab('overview');
    await capture(machine.frames[10], { productionEntry: true, phase: 'returned_base', replayClosed: true });

    if (pageErrors.length || consoleErrors.length) throw new Error(`E-A browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = { stage: '8.2G-E-A', version: 1, generatedBy: 'tests/browser/stage8-2G-E-A-production-loop.mjs', machineEvidenceFile: path.basename(machinePath), productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false, browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: hashes.size }, scenes: [{ sceneId: 'production-loop', frames }], passed: frames.length === 11 && hashes.size === 11 };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, output: manifestPath }));
    if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close();
    await terminateManagedBrowser(browser).catch(() => {});
    await new Promise((resolve) => server?.close(() => resolve()));
    removeIsolatedTempRoot(isolatedRoot);
  }
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage8-2G-E-A-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
