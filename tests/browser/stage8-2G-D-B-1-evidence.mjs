import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_db1_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_db1_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-D-B-1');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const forbiddenProductionStrings = ['Stage 8.2G', 'CURRENT_STAGE_LABEL', 'Production Visual Consumption & Evidence Hardening', 'stage8_2g_'];

function chooseActor(state, semantic) {
  const actors = state?.actors || [];
  if (semantic.includes('scout')) return actors.find((actor) => String(actor.type).includes('scout') && actor.alive) || actors.find((actor) => String(actor.type).includes('scout'));
  if (semantic.includes('repair')) return actors.find((actor) => actor.type === 'repair_vehicle' && actor.alive) || actors.find((actor) => actor.type === 'repair_vehicle');
  if (semantic.includes('support')) return actors.find((actor) => String(actor.type).includes('support') && actor.alive) || actors.find((actor) => String(actor.type).includes('support'));
  return actors.find((actor) => actor.side === 'friendly' && actor.alive) || actors.find((actor) => actor.alive) || actors[0];
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-D-B.1' || machine.frameCount !== 10 || machine.sceneCount !== 3) throw new Error('D-B.1 machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true }); await fs.rm(screenshotDir, { recursive: true, force: true }); await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-DB1-'); const evidenceEnv = buildIsolatedTempEnv(isolatedRoot); const pageErrors = []; const consoleErrors = []; const hashes = new Set(); const scenes = []; let server; let browser; let cdp;
  try {
    server = localStaticServer(root); const port = await listenEphemeral(server); browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') }); const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`); const pageTarget = targets.find((target) => target.type === 'page'); cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception')); cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('D-B.1 page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    const viewport = () => cdp.evaluate(`(() => { const rect = (selector) => { const node = document.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); const style = getComputedStyle(node); return { x: r.x, y: r.y, width: r.width, height: r.height, display: style.display, visibility: style.visibility }; }; const app = document.querySelector('#app'); const appStyle = app ? getComputedStyle(app) : null; return { innerWidth, innerHeight, app: rect('#app'), stage: rect('#stage'), canvas: rect('#base-canvas'), panel: rect('#panel'), logbar: rect('#logbar'), gridTemplateColumns: appStyle?.gridTemplateColumns || null, gridTemplateRows: appStyle?.gridTemplateRows || null }; })()`);
    const productionDomText = () => cdp.evaluate(`document.body?.innerText || ''`);
    const debugText = () => cdp.evaluate('JSON.parse(window.render_game_to_text())');
    const responsiveGeometry = [];
    for (const scene of machine.scenes) {
      await cdp.evaluate(call('reset')); await cdp.evaluate(call('setPresentationMode', 'universal')); await cdp.evaluate(call('setBattlePresentationDebug', false)); const loaded = await cdp.evaluate(call('loadEvidenceBattle', { id: scene.sceneId, seed: scene.seed, report: scene.sourceReport })); if (!loaded?.ok) throw new Error(`D-B.1 scene load failed ${scene.sceneId}`);
      const capturedFrames = [];
      for (const frame of scene.frames) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: frame.viewportKind === 'narrow' ? 480 : 1280, height: frame.viewportKind === 'narrow' ? 720 : 720, deviceScaleFactor: 1, mobile: false });
        await cdp.evaluate(call('setBattlePresentationDebug', frame.debugOverlay === true)); const rendered = await cdp.evaluate(call('battlePresentationRenderAt', frame.visualTimeSeconds)); if (!rendered || Math.abs(Number(rendered.time || 0) - Number(frame.visualTimeSeconds)) > .001) throw new Error(`D-B.1 exact seek mismatch ${frame.file}`);
        await sleep(60); const evidence = await cdp.evaluate(call('battlePresentationEvidenceStateAt', frame.visualTimeSeconds, { sceneId: scene.sceneId, seed: scene.seed, semanticName: frame.semantic })); if (!evidence?.ok) throw new Error(`D-B.1 evidence state unavailable ${frame.file}`);
        const screenMetrics = await cdp.evaluate(call('battlePresentationScreenMetricsAt', frame.visualTimeSeconds)); if (!screenMetrics) throw new Error(`D-B.1 geometry unavailable ${frame.file}`);
        const selected = chooseActor(evidence.state, frame.semantic); if (selected?.id) await cdp.evaluate(call('battlePresentationSelectActor', selected.id));
        const domText = await productionDomText(); const leaked = frame.debugOverlay ? [] : forbiddenProductionStrings.filter((item) => domText.includes(item)); if (leaked.length) throw new Error(`D-B.1 production DOM leak ${frame.file}: ${leaked.join(',')}`);
        if (frame.semanticCheck) {
          if (!evidence.productionSemanticPredicate?.passed) throw new Error(`D-B.1 browser semantic predicate failed ${frame.file}`);
          if (JSON.stringify(evidence.productionSemanticPredicate) !== JSON.stringify(frame.semanticResolution.predicate)) throw new Error(`D-B.1 browser semantic recompute mismatch ${frame.file}`);
          if (evidence.stateSignature !== frame.stateSignature) throw new Error(`D-B.1 semantic state signature mismatch ${frame.file}`);
        }
        if (frame.semantic === 'victory-result' && evidence.hudContract?.resultPanel?.result !== 'victory') throw new Error('D-B.1 victory HUD binding missing');
        if (frame.semantic === 'defeat-result' && evidence.hudContract?.resultPanel?.result !== 'withdraw') throw new Error('D-B.1 defeat HUD binding missing');
        if (frame.debugOverlay) { const debug = await debugText(); if (debug.battlePresentation?.rendering?.debugOverlay !== true || !debug.stageLabel) throw new Error('D-B.1 debug diagnostics were not preserved'); }
        const pngPath = path.join(screenshotDir, frame.file); await cdp.screenshot(pngPath); const imageSha256 = sha(await fs.readFile(pngPath)); if (hashes.has(imageSha256)) throw new Error(`duplicate D-B.1 PNG ${frame.file}`); hashes.add(imageSha256);
        const captured = { ...frame, selectedActorId: evidence.selection?.selectedActorId || selected?.id || null, captureTimeMs: Number(evidence.state.time) * 1000, timestampDeltaMs: Number(evidence.state.time) * 1000 - frame.timeMs, viewport: await viewport(), screenMetrics, productionDom: { forbiddenStrings: leaked, visibleTextLength: domText.length }, productionSemanticPredicate: evidence.productionSemanticPredicate || null, hudContract: evidence.hudContract || null, imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } };
        if (frame.viewportKind === 'narrow' && captured.viewport.canvas?.width / captured.viewport.innerWidth < .8) throw new Error(`D-B.1 narrow battlefield width contract failed ${frame.file}`);
        capturedFrames.push(captured);
      }
      scenes.push({ sceneId: scene.sceneId, result: scene.result, seed: scene.seed, frames: capturedFrames });
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 720, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate(call('setBattlePresentationDebug', false)); await cdp.evaluate(call('battlePresentationRenderAt', 0)); await sleep(50); const geometry480 = await viewport();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate(call('battlePresentationRenderAt', 0)); await sleep(50); const geometry390 = await viewport();
    for (const [label, geometry] of [['480x720', geometry480], ['390x844', geometry390]]) { if (!geometry.stage || !geometry.canvas || geometry.canvas.width / geometry.innerWidth < .8 || geometry.stage.height < geometry.innerHeight * .55 || geometry.panel?.display !== 'none') throw new Error(`D-B.1 responsive geometry failed ${label}: ${JSON.stringify(geometry)}`); responsiveGeometry.push({ label, ...geometry, battlefieldWidthRatio: Number((geometry.canvas.width / geometry.innerWidth).toFixed(4)), panelHidden: geometry.panel?.display === 'none', battleFirst: geometry.canvas.width / geometry.innerWidth >= .8 }); }
    const productionText = await productionDomText(); const productionForbidden = forbiddenProductionStrings.filter((item) => productionText.includes(item)); const debug = await cdp.evaluate(call('setBattlePresentationDebug', true)); const debugPayload = await debugText(); const leakOutput = { stage: '8.2G-D-B.1', scanned: true, forbiddenStrings: forbiddenProductionStrings, productionDomForbidden: productionForbidden, internalIdentifiersVisible: productionForbidden.length > 0, debugOverlayPreserved: debugPayload.battlePresentation?.rendering?.debugOverlay === true && Boolean(debugPayload.stageLabel), debugState: debug, passed: productionForbidden.length === 0 && debugPayload.battlePresentation?.rendering?.debugOverlay === true && Boolean(debugPayload.stageLabel) };
    const geometryOutput = { stage: '8.2G-D-B.1', viewport: responsiveGeometry, productionBattleFirstLayout: responsiveGeometry.every((item) => item.battleFirst && item.panelHidden), passed: responsiveGeometry.every((item) => item.battleFirst && item.panelHidden) };
    await fs.writeFile(path.join(root, 'stage8_2g_db1_responsive_geometry.json'), `${JSON.stringify(geometryOutput, null, 2)}\n`); await fs.writeFile(path.join(root, 'stage8_2g_db1_production_leak_check.json'), `${JSON.stringify(leakOutput, null, 2)}\n`);
    if (pageErrors.length || consoleErrors.length) throw new Error(`D-B.1 browser errors ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const flat = scenes.flatMap((scene) => scene.frames); const output = { stage: '8.2G-D-B.1', version: 1, generatedBy: 'tests/browser/stage8-2G-D-B-1-evidence.mjs', machineEvidenceFile: path.basename(machinePath), machineEvidenceSha256: sha(await fs.readFile(machinePath)), browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: flat.length, uniqueImageHashes: hashes.size }, semantic: { checkedFrames: flat.filter((frame) => frame.semanticCheck).length, browserRecomputed: flat.filter((frame) => frame.semanticCheck).every((frame) => frame.productionSemanticPredicate?.passed === true), stateSignaturesMatched: flat.filter((frame) => frame.semanticCheck).every((frame) => frame.stateSignature === frame.semanticResolution?.stateSignature), failClosed: true }, responsive: geometryOutput, productionLeak: leakOutput, scenes, passed: true };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, screenshots: flat.length, uniqueImageHashes: hashes.size, semanticFrames: output.semantic.checkedFrames, responsive: geometryOutput.passed, productionLeakFree: leakOutput.passed, output: manifestPath }));
  } finally { cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage8-2G-DB1-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
