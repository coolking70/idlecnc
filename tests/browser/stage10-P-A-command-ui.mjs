import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, closeServer, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots/stage10-P-A');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const browserEvidencePath = path.join(evidenceDir, 'stage10-P-A-browser.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const requiredFrames = [
  '01-construction-command-grid.png',
  '02-construction-hover-tooltip.png',
  '03-construction-active-progress.png',
  '04-unit-production-command-grid.png',
  '05-unit-hover-tooltip.png',
  '06-unit-locked-state.png',
  '07-unit-resource-insufficient.png',
  '08-production-queue.png',
  '09-equipment-command-grid.png',
  '10-equipment-tooltip.png',
  '11-mobile-480-production.png',
  '12-mobile-390-production.png',
  '13-mobile-inspector.png'
];

function stateSummary(state) {
  return {
    resources: state?.resources || {},
    construction: state?.construction?.current ? { type: state.construction.current.type, elapsed: state.construction.current.elapsed, duration: state.construction.current.duration } : null,
    production: {
      current: state?.production?.current ? { kind: state.production.current.kind || 'unit', type: state.production.current.type || null, equipmentId: state.production.current.equipmentId || null } : null,
      queue: (state?.production?.queue || []).map((job) => ({ kind: job.kind || 'unit', type: job.type || null, equipmentId: job.equipmentId || null }))
    },
    unitCount: (state?.units || []).length,
    equipmentInventoryCount: (state?.equipment?.inventory || []).length
  };
}

