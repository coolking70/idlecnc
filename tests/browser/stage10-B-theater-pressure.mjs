import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-B');
const evidenceDir = path.join(root, 'evidence/stage10-B');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const frames = [
  '01-initial-pressure.png',
  '02-tasks-running-pressure.png',
  '03-after-recall.png'
];

const THEATER = 'scrap_mine';

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-b-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const assertions = [];
  const hashes = new Set();
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-B browser assertion failed: ${name} ${JSON.stringify(details)}`);
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
      const box = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n) return null; const r=n.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
      if (!box) throw new Error(`missing control ${selector}`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(200);
    };
    const capture = async (file) => {
      await cdp.evaluate(`(() => { const toast=document.querySelector('#toast'); if(toast) toast.hidden=true; })()`);
      await sleep(120);
      const target = path.join(screenshotDir, file);
      await cdp.screenshot(target);
      const hash = sha256(await fs.readFile(target));
      assert(!hashes.has(hash), `unique screenshot ${file}`);
      hashes.add(hash);
    };
    const pressure = () => cdp.evaluate(`window.__IRON_COMMAND__.theaterPressure(${JSON.stringify(THEATER)})`);
    const theaterBadges = () => cdp.evaluate(`document.querySelector('[data-command-id="theater:${THEATER}"] .command-badges')?.textContent || ""`);

    /* 场景 1：战区初始 pressure（THREAT 50 / CTRL 0） */
    await mouseClick('button[data-tab="theater"]');
    await waitFor('Boolean(document.querySelector(\'[data-command-id="theater:' + THEATER + '"]\'))', 'theater tile');
    const initialPressure = await pressure();
    // 页面加载后游戏以 1x 运行，读数时 threat 已按 idle 速率微小回升；
    // 初始语义 = threat≈50 / 其余 0。
    assert(initialPressure && initialPressure.threat >= 50 && initialPressure.threat < 50.5 && initialPressure.control === 0, 'initial pressure threat≈50 control=0', initialPressure);
    const initialBadges = await theaterBadges();
    assert(initialBadges.includes('THREAT 50') && initialBadges.includes('CTRL 0'), 'tile shows THREAT 50 / CTRL 0 badges', initialBadges);
    await capture(frames[0]);

    /* 场景 2：RECON + PATROL 运行后指标实时变化 */
    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.resources={ supply:1e7, alloy:1e5, intel:1e5 };
      for (let i=0;i<2;i+=1) {
        const fid='b-f'+i, uid='b-u'+i;
        s.units.push({ id:uid, type:'mbt', hp:100, maxHp:100, damage:'intact', status:'assigned', formationId:fid, experience:0, battles:0, callsign:null, createdAt:i });
        s.formations.push({ id:fid, name:'压力组'+i, unitIds:[uid], status:'idle', createdAt:i });
      }
      return window.advanceTime(0);
    })()`);
    await sleep(200);
    await cdp.evaluate('window.__IRON_COMMAND__.setSpeed(0)'); // 冻结真实时间漂移，advanceTime 精确推进
    await cdp.evaluate('window.__IRON_COMMAND__.assignTask("b-f0", "recon", "scrap_mine")');
    await cdp.evaluate('window.__IRON_COMMAND__.assignTask("b-f1", "patrol", "scrap_mine")');
    await sleep(200);
    await cdp.evaluate('window.advanceTime(3000000)'); // 3000 游戏秒：recon +60；control +60；threat 被压制并触底 clamp
    await sleep(400);
    const runningPressure = await pressure();
    assert(Math.abs(runningPressure.recon - 60) < 1e-6, 'RECON raises recon to 60 after 3000s', runningPressure);
    assert(Math.abs(runningPressure.control - 60) < 1e-6, 'PATROL raises control to 60 after 3000s', runningPressure);
    assert(runningPressure.threat < 50, 'tasks suppress threat', runningPressure);
    const runningBadges = await theaterBadges();
    assert(/CTRL 60/.test(runningBadges), 'tile CTRL badge updates live', runningBadges);
    assert(/THREAT 3\d/.test(runningBadges), 'tile THREAT badge updates live (PATROL suppression)', runningBadges);
    assert(runningBadges.includes('任务 ×2'), 'stacked task badge visible', runningBadges);
    await capture(frames[1]);

    /* 场景 3：Recall 后停止任务影响，只剩自然漂移 */
    await cdp.evaluate('window.__IRON_COMMAND__.recallTask("b-f0")');
    await cdp.evaluate('window.__IRON_COMMAND__.recallTask("b-f1")');
    await sleep(200);
    const atRecall = await pressure();
    await cdp.evaluate('window.advanceTime(2000000)'); // 无任务：threat 回升 +4，recon/control 衰减 -2
    await sleep(400);
    const afterRecall = await pressure();
    assert(Math.abs(afterRecall.threat - (atRecall.threat + 4)) < 1e-6, 'threat regenerates after recall', { atRecall, afterRecall });
    assert(Math.abs(afterRecall.recon - (atRecall.recon - 2)) < 1e-6, 'recon decays after recall', { atRecall, afterRecall });
    assert(Math.abs(afterRecall.control - (atRecall.control - 2)) < 1e-6, 'control decays after recall', { atRecall, afterRecall });
    const recalledBadges = await theaterBadges();
    assert(!recalledBadges.includes('任务 ×'), 'task badge cleared after recall', recalledBadges);
    await capture(frames[2]);

    assert(pageErrors.length === 0, 'zero page errors', pageErrors);
    assert(consoleErrors.length === 0, 'zero console errors', consoleErrors);

    const evidence = {
      stage: '10-B',
      passed: true,
      frames,
      assertions: assertions.map(({ name, passed }) => ({ name, passed })),
      pageErrors, consoleErrors,
      saveVersion: await cdp.evaluate('window.__IRON_COMMAND__.getState().version'),
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(evidenceDir, 'stage10-B-browser.json'), JSON.stringify(evidence, null, 2));
    console.log(`Stage 10-B browser smoke: ${assertions.length}/${assertions.length} passed, 0 page errors, 0 console errors`);
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
  console.error('Stage 10-B browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
});
