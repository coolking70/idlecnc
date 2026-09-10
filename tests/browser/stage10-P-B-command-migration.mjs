import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-P-B');
const evidenceDir = path.join(root, 'evidence/stage10-P-B');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const frames = [
  '01-desktop-overview.png',
  '02-desktop-theater-grid.png',
  '03-desktop-units-roster.png',
  '04-desktop-unit-inspector.png',
  '05-desktop-formations.png',
  '06-desktop-research.png',
  '07-mobile-units.png',
  '08-mobile-inspector.png'
];

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-pb-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const assertions = [];
  const hashes = new Set();
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-P-B browser assertion failed: ${name} ${JSON.stringify(details)}`);
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

    const viewport = async (width, height, mobile = false) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      await sleep(200);
    };
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
      await sleep(160);
    };
    const openTab = async (tabId) => {
      await mouseClick(`button[data-tab="${tabId}"]`);
      await sleep(260);
    };
    const noHorizontalOverflow = () => cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');
    const capture = async (file) => {
      await cdp.evaluate(`(() => { const toast=document.querySelector('#toast'); if(toast) toast.hidden=true; })()`);
      await sleep(120);
      const target = path.join(screenshotDir, file);
      await cdp.screenshot(target);
      const hash = sha256(await fs.readFile(target));
      assert(!hashes.has(hash), `unique screenshot ${file}`);
      hashes.add(hash);
    };

    /* ---- seed a representative mid-game state via the debug API ---- */
    await cdp.evaluate(`(() => {
      const s=window.__IRON_COMMAND__.getState();
      s.resources={ supply:6000, alloy:6000, intel:600 };
      s.unlocks.units=['infantry','at_infantry','scout_car','mbt','repair_vehicle'];
      s.units.push(
        { id:'pb-u1', type:'infantry', hp:100, maxHp:100, damage:'intact', status:'ready', formationId:null, experience:20, battles:1, callsign:'尖兵', createdAt:1 },
        { id:'pb-u2', type:'mbt', hp:38, maxHp:150, damage:'heavy', status:'ready', formationId:null, experience:900, battles:9, callsign:'铁锤', createdAt:2 }
      );
      s.buildings.push(
        { id:'pb-radar', type:'radar_station', status:'operational', progress:1, level:1, builtAt:1, fx:{spawn:0} },
        { id:'pb-lab', type:'research_center', status:'operational', progress:1, level:1, builtAt:1, fx:{spawn:0} }
      );
      return window.advanceTime(0);
    })()`);
    await sleep(300);

    /* 01 Desktop overview */
    await viewport(1440, 900);
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-scope="overview"] .command-tile\'))', 'overview ops tile'));
    assert(await noHorizontalOverflow(), 'overview no horizontal overflow');
    await capture(frames[0]);

    /* 02 Desktop theater */
    await openTab('theater');
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-scope="theater"] [data-command-id^="theater:"]\'))', 'theater tile'));
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-id^="strategy:"]\'))', 'strategy tile'));
    const theaterTiles = await cdp.evaluate('document.querySelectorAll(\'[data-command-scope="theater"] [data-command-id^="theater:"] .command-tile-name\').length');
    assert(theaterTiles >= 5, 'theater grid lists theaters', { theaterTiles });
    const firstTheater = await cdp.evaluate('document.querySelector(\'[data-command-scope="theater"] [data-command-id^="theater:"]\')?.dataset.commandId');
    await mouseClick(`[data-command-id="${firstTheater}"]`);
    const theaterInspectorHidden = await cdp.evaluate('document.querySelector("#command-inspector-host").hidden');
    assert(theaterInspectorHidden === true, 'theater tile primary does not open inspector', { theaterInspectorHidden });    const dispatchTarget = await cdp.evaluate('document.querySelector(".th-ds-target")?.textContent || ""');
    assert(dispatchTarget.includes('目标') || dispatchTarget.includes('任务'), 'dispatch console follows theater tile selection', { dispatchTarget });
    assert(await noHorizontalOverflow(), 'theater no horizontal overflow');
    await capture(frames[1]);

    /* 03 Desktop units roster */
    await openTab('units');
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-scope="units"] [data-command-id="unit-instance:pb-u1"]\'))', 'roster tile'));
    assert(await noHorizontalOverflow(), 'units no horizontal overflow');
    await capture(frames[2]);

    /* 04 Desktop unit inspector */
    await mouseClick('[data-command-id="unit-instance:pb-u2"]');
    assert(await waitFor('Boolean(document.querySelector(\'#command-inspector-host:not([hidden])\'))', 'unit inspector'));
    await sleep(300);
    const inspectorText = await cdp.evaluate('document.querySelector("#command-inspector-host .command-inspector-panel")?.textContent || ""');
    assert(inspectorText.includes('呼号'), 'unit inspector exposes rename input');
    assert(inspectorText.includes('所属编队'), 'unit inspector shows formation row');
    await capture(frames[3]);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor('!document.querySelector("#command-inspector-host:not([hidden])")', 'inspector closed by Escape');

    /* 05 Desktop formations */
    await openTab('formations');
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-scope="formations"] [data-command-id="formation:new"]\'))', 'new formation tile'));
    await mouseClick('[data-command-id="formation:new"]');
    assert(await waitFor('Boolean(document.querySelector(\'#command-inspector-host:not([hidden])\'))', 'formation inspector'));
    const formationInspector = await cdp.evaluate('document.querySelector("#command-inspector-host .command-inspector-panel")?.textContent || ""');
    assert(formationInspector.includes('新建空编队'), 'formation inspector exposes create action');
    await cdp.evaluate('document.querySelector(\'[data-inspector-action="create-formation"]\')?.click()');
    await sleep(250);
    const formationTiles = await cdp.evaluate('document.querySelectorAll(\'[data-command-scope="formations"] [data-command-id^="formation:"]\').length');
    assert(formationTiles >= 2, 'create-formation inspector action created a formation tile', { formationTiles });
    assert(await noHorizontalOverflow(), 'formations no horizontal overflow');
    await capture(frames[4]);

    /* 06 Desktop research */
    await openTab('research');
    assert(await waitFor('Boolean(document.querySelector(\'.research-tree-compact [data-command-id^="research:"]\'))', 'research tile'));
    const researchingTile = await cdp.evaluate('Boolean(document.querySelector(\'[data-command-id^="research:"][data-command-state="locked"]\'))');
    assert(researchingTile, 'research shows locked tech tiles');
    /* Stage 10-P-B.1: every technology must render. The old per-tech
     * branchGrid.update() dropped all but the last tech of each branch. */
    const renderedTechTiles = await cdp.evaluate('document.querySelectorAll(\'[data-command-id^="research:"]\').length');
    assert(renderedTechTiles === 9, 'all 9 research tiles render (no per-branch update drop)', { renderedTechTiles });
    const branchCounts = await cdp.evaluate(`(() => {
      const counts = {};
      document.querySelectorAll('.research-branch').forEach((branch) => {
        counts[branch.dataset.branch] = branch.querySelectorAll('[data-command-id^="research:"]').length;
      });
      return counts;
    })()`);
    assert(branchCounts.industry === 3, 'industry branch shows all 3 techs', branchCounts);
    assert(branchCounts.military === 3, 'military branch shows all 3 techs', branchCounts);
    assert(branchCounts.command === 3, 'command branch shows all 3 techs', branchCounts);
    /* Plain click on an available tech starts research instead of opening the inspector. */
    const researchBefore = await cdp.evaluate('window.__IRON_COMMAND__.getState().research.current');
    assert(researchBefore === null, 'no research running before click', researchBefore);
    await mouseClick('[data-command-id="research:logistics_optimization"]');
    await sleep(300);
    const researchAfter = await cdp.evaluate('window.__IRON_COMMAND__.getState().research.current');
    assert(Boolean(researchAfter && researchAfter.techId === 'logistics_optimization'), 'plain click started the research', researchAfter);
    const researchInspectorHidden = await cdp.evaluate('document.querySelector("#command-inspector-host").hidden');
    assert(researchInspectorHidden === true, 'research primary click did not open the inspector');
    assert(await noHorizontalOverflow(), 'research no horizontal overflow');
    await capture(frames[5]);

    /* 06b Desktop repair candidate: plain click queues the repair */
    await openTab('repairs');
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-scope="repairs"] [data-command-id="repair-candidate:pb-u2"]\'))', 'repair candidate tile'));
    const repairUnitBefore = await cdp.evaluate(`(() => {
      const state = window.__IRON_COMMAND__.getState();
      const unit = state.units.find((u) => u.id === 'pb-u2');
      return { status: unit.status, jobs: (state.repairs || []).length };
    })()`);
    await mouseClick('[data-command-id="repair-candidate:pb-u2"]');
    await sleep(300);
    const repairUnitAfter = await cdp.evaluate(`(() => {
      const state = window.__IRON_COMMAND__.getState();
      const unit = state.units.find((u) => u.id === 'pb-u2');
      return { status: unit.status, jobs: (state.repairs || []).length };
    })()`);
    assert(repairUnitBefore.status === 'ready', 'damaged unit starts ready');
    assert(repairUnitBefore.jobs === 0, 'no repair jobs before the click');
    assert(repairUnitAfter.status === 'repairing', 'plain click sent the unit to repair', repairUnitAfter);
    assert(repairUnitAfter.jobs === 1, 'plain click created the repair job', repairUnitAfter);
    const repairInspectorHidden = await cdp.evaluate('document.querySelector("#command-inspector-host").hidden');
    assert(repairInspectorHidden === true, 'repair primary click did not open the inspector');

    /* 07 Mobile roster + compact nav */
    await viewport(390, 844, true);
    await openTab('units');
    assert(await waitFor('Boolean(document.querySelector(\'[data-command-scope="units"] [data-command-id="unit-instance:pb-u1"]\'))', 'mobile roster tile'));
    assert(await noHorizontalOverflow(), 'mobile units no horizontal overflow');
    await capture(frames[6]);

    /* 08 Mobile long-press on a tile WITH a real primary action:
     * inspector only, canonical research selection untouched. The running
     * research keeps elapsing during the press, so compare the semantic
     * selection (current tech/job identity, queue, completed), not the
     * live progress numbers. */
    await openTab('research');
    const pressTarget = await waitFor('Boolean(document.querySelector(\'[data-command-id="research:standardized_training"][data-action="research"]\'))', 'available research tile with primary action');
    assert(pressTarget, 'long-press target has a real primary action');
    const researchIdentity = () => cdp.evaluate(`(() => {
      const r = window.__IRON_COMMAND__.getState().research;
      return JSON.stringify({ currentId: r.current ? r.current.id : null, currentTech: r.current ? r.current.techId : null, queue: (r.queue || []).map((task) => task.techId), completed: r.completed || [] });
    })()`);
    const researchIdentityBefore = await researchIdentity();
    const box = await rect('[data-command-id="research:standardized_training"]');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
    await sleep(620);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    assert(await waitFor('Boolean(document.querySelector(\'#command-inspector-host:not([hidden])\'))', 'mobile long-press opens inspector'));
    const researchIdentityAfter = await researchIdentity();
    assert(researchIdentityAfter === researchIdentityBefore, 'long press did not trigger the primary action', { researchIdentityBefore, researchIdentityAfter });
    await capture(frames[7]);

    assert(pageErrors.length === 0, 'zero page errors', pageErrors);
    assert(consoleErrors.length === 0, 'zero console errors', consoleErrors);

    const evidence = {
      stage: '10-P-B',
      passed: true,
      frames,
      assertions: assertions.map(({ name, passed }) => ({ name, passed })),
      pageErrors, consoleErrors,
      saveVersion: await cdp.evaluate('window.__IRON_COMMAND__.getState().version'),
      viewportChecks: ['desktop-1440', 'mobile-390'],
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(evidenceDir, 'stage10-P-B-browser.json'), JSON.stringify(evidence, null, 2));
    console.log(`Stage 10-P-B browser smoke: ${assertions.length}/${assertions.length} passed, 0 page errors, 0 console errors`);
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
  console.error('Stage 10-P-B browser smoke failed:', error?.stack || error);
  process.exitCode = 1;
});