async function main() {
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage10-pa-');
  const env = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const actions = [];
  const frames = [];
  const hashes = new Set();
  const assertions = [];
  let server; let browser; let cdp;

  const assert = (condition, name, details = null) => {
    assertions.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`Stage10-P-A browser assertion failed: ${name} ${JSON.stringify(details)}`);
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
      try {
        if (await cdp.evaluate('Boolean(window.__IRON_COMMAND__ && window.render_game_to_text)')) break;
      } catch { /* execution context is replaced during navigation */ }
      await sleep(50);
    }
    assert(await cdp.evaluate('Boolean(window.__IRON_COMMAND__)'), 'production page booted');

    const viewport = async (width, height, mobile = false) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      await sleep(180);
    };
    const rect = async (selector) => cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); if(!n) return null; const r=n.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, left:r.left, top:r.top, width:r.width, height:r.height, disabled:Boolean(n.disabled), ariaDisabled:n.getAttribute('aria-disabled') }; })()`);
    const waitFor = async (expression, name, timeout = 8000) => {
      const start = Date.now(); let value;
      while (Date.now() - start < timeout) {
        value = await cdp.evaluate(expression);
        if (value) return value;
        await sleep(60);
      }
      throw new Error(`timeout waiting for ${name}: ${JSON.stringify(value)}`);
    };
    const mouseClick = async (selector, label) => {
      const box = await rect(selector);
      if (!box) throw new Error(`missing control ${selector}`);
      actions.push({ kind: 'mouse_click', selector, label, source: 'production_dom', coordinates: { x: box.x, y: box.y } });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(140);
    };
    const hover = async (selector, label) => {
      const box = await rect(selector);
      if (!box) throw new Error(`missing hover target ${selector}`);
      await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); n.dataset.hoverProbe=''; n.addEventListener('pointerenter',()=>{n.dataset.hoverProbe+='pointerenter;';},{once:true}); n.addEventListener('mouseenter',()=>{n.dataset.hoverProbe+='mouseenter;';},{once:true}); })()`);
      actions.push({ kind: 'mouse_hover', selector, label, source: 'production_dom', coordinates: { x: box.x, y: box.y } });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: Math.max(8, box.y), pointerType: 'mouse' });
      await sleep(50);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, pointerType: 'mouse' });
      await sleep(220);
      const hoverProbe = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); const at=document.elementFromPoint(${JSON.stringify(box.x)},${JSON.stringify(box.y)}); return { events:n?.dataset.hoverProbe||'', matches:n?.matches(':hover')||false, elementAtPoint:at?.className||at?.tagName||null, tooltipHidden:document.querySelector('#command-tooltip-host')?.hidden }; })()`);
      if (!hoverProbe.matches || !hoverProbe.events) throw new Error(`hover input did not reach ${label}: ${JSON.stringify(hoverProbe)} box=${JSON.stringify(box)}`);
      await waitFor('Boolean(document.querySelector("#command-tooltip-host:not([hidden])"))', `${label} tooltip`);
    };
    const keyEnter = async (selector, label) => {
      await cdp.send('Page.bringToFront');
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
      const focused = await cdp.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
      if (!focused) throw new Error(`failed to focus keyboard target ${selector}`);
      actions.push({ kind: 'keyboard_enter', selector, label, source: 'production_dom' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await sleep(160);
    };
    const touchLongPress = async (selector, label, { move = false, cancel = false } = {}) => {
      const box = await rect(selector);
      if (!box) throw new Error(`missing long press target ${selector}`);
      actions.push({ kind: cancel ? 'touch_cancel' : move ? 'touch_move_cancel' : 'touch_long_press', selector, label, source: 'production_dom', durationMs: 520 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      if (move) {
        await sleep(90);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 32, y: box.y + 2, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      }
      if (cancel) {
        await sleep(90);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      } else {
        await sleep(520);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await sleep(120);
    };
    const touchTap = async (selector, label) => {
      const box = await rect(selector);
      if (!box) throw new Error(`missing tap target ${selector}`);
      actions.push({ kind: 'touch_tap', selector, label, source: 'production_dom', durationMs: 80 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
      await sleep(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(180);
    };
    const pointerLongPress = async (selector, label, { move = false } = {}) => {
      const box = await rect(selector);
      if (!box) throw new Error(`missing pointer long press target ${selector}`);
      actions.push({ kind: move ? 'pointer_move_cancel' : 'pointer_long_press', selector, label, source: 'production_dom', thresholdMs: 450, holdMs: 700, simulation: 'browser PointerEvent sequence; no handler invocation' });
      const dispatch = (type, x, y) => cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); n.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles:true, cancelable:true, pointerId:41, pointerType:'touch', isPrimary:true, button:0, buttons:${type === 'pointerup' || type === 'pointercancel' ? 0 : 1}, clientX:${JSON.stringify(x)}, clientY:${JSON.stringify(y)} })); return true; })()`);
      await dispatch('pointerdown', box.x, box.y);
      if (move) {
        await sleep(90);
        await dispatch('pointermove', box.x + 32, box.y + 2);
      }
      await sleep(700);
      await dispatch('pointerup', move ? box.x + 32 : box.x, move ? box.y + 2 : box.y);
      await sleep(120);
      return cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return { state:n?.dataset.longPressState||null, inspectorVisible:Boolean(document.querySelector('#command-inspector-host:not([hidden])')) }; })()`);
    };
    const gameState = () => cdp.evaluate('window.__IRON_COMMAND__.getState()');
    const reset = async () => {
      await cdp.evaluate('window.__IRON_COMMAND__.reset()');
      await cdp.evaluate(`(() => { const s=window.__IRON_COMMAND__.getState(); s.time.speed=0; s.time.lastSpeed=1; const toast=document.querySelector('#toast'); if(toast) toast.hidden=true; return window.advanceTime(0); })()`);
      await sleep(180);
    };
    const seedProduction = async ({ resources = true, buildings = true, unlocks = true, research = true } = {}) => {
      await reset();
      await cdp.evaluate(`(() => {
        const s=window.__IRON_COMMAND__.getState();
        s.resources=${resources ? "{ supply:4000, alloy:4000, intel:400 }" : "{ supply:0, alloy:0, intel:0 }"};
        s.unlocks.units=${unlocks ? "['infantry','at_infantry','scout_car','mbt','repair_vehicle']" : '[]'};
        s.research.completed=${research ? "['modular_assembly','field_maintenance','composite_armor','expanded_storage']" : '[]'};
        if (${buildings ? 'true' : 'false'}) {
          s.buildings.push(
            { id:'stage10-browser-barracks', type:'barracks', status:'operational', progress:1, level:1, builtAt:1, fx:{spawn:0} },
            { id:'stage10-browser-armor', type:'armor_factory', status:'operational', progress:1, level:1, builtAt:1, fx:{spawn:0} }
          );
        }
        return window.advanceTime(0);
      })()`);
      await sleep(220);
      await mouseClick('button[data-tab="production"]', 'open production');
      await waitFor(`Boolean(document.querySelector('[data-command-id="unit:infantry"]'))`, 'unit tile');
      await mouseClick('[data-category="units"]', 'select unit category');
    };
    const capture = async (file, phase, extra = {}) => {
      await cdp.evaluate('document.querySelector(".panel-body")?.scrollTo(0,0)');
      if (!extra.tooltip) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 12, y: 100, pointerType: 'mouse' });
      await cdp.evaluate(`(() => { const toast=document.querySelector('#toast'); if(toast) toast.hidden=true; if(!document.querySelector('#command-inspector-host:not([hidden])')) document.activeElement?.blur?.(); })()`);
      await sleep(130);
      await cdp.evaluate('Promise.all(Array.from(document.images).map((img) => img.complete ? true : new Promise((resolve) => { img.addEventListener("load", resolve, {once:true}); img.addEventListener("error", resolve, {once:true}); })))');
      const target = path.join(screenshotDir, file);
      await cdp.screenshot(target);
      const bytes = await fs.readFile(target);
      const imageSha256 = sha256(bytes);
      assert(!hashes.has(imageSha256), `unique screenshot ${file}`, imageSha256);
      hashes.add(imageSha256);
      const dimensions = await cdp.evaluate('({ width:innerWidth, height:innerHeight, dpr:devicePixelRatio })');
      const state = await gameState();
      const dom = await cdp.evaluate(`({
        tooltipHosts:document.querySelectorAll('#command-tooltip-host').length,
        inspectorHosts:document.querySelectorAll('#command-inspector-host').length,
        tooltipVisible:Boolean(document.querySelector('#command-tooltip-host:not([hidden])')),
        inspectorVisible:Boolean(document.querySelector('#command-inspector-host:not([hidden])')),
        commandTiles:document.querySelectorAll('.command-tile').length,
        visibleNames:Array.from(document.querySelectorAll('.tab-page:not([hidden]) .command-tile-name')).map((n)=>n.textContent),
        permanentDescriptions:document.querySelectorAll('.tab-page:not([hidden]) .bc-desc').length,
        bodyText:document.querySelector('.tab-page:not([hidden])')?.innerText || ''
      })`);
      assert(dom.tooltipHosts === 1, `${file} one tooltip host`, dom);
      assert(dom.inspectorHosts === 1, `${file} one inspector host`, dom);
      frames.push({ file, phase, path: path.relative(root, target), sha256: imageSha256, bytes: bytes.length, dimensions, state: stateSummary(state), dom, transientToastSuppressedForCapture: true, ...extra });
    };

    await viewport(1366, 900, false);
    await reset();
    await mouseClick('button[data-tab="construction"]', 'open construction');
    await waitFor(`Boolean(document.querySelector('[data-command-id="construction:supply_depot"]'))`, 'construction tile');
    await capture(requiredFrames[0], 'construction_command_grid');
    await hover('[data-command-id="construction:armor_factory"]', 'locked construction');
    await capture(requiredFrames[1], 'construction_hover_tooltip', { tooltip: true });
    const constructionBefore = await gameState();
    await mouseClick('[data-command-id="construction:supply_depot"]', 'build supply depot');
    await waitFor('Boolean(window.__IRON_COMMAND__.getState().construction.current)', 'construction started');
    const constructionAfterClick = await gameState();
    assert(constructionAfterClick.construction.current.type === 'supply_depot', 'construction starts through tile');
    assert(constructionAfterClick.resources.alloy === constructionBefore.resources.alloy - 200, 'construction exact alloy deduction');
    await cdp.evaluate('window.advanceTime(9000)'); await sleep(180);
    await capture(requiredFrames[2], 'construction_active_progress', { actionViaTile: true });

    await seedProduction();
    await capture(requiredFrames[3], 'unit_production_command_grid');
    await hover('[data-command-id="unit:mbt"]', 'unit production');
    await capture(requiredFrames[4], 'unit_hover_tooltip', { tooltip: true });

    await seedProduction({ buildings: false, unlocks: false, research: false });
    await capture(requiredFrames[5], 'unit_locked_state');
    const lockedBefore = stateSummary(await gameState());
    await mouseClick('[data-command-id="unit:mbt"]', 'invalid locked unit attempt');
    const lockedAfter = stateSummary(await gameState());
    assert(JSON.stringify(lockedAfter) === JSON.stringify(lockedBefore), 'invalid locked click causes zero canonical mutation');

    await seedProduction({ resources: false });
    await capture(requiredFrames[6], 'unit_resource_insufficient');

    await seedProduction();
    const queueBefore = await gameState();
    await mouseClick('[data-command-id="unit:infantry"]', 'queue infantry 1');
    await mouseClick('[data-command-id="unit:infantry"]', 'queue infantry 2');
    await mouseClick('[data-command-id="unit:mbt"]', 'queue mbt 3');
    const queued = await gameState();
    assert(1 + queued.production.queue.length === 3, 'rapid clicks queue exactly once per click', stateSummary(queued));
    assert(queued.resources.supply === queueBefore.resources.supply - 420, 'rapid click resource deduction exactly once', { before: queueBefore.resources, after: queued.resources });
    await cdp.evaluate('window.advanceTime(4000)'); await sleep(180);
    await capture(requiredFrames[7], 'production_queue', { rapidClicks: 3 });
    await mouseClick('.command-queue [data-command-id^="queue:"]', 'open active queue inspector');
    await waitFor('Boolean(document.querySelector("#command-inspector-host:not([hidden])"))', 'queue inspector');
    await mouseClick('[data-inspector-action="cancel-current-production"]', 'cancel active through inspector');
    await waitFor('window.__IRON_COMMAND__.getState().production.current?.type === "infantry" || window.__IRON_COMMAND__.getState().production.current?.type === "mbt"', 'next queue item started');

    await seedProduction();
    await mouseClick('[data-category="equipment"]', 'open equipment category');
    await waitFor(`Boolean(document.querySelector('[data-command-id="equipment:anti_armor_sights"]'))`, 'equipment tile');
    await capture(requiredFrames[8], 'equipment_command_grid');
    await hover('[data-command-id="equipment:anti_armor_sights"]', 'equipment production');
    await capture(requiredFrames[9], 'equipment_hover_tooltip', { tooltip: true });
    const equipmentBefore = await gameState();
    await mouseClick('[data-command-id="equipment:anti_armor_sights"]', 'queue equipment');
    const equipmentAfter = await gameState();
    assert(equipmentAfter.production.current?.equipmentId === 'anti_armor_sights', 'equipment tile queues equipment');
    assert(equipmentAfter.resources.supply === equipmentBefore.resources.supply - 180, 'equipment exact single deduction');

    await seedProduction();
    const keyboardBefore = await gameState();
    await keyEnter('[data-command-id="unit:infantry"]', 'keyboard unit production');
    const keyboardAfter = await gameState();
    assert(Boolean(keyboardAfter.production.current) && keyboardAfter.production.queue.length === 0, 'keyboard Enter performs exactly one primary action');
    assert(keyboardAfter.resources.supply === keyboardBefore.resources.supply - 100, 'keyboard single deduction');

    await viewport(480, 860, true);
    await seedProduction();
    await capture(requiredFrames[10], 'mobile_480_production', { mobile: true });
    await viewport(390, 844, true);
    await sleep(180);
    await capture(requiredFrames[11], 'mobile_390_production', { mobile: true });

    const mobileTapBefore = await gameState();
    await touchTap('[data-command-id="unit:infantry"]', 'mobile tap production');
    const mobileTapAfter = await gameState();
    assert(Boolean(mobileTapAfter.production.current) && mobileTapAfter.production.queue.length === 0, 'mobile short tap performs exactly one primary action');
    assert(mobileTapAfter.resources.supply === mobileTapBefore.resources.supply - 100, 'mobile tap single deduction');
    await seedProduction();
    const mobileBefore = await gameState();
    const longPressResult = await pointerLongPress('[data-command-id="unit:mbt"]', 'mobile MBT inspector');
    assert(longPressResult.inspectorVisible, 'mobile inspector visible after long press', longPressResult);
    const mobileAfter = await gameState();
    assert(JSON.stringify(stateSummary(mobileAfter)) === JSON.stringify(stateSummary(mobileBefore)), 'long press never performs primary action');
    await capture(requiredFrames[12], 'mobile_inspector', { mobile: true, longPress: true });
    await mouseClick('.command-inspector-close', 'close mobile inspector');
    await pointerLongPress('[data-command-id="unit:mbt"]', 'movement cancellation', { move: true });
    assert(await cdp.evaluate('document.querySelector("#command-inspector-host").hidden'), 'movement cancels long press');
    await touchLongPress('[data-command-id="unit:mbt"]', 'pointer cancellation', { cancel: true });
    assert(await cdp.evaluate('document.querySelector("#command-inspector-host").hidden'), 'pointercancel cancels long press');

    await viewport(1024, 820, false);
    await seedProduction();
    const tabletLayout = await cdp.evaluate(`(() => { const tiles=Array.from(document.querySelectorAll('[data-command-scope="unit-production"] .command-tile')).slice(0,4).map((n)=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}); return {tiles, viewport:{width:innerWidth,height:innerHeight}}; })()`);
    assert(tabletLayout.tiles.length === 4 && tabletLayout.tiles[0].width >= 120 && tabletLayout.tiles[0].height >= 100, '1024 tablet command grid has usable tiles', tabletLayout);

    assert(pageErrors.length === 0, 'page errors are zero', pageErrors);
    assert(consoleErrors.length === 0, 'console errors are zero', consoleErrors);
    assert(frames.length === requiredFrames.length, 'all required frames captured', frames.map((frame) => frame.file));
    assert(hashes.size === requiredFrames.length, 'all frame hashes are unique', hashes.size);

    const evidence = {
      stage: '10-P-A',
      generatedBy: 'tests/browser/stage10-P-A-command-ui.mjs',
      frameCount: frames.length,
      requiredFrames,
      screenshots: frames,
      uniqueScreenshotCount: hashes.size,
      pageErrors,
      consoleErrors,
      actionProvenance: actions,
      assertions,
      desktopCoverage: true,
      tabletCoverage: true,
      mobileCoverage: { width480: true, width390: true },
      hoverCoverage: true,
      longPressCoverage: true,
      movementCancelCoverage: true,
      pointerCancelCoverage: true,
      keyboardCoverage: true,
      productionActionCoverage: { construction: true, unit: true, equipment: true, queueCancelViaInspector: true, rapidClicks: true, invalidZeroMutation: true },
      syntheticGameplayActionUsed: false,
      fixtureSeedingOnly: true,
      passed: true
    };
    await fs.writeFile(browserEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ stage: evidence.stage, passed: evidence.passed, frames: evidence.frameCount, unique: evidence.uniqueScreenshotCount, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length }));
  } finally {
    cdp?.close();
    await terminateManagedBrowser(browser).catch(() => {});
    if (server) await closeServer(server).catch(() => {});
    removeIsolatedTempRoot(isolatedRoot);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ stage: '10-P-A', passed: false, error: error?.message || String(error) }));
  console.error(error?.stack || error);
  process.exitCode = 1;
});
