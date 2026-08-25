import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-E');
const evidenceDir = path.join(root, 'evidence/stage10-E');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const frames = [
  '01-initial-costs.png',
  '02-recon-control-discount.png',
  '03-after-battle-pressure.png'
];

const THEATER = 'scrap_mine';

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-e-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const assertions = [];
  const hashes = new Set();
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-E browser assertion failed: ${name} ${JSON.stringify(details)}`);
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
    const strategicSection = () => cdp.evaluate(`(() => {
      const panel = document.querySelector('#command-inspector-host .command-inspector-panel');
      if (!panel) return null;
      const heads = Array.from(panel.querySelectorAll('.command-inspector-section h4'));
      const head = heads.find((h) => h.textContent.includes('STRATEGIC EFFECTS'));
      return head ? head.parentElement.textContent : null;
    })()`);
    // 战区 Tile 主操作是“选为行动目标”；详情用长按（450ms 阈值）打开 Inspector
    const openTheaterInspector = async (theaterId) => {
      await cdp.evaluate(`document.querySelector('[data-command-id="theater:${theaterId}"]')?.scrollIntoView({ block: 'center' })`);
      await sleep(120);
      await cdp.evaluate(`(() => {
        const t=document.querySelector('[data-command-id="theater:${theaterId}"]');
        t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:41,pointerType:'touch',isPrimary:true,button:0,buttons:1,clientX:12,clientY:12}));
      })()`);
      await sleep(560);
      await cdp.evaluate(`(() => {
        const t=document.querySelector('[data-command-id="theater:${theaterId}"]');
        t.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:41,pointerType:'touch',isPrimary:true,button:0,buttons:0,clientX:12,clientY:12}));
      })()`);
      await sleep(300);
      await waitFor('Boolean(document.querySelector(\'#command-inspector-host:not([hidden])\'))', 'theater inspector');
    };

    /* 场景 1：初始 pressure → 基础任务成本（×1.00 / ×1.00，无修正来源） */
    await mouseClick('button[data-tab="theater"]');
    await waitFor(`Boolean(document.querySelector('[data-command-id="theater:${THEATER}"]'))`, 'theater tile');
    await openTheaterInspector(THEATER);
    let section = await strategicSection();
    assert(section && section.includes('Supply Cost') && section.includes('×1.00'), 'initial strategic effects show ×1.00', section);
    assert(section.includes('基准态势'), 'initial sources say baseline', section);
    await capture(frames[0]);

    /* 场景 2：提升 Recon/Control → UI 成本下降 */
    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.resources={ supply:1e7, alloy:1e5, intel:1e5 };
      s.time.speed=0; s.time.lastSpeed=1;
      const p=s.theaterPressure['${THEATER}'];
      p.recon=60; p.control=40;
      return window.advanceTime(0);
    })()`);
    await sleep(300);
    await cdp.evaluate('document.querySelector("#command-inspector-host .command-inspector-close")?.click()');
    await sleep(200);
    await openTheaterInspector(THEATER);
    section = await strategicSection();
    assert(section && /×0\.9\d/.test(section), 'supply multiplier below 1 after control', section);
    assert(/×0\.85/.test(section), 'intel multiplier 0.85 after recon 60', section);
    assert(section.includes('Recon Intel -15%') && section.includes('Control -6%'), 'sources explained', section);
    await capture(frames[1]);

    /* 场景 3：完成一次正式战斗 → pressure 改变，且查看/回放不再变化 */
    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.theaterPressure['${THEATER}']={threat:50,control:40,recon:60,security:0};
      const fid='e-f0', uid='e-u0';
      s.units.push({ id:uid, type:'mbt', hp:100, maxHp:100, damage:'intact', status:'assigned', formationId:fid, experience:0, battles:0, callsign:null, createdAt:0 });
      s.formations.push({ id:fid, name:'出击组', unitIds:[uid], status:'idle', createdAt:0 });
      return window.advanceTime(0);
    })()`);
    const dispatchResult = await cdp.evaluate('window.__IRON_COMMAND__.dispatch("e-f0", "scrap_mine", "cautious", 4242)');
    assert(dispatchResult && dispatchResult.ok, 'formal dispatch succeeded', dispatchResult && dispatchResult.code);
    const battleResult = await cdp.evaluate('window.__IRON_COMMAND__.getState().activeBattle.report.result');
    await cdp.evaluate('window.__IRON_COMMAND__.settleBattle ? window.__IRON_COMMAND__.settleBattle() : null');
    await sleep(300);
    let settled = await cdp.evaluate('window.__IRON_COMMAND__.getState().activeBattle.settled');
    if (!settled) {
      // 通过推进时间到达结算点
      await cdp.evaluate('window.advanceTime(1200000)');
      await sleep(400);
      settled = await cdp.evaluate('window.__IRON_COMMAND__.getState().activeBattle.settled');
    }
    assert(settled === true, 'battle settled');
    const afterBattle = await pressure();
    assert(afterBattle.control === 50 && afterBattle.security === 5, 'VICTORY pressure delta applied (control 40→50, security 0→5)', { battleResult, afterBattle });
    const receiptStamp = await cdp.evaluate('JSON.stringify(window.__IRON_COMMAND__.getState().activeBattle.settlementReceipt.strategicPressure || null)');
    assert(receiptStamp !== 'null', 'receipt stamped with strategic pressure', receiptStamp);
    // 查看战报 / 重复结算 → 不再变化
    await cdp.evaluate('window.__IRON_COMMAND__.settleBattle ? window.__IRON_COMMAND__.settleBattle() : null').catch?.(() => {});
    await sleep(200);
    const afterResettle = await pressure();
    assert(afterResettle.control === afterBattle.control && afterResettle.security === afterBattle.security, 'repeat settle does not re-apply', { afterBattle, afterResettle });
    await cdp.evaluate('window.__IRON_COMMAND__.save()');
    await sleep(200);
    await cdp.send('Page.reload');
    const reloadStart = Date.now();
    while (Date.now() - reloadStart < 15000) {
      try { if (await cdp.evaluate('Boolean(window.__IRON_COMMAND__ && window.render_game_to_text)')) break; } catch { /* context replaced */ }
      await sleep(80);
    }
    await sleep(400);
    const afterReload = await pressure();
    assert(afterReload.control === afterBattle.control && afterReload.security === afterBattle.security, 'reload does not re-apply', { afterBattle, afterReload });
    await capture(frames[2]);

    assert(pageErrors.length === 0, 'zero page errors', pageErrors);
    assert(consoleErrors.length === 0, 'zero console errors', consoleErrors);

    const evidence = {
      stage: '10-E',
      passed: true,
      frames,
      assertions: assertions.map(({ name, passed }) => ({ name, passed })),
      pageErrors, consoleErrors,
      saveVersion: await cdp.evaluate('window.__IRON_COMMAND__.getState().version'),
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(evidenceDir, 'stage10-E-browser.json'), JSON.stringify(evidence, null, 2));
    console.log(`Stage 10-E browser smoke: ${assertions.length}/${assertions.length} passed, 0 page errors, 0 console errors`);
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
  console.error('Stage 10-E browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
});
