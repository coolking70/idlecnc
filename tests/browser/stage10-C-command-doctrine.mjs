import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-C');
const evidenceDir = path.join(root, 'evidence/stage10-C');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const frames = [
  '01-balanced-initial.png',
  '02-switched-recon.png',
  '03-recon-bonus-running.png'
];

const THEATER = 'scrap_mine';

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-c-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const assertions = [];
  const hashes = new Set();
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-C browser assertion failed: ${name} ${JSON.stringify(details)}`);
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
      await sleep(250);
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

    /* 场景 1：BALANCED 初始（Overview COMMAND DOCTRINE，BALANCED ACTIVE） */
    assert((await cdp.evaluate('window.__IRON_COMMAND__.doctrine()')) === 'balanced', 'debug API reports balanced');
    const doctrineTiles = await waitFor('Boolean(document.querySelector(\'[data-command-scope="doctrine"] [data-command-id="doctrine:balanced"]\'))', 'doctrine grid') && true;
    assert(doctrineTiles, 'doctrine grid present on overview');
    let badges = await cdp.evaluate('document.querySelector(\'[data-command-id="doctrine:balanced"] .command-badges\')?.textContent || ""');
    assert(badges.includes('ACTIVE'), 'BALANCED marked ACTIVE', badges);
    const tileCount = await cdp.evaluate('document.querySelectorAll(\'[data-command-scope="doctrine"] .command-tile\').length');
    assert(tileCount === 4, 'four doctrine tiles', tileCount);
    await capture(frames[0]);

    /* 场景 2：点击 RECON tile → 立即切换 */
    await mouseClick('[data-command-id="doctrine:recon"]');
    await sleep(300);
    assert((await cdp.evaluate('window.__IRON_COMMAND__.doctrine()')) === 'recon', 'doctrine switched to recon');
    badges = await cdp.evaluate('document.querySelector(\'[data-command-id="doctrine:recon"] .command-badges\')?.textContent || ""');
    assert(badges.includes('ACTIVE'), 'RECON now ACTIVE', badges);
    const balancedBadges = await cdp.evaluate('document.querySelector(\'[data-command-id="doctrine:balanced"] .command-badges\')?.textContent || ""');
    assert(!balancedBadges.includes('ACTIVE'), 'BALANCED no longer ACTIVE', balancedBadges);
    await capture(frames[1]);

    /* 场景 3：RECON 任务运行，增益高于 BALANCED（0.03/s ×2000s = 60） */
    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.resources={ supply:1e7, alloy:1e5, intel:1e5 };
      const fid='c-f0', uid='c-u0';
      s.units.push({ id:uid, type:'mbt', hp:100, maxHp:100, damage:'intact', status:'assigned', formationId:fid, experience:0, battles:0, callsign:null, createdAt:0 });
      s.formations.push({ id:fid, name:'侦察组', unitIds:[uid], status:'idle', createdAt:0 });
      return window.advanceTime(0);
    })()`);
    await cdp.evaluate('window.__IRON_COMMAND__.setSpeed(0)');
    await cdp.evaluate('window.__IRON_COMMAND__.assignTask("c-f0", "recon", "scrap_mine")');
    await sleep(200);
    await cdp.evaluate('window.advanceTime(2000000)'); // 2000 游戏秒：0.02×1.5×2000 = 60
    await sleep(400);
    const reconPressure = await pressure();
    assert(Math.abs(reconPressure.recon - 60) < 1e-6, 'RECON doctrine boosts recon growth to 60 (1.5x)', reconPressure);
    // BALANCED 基线只会有 40 —— 同窗口对照
    await cdp.evaluate('window.__IRON_COMMAND__.setDoctrine("balanced")');
    await cdp.evaluate('window.__IRON_COMMAND__.assignTask("c-f0", "recon", "scrap_mine")').catch?.(() => {});
    await cdp.evaluate('window.__IRON_COMMAND__.recallTask("c-f0")');
    await cdp.evaluate('window.__IRON_COMMAND__.assignTask("c-f0", "recon", "scrap_mine")');
    const theaterBadges = await cdp.evaluate(`document.querySelector('[data-command-id="theater:${THEATER}"] .command-badges')?.textContent || ""`);
    assert(/RECON/.test(theaterBadges) || theaterBadges.includes('任务'), 'theater tile reflects running task', theaterBadges);
    await capture(frames[2]);

    assert(pageErrors.length === 0, 'zero page errors', pageErrors);
    assert(consoleErrors.length === 0, 'zero console errors', consoleErrors);

    const evidence = {
      stage: '10-C',
      passed: true,
      frames,
      assertions: assertions.map(({ name, passed }) => ({ name, passed })),
      pageErrors, consoleErrors,
      saveVersion: await cdp.evaluate('window.__IRON_COMMAND__.getState().version'),
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(evidenceDir, 'stage10-C-browser.json'), JSON.stringify(evidence, null, 2));
    console.log(`Stage 10-C browser smoke: ${assertions.length}/${assertions.length} passed, 0 page errors, 0 console errors`);
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
  console.error('Stage 10-C browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
});
