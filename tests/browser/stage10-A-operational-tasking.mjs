import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-A');
const evidenceDir = path.join(root, 'evidence/stage10-A');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const frames = [
  '01-formation-task-menu.png',
  '02-recon-assigned.png',
  '03-recon-after-reload.png',
  '04-recalled-idle.png'
];

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-a-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const assertions = [];
  const hashes = new Set();
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-A browser assertion failed: ${name} ${JSON.stringify(details)}`);
  };

  try {
    server = localStaticServer(root);
    const port = await listenEphemeral(server);
    browser = await launchManagedBrowser({ url: 'about:blank', env, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    cdp.on('Log.entryAdded', ({ entry }) => { if (entry?.level === 'error') consoleErrors.push(entry.text || 'log error'); });
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const bootStart = Date.now();
    while (Date.now() - bootStart < 15000) {
      try { if (await cdp.evaluate('Boolean(window.__IRON_COMMAND__ && window.render_game_to_text)')) break; } catch { /* context replaced during navigation */ }
      await sleep(50);
    }
    assert(await cdp.evaluate('Boolean(window.__IRON_COMMAND__)'), 'production page booted');

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(200);

    const rect = (selector) => cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n) return null; const r=n.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
    const waitFor = async (expression, name, timeout = 8000) => {
      const start = Date.now(); let value;
      while (Date.now() - start < timeout) {
        value = await cdp.evaluate(expression);
        if (value) return value;
        await sleep(60);
      }
      throw new Error(`timeout waiting for ${name}: ${JSON.stringify(value)}`);
    };
    const mouseClick = async (selector) => {
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
      await sleep(120);
      const box = await rect(selector);
      if (!box) throw new Error(`missing control ${selector}`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(200);
    };
    const inspectorText = () => cdp.evaluate('document.querySelector("#command-inspector-host .command-inspector-panel")?.textContent || ""');
    const capture = async (file) => {
      await cdp.evaluate(`(() => { const toast=document.querySelector('#toast'); if(toast) toast.hidden=true; })()`);
      await sleep(120);
      const target = path.join(screenshotDir, file);
      await cdp.screenshot(target);
      const hash = sha256(await fs.readFile(target));
      assert(!hashes.has(hash), `unique screenshot ${file}`);
      hashes.add(hash);
    };

    /* seed: 1 idle formation + pause */
    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.resources={ supply:9000, alloy:9000, intel:900 };
      s.units.push({ id:'a-u1', type:'mbt', hp:100, maxHp:100, damage:'intact', status:'assigned', formationId:'a-f1', experience:0, battles:0, callsign:null, createdAt:1 });
      s.formations.push({ id:'a-f1', name:'第一梯队', unitIds:['a-u1'], status:'idle', createdAt:1 });
      s.time.speed=0; s.time.lastSpeed=1;
      return window.advanceTime(0);
    })()`);
    await sleep(250);

    /* 1. Formation Inspector 显示三种任务 */
    await mouseClick('button[data-tab="formations"]');
    await waitFor('Boolean(document.querySelector(\'[data-command-id="formation:a-f1"]\'))', 'formation tile');
    await mouseClick('[data-command-id="formation:a-f1"]');
    await waitFor('Boolean(document.querySelector(\'#command-inspector-host:not([hidden])\'))', 'formation inspector');
    const taskActions = await cdp.evaluate('Array.from(document.querySelectorAll(\'[data-inspector-action="choose-task"]\')).map((b) => b.textContent.trim())');
    assert(taskActions.length === 3, 'inspector lists PATROL / RECON / SECURITY', { taskActions });
    await capture(frames[0]);

    /* 2. 下达 RECON 后 Formation Tile 状态改变 */
    await cdp.evaluate(`(() => {
      const buttons=Array.from(document.querySelectorAll('[data-inspector-action="choose-task"]'));
      const target=buttons.find((b) => b.textContent.includes('RECON'));
      if (!target) throw new Error('RECON choose-task action missing');
      target.click();
    })()`);
    await sleep(200);
    assert(await waitFor('Boolean(document.querySelector(\'[data-inspector-action="assign-task"]\'))', 'theater choice actions'), true);
    await cdp.evaluate(`(() => {
      const buttons=Array.from(document.querySelectorAll('[data-inspector-action="assign-task"]:not([disabled])'));
      if (!buttons.length) throw new Error('no enabled assign-task action');
      buttons[0].click();
    })()`);
    await sleep(300);
    const taskAfterAssign = await cdp.evaluate('window.__IRON_COMMAND__.getTask("a-f1")');
    assert(taskAfterAssign && taskAfterAssign.type === 'recon', 'RECON task active in canonical state', { taskAfterAssign });
    const tileBadge = await cdp.evaluate('document.querySelector(\'[data-command-id="formation:a-f1"] .command-badges\')?.textContent || ""');
    assert(tileBadge.includes('RECON'), 'formation tile shows RECON badge', { tileBadge });
    await capture(frames[1]);

    /* 3. 保存 / reload 后 RECON 仍存在 */
    await cdp.evaluate('window.__IRON_COMMAND__.save()');
    await sleep(200);
    await cdp.send('Page.reload');
    const reloadStart = Date.now();
    while (Date.now() - reloadStart < 15000) {
      try { if (await cdp.evaluate('Boolean(window.__IRON_COMMAND__ && window.render_game_to_text)')) break; } catch { /* context replaced */ }
      await sleep(80);
    }
    await sleep(400);
    const taskAfterReload = await cdp.evaluate('window.__IRON_COMMAND__.getTask("a-f1")');
    assert(taskAfterReload && taskAfterReload.type === 'recon' && taskAfterReload.status === 'active', 'RECON survives save + reload', { taskAfterReload });
    await mouseClick('button[data-tab="formations"]');
    await waitFor('Boolean(document.querySelector(\'[data-command-id="formation:a-f1"]\'))', 'formation tile after reload');
    const badgeAfterReload = await cdp.evaluate('document.querySelector(\'[data-command-id="formation:a-f1"] .command-badges\')?.textContent || ""');
    assert(badgeAfterReload.includes('RECON'), 'tile still shows RECON after reload', { badgeAfterReload });
    await capture(frames[2]);

    /* 4. Recall 后恢复 idle */
    await mouseClick('[data-command-id="formation:a-f1"]');
    await waitFor('Boolean(document.querySelector(\'#command-inspector-host:not([hidden])\'))', 'inspector after reload');
    assert((await inspectorText()).includes('任务类型'), 'inspector shows OPERATIONAL TASK rows');
    await cdp.evaluate(`(() => {
      const button=document.querySelector('[data-inspector-action="recall-task"]');
      if (!button) throw new Error('recall-task action missing');
      button.click();
    })()`);
    await sleep(300);
    const taskAfterRecall = await cdp.evaluate('window.__IRON_COMMAND__.getTask("a-f1")');
    assert(taskAfterRecall === null, 'recall clears the task', { taskAfterRecall });
    const badgeAfterRecall = await cdp.evaluate('document.querySelector(\'[data-command-id="formation:a-f1"] .command-badges\')?.textContent || ""');
    assert(!badgeAfterRecall.includes('RECON') && badgeAfterRecall.includes('待命'), 'tile returns to idle', { badgeAfterRecall });
    const dispatchReady = await cdp.evaluate('window.__IRON_COMMAND__.canDispatch ? null : null') === null
      ? await cdp.evaluate('(() => { const s=window.__IRON_COMMAND__.getState(); return s.formations.find((f) => f.id === "a-f1").status; })()')
      : null;
    assert(dispatchReady === 'idle', 'formation status is idle after recall', { dispatchReady });
    await capture(frames[3]);

    assert(pageErrors.length === 0, 'zero page errors', pageErrors);
    assert(consoleErrors.length === 0, 'zero console errors', consoleErrors);

    const evidence = {
      stage: '10-A',
      passed: true,
      frames,
      assertions: assertions.map(({ name, passed }) => ({ name, passed })),
      pageErrors, consoleErrors,
      saveVersion: await cdp.evaluate('window.__IRON_COMMAND__.getState().version'),
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(evidenceDir, 'stage10-A-browser.json'), JSON.stringify(evidence, null, 2));
    console.log(`Stage 10-A browser smoke: ${assertions.length}/${assertions.length} passed, 0 page errors, 0 console errors`);
  } catch (error) {
    console.error('pageErrors:', JSON.stringify(pageErrors, null, 2));
    console.error('consoleErrors:', JSON.stringify(consoleErrors, null, 2));
    throw error;
  } finally {
    if (browser) await terminateManagedBrowser(browser).catch(() => {});
    if (server) await closeServer(server);
    try { await removeIsolatedTempRoot(isolatedRoot); } catch { /* best effort */ }
  }
}

main().catch((error) => {
  console.error('Stage 10-A browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
});
