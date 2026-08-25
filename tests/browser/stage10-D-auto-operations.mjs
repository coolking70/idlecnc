import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-D');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const frames = ['01-disabled.png', '02-enabled-auto-task.png', '03-auto-hold-released.png'];

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-d-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const assertions = [];
  const hashes = new Set();
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-D browser assertion failed: ${name} ${JSON.stringify(details)}`);
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
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const bootStart = Date.now();
    while (Date.now() - bootStart < 15000) {
      try { if (await cdp.evaluate('Boolean(window.__IRON_COMMAND__ && window.render_game_to_text)')) break; } catch { /* navigation */ }
      await sleep(50);
    }
    assert(await cdp.evaluate('Boolean(window.__IRON_COMMAND__)'), 'production page booted');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(250);

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
      await sleep(100);
      const box = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n) return null; const r=n.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
      if (!box) throw new Error(`missing control ${selector}`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(300);
    };
    const capture = async (file) => {
      await cdp.evaluate('(() => { const toast=document.querySelector("#toast"); if(toast) toast.hidden=true; })()');
      await sleep(100);
      const target = path.join(screenshotDir, file);
      await cdp.screenshot(target);
      const hash = sha256(await fs.readFile(target));
      assert(!hashes.has(hash), `unique screenshot ${file}`);
      hashes.add(hash);
    };

    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.resources={ supply:9000, alloy:9000, intel:900 };
      s.units.push({ id:'d-u0', type:'mbt', hp:100, maxHp:100, damage:'intact', status:'assigned', formationId:'d-f0', experience:0, battles:0, callsign:null, createdAt:0 });
      s.formations.push({ id:'d-f0', name:'自动巡弋组', unitIds:['d-u0'], status:'idle', createdAt:0 });
      s.time.speed=0; s.time.lastSpeed=1;
      return window.advanceTime(0);
    })()`);
    await sleep(300);

    /* 1. 默认关闭 */
    const initial = await cdp.evaluate('window.__IRON_COMMAND__.autoOperations()');
    assert(initial.enabled === false && initial.autoManaged === 0, 'AUTO OPERATIONS defaults disabled', initial);
    const toggleText = await waitFor('document.querySelector("[data-action=toggle-auto-operations]")?.textContent', 'auto toggle');
    assert(toggleText.includes('DISABLED'), 'Overview displays DISABLED', toggleText);
    assert((await cdp.evaluate('window.__IRON_COMMAND__.getTask("d-f0")')) === null, 'disabled does not assign idle formation');
    await capture(frames[0]);

    /* 2. 点击开启后立即补 RECON（BALANCED 初始 tie 的确定性优先级） */
    await mouseClick('[data-action="toggle-auto-operations"]');
    const task = await waitFor('window.__IRON_COMMAND__.getTask("d-f0")', 'auto-assigned task');
    assert(task.type === 'recon' && task.autoAssigned === true, 'enabled auto-assigns deterministic RECON', task);
    const enabled = await cdp.evaluate('window.__IRON_COMMAND__.autoOperations()');
    assert(enabled.enabled === true && enabled.autoManaged === 1, 'Overview summary counts auto task', enabled);
    await mouseClick('button[data-tab="formations"]');
    await waitFor(`Boolean(document.querySelector('[data-command-id="formation:d-f0"]'))`, 'formation tile');
    const autoBadges = await cdp.evaluate(`document.querySelector('[data-command-id="formation:d-f0"] .command-badges')?.textContent || ''`);
    assert(autoBadges.includes('AUTO') && autoBadges.includes('RECON'), 'Formation tile displays AUTO + RECON', autoBadges);
    await capture(frames[1]);

    /* 3. 玩家 Recall → AUTO HOLD；恢复自动调度后重新获得任务 */
    await mouseClick('[data-command-id="formation:d-f0"]');
    await waitFor('Boolean(document.querySelector("[data-inspector-action=recall-task]"))', 'recall action');
    await mouseClick('[data-inspector-action="recall-task"]');
    await cdp.evaluate('window.__IRON_COMMAND__.runAutoOperations()');
    const held = await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      return { task:window.__IRON_COMMAND__.getTask('d-f0'), hold:s.formations.find((f)=>f.id==='d-f0').autoTaskHold, summary:window.__IRON_COMMAND__.autoOperations() };
    })()`);
    assert(held.task === null && held.hold === true && held.summary.manualHold === 1, 'manual recall holds and blocks reassignment', held);
    await mouseClick('[data-command-id="formation:d-f0"]');
    await waitFor('Boolean(document.querySelector("[data-inspector-action=release-auto-hold]"))', 'release hold action');
    const holdInspector = await cdp.evaluate('document.querySelector("#command-inspector-host")?.textContent || ""');
    assert(holdInspector.includes('AUTO HOLD') && holdInspector.includes('恢复自动调度'), 'Inspector exposes AUTO HOLD release', holdInspector);
    await mouseClick('[data-inspector-action="release-auto-hold"]');
    const reassigned = await waitFor('window.__IRON_COMMAND__.getTask("d-f0")', 'reassigned task');
    assert(reassigned.autoAssigned === true, 'release hold immediately restores auto task', reassigned);
    await mouseClick('[data-command-id="formation:d-f0"]');
    await capture(frames[2]);

    assert(pageErrors.length === 0, 'zero page errors', pageErrors);
    assert(consoleErrors.length === 0, 'zero console errors', consoleErrors);
    console.log(`Stage 10-D browser smoke: ${assertions.length}/${assertions.length} passed, 0 page errors, 0 console errors`);
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
  console.error('Stage 10-D browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
});
