import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_db1a_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_db1a_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-D-B-1a');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const forbiddenProductionStrings = ['Stage 8.2G', 'CURRENT_STAGE_LABEL', 'Production Visual Consumption & Evidence Hardening', 'stage8_2g_'];

function chooseActor(evidence, frame) {
  const predicate = evidence.productionSemanticPredicate || {};
  const preferred = frame.repairExpected ? predicate.repairSourceActorId : predicate.matchedActorIds?.[0];
  if (preferred && evidence.state.actors.some((actor) => actor.id === preferred && actor.alive !== false)) return preferred;
  return evidence.state.actors.find((actor) => actor.side === 'friendly' && actor.alive !== false)?.id || evidence.state.actors.find((actor) => actor.alive !== false)?.id || evidence.state.actors[0]?.id || null;
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-D-B.1a' || machine.frameCount !== 7 || machine.sceneCount !== 3) throw new Error('D-B.1a machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true }); await fs.rm(screenshotDir, { recursive: true, force: true }); await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-DB1a-'); const evidenceEnv = buildIsolatedTempEnv(isolatedRoot); const pageErrors = []; const consoleErrors = []; const hashes = new Set(); const scenes = []; const responsiveGeometry = []; let server; let browser; let cdp;
  try {
    server = localStaticServer(root); const port = await listenEphemeral(server); browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') }); const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`); const pageTarget = targets.find((target) => target.type === 'page'); cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception')); cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` }); await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('D-B.1a page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    const viewport = () => cdp.evaluate(`(() => { const rect = (selector) => { const node = document.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); const style = getComputedStyle(node); return { x: r.x, y: r.y, width: r.width, height: r.height, display: style.display, visibility: style.visibility }; }; const app = document.querySelector('#app'); const appStyle = app ? getComputedStyle(app) : null; return { innerWidth, innerHeight, app: rect('#app'), stage: rect('#stage'), canvas: rect('#base-canvas'), panel: rect('#panel'), logbar: rect('#logbar'), gridTemplateColumns: appStyle?.gridTemplateColumns || null, gridTemplateRows: appStyle?.gridTemplateRows || null }; })()`);
    const domText = () => cdp.evaluate('document.body?.innerText || ""');
    for (const scene of machine.scenes) {
      await cdp.evaluate(call('reset')); await cdp.evaluate(call('setPresentationMode', 'universal')); await cdp.evaluate(call('setBattlePresentationDebug', false)); const loaded = await cdp.evaluate(call('loadEvidenceBattle', { id: scene.sceneId, seed: scene.seed, report: scene.sourceReport })); if (!loaded?.ok) throw new Error(`D-B.1a scene load failed ${scene.sceneId}`);
      const capturedFrames = [];
      for (const frame of scene.frames) {
        const width = frame.viewportKind === 'narrow' ? 480 : 1280; const height = frame.viewportKind === 'narrow' ? 720 : 720;
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate(call('battlePresentationRenderAt', frame.visualTimeSeconds)); await sleep(85);
        const beforeSelection = await cdp.evaluate(call('battlePresentationEvidenceStateAt', frame.visualTimeSeconds, { sceneId: scene.sceneId, seed: scene.seed, semanticName: frame.semantic })); if (!beforeSelection?.ok) throw new Error(`D-B.1a evidence unavailable ${frame.file}`);
        if (beforeSelection.productionSemanticPredicate?.passed !== true) throw new Error(`D-B.1a semantic predicate failed ${frame.file}`);
        if (JSON.stringify(beforeSelection.productionSemanticPredicate) !== JSON.stringify(frame.semanticResolution.predicate)) throw new Error(`D-B.1a semantic recompute mismatch ${frame.file}`);
        if (beforeSelection.stateSignature !== frame.stateSignature) throw new Error(`D-B.1a state signature mismatch ${frame.file}`);
        const selectedActorId = chooseActor(beforeSelection, frame); if (!selectedActorId) throw new Error(`D-B.1a selection source missing ${frame.file}`);
        const selected = await cdp.evaluate(call('battlePresentationSelectActor', selectedActorId)); if (!selected?.ok) throw new Error(`D-B.1a selection mutation failed ${frame.file}`);
        await cdp.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const evidence = await cdp.evaluate(call('battlePresentationEvidenceStateAt', frame.visualTimeSeconds, { sceneId: scene.sceneId, seed: scene.seed, semanticName: frame.semantic })); if (!evidence?.ok) throw new Error(`D-B.1a post-selection evidence unavailable ${frame.file}`);
        if (evidence.stateSignature !== frame.stateSignature) throw new Error(`D-B.1a post-selection state signature mismatch ${frame.file}`);
        const selectedHudActorId = evidence.hudContract?.selection?.selectedActorId || evidence.hudContract?.selection?.selected?.id || null;
        if (evidence.selection?.selectedActorId !== selectedActorId || selectedHudActorId !== selectedActorId) throw new Error(`D-B.1a selection/HUD mismatch ${frame.file}`);
        if (frame.repairExpected) {
          const predicate = evidence.productionSemanticPredicate; if (evidence.selection.selectedActorId !== predicate.repairSourceActorId || selectedHudActorId !== predicate.repairSourceActorId) throw new Error(`D-B.1a repair source selection mismatch ${frame.file}`);
          if (predicate.repairTargetActorId !== frame.semanticResolution.predicate.repairTargetActorId) throw new Error(`D-B.1a repair target mismatch ${frame.file}`);
        }
        const visibleText = await domText(); const leaked = forbiddenProductionStrings.filter((item) => visibleText.includes(item)); if (leaked.length) throw new Error(`D-B.1a production DOM leak ${frame.file}: ${leaked.join(',')}`);
        const screenMetrics = await cdp.evaluate(call('battlePresentationScreenMetricsAt', frame.visualTimeSeconds)); if (!screenMetrics) throw new Error(`D-B.1a geometry unavailable ${frame.file}`);
        const pngPath = path.join(screenshotDir, frame.file); await cdp.screenshot(pngPath); const imageSha256 = sha(await fs.readFile(pngPath)); if (hashes.has(imageSha256)) throw new Error(`duplicate D-B.1a PNG ${frame.file}`); hashes.add(imageSha256);
        capturedFrames.push({ ...frame, selectedActorId: evidence.selection.selectedActorId, selectedHudActorId, repairSourceActorId: frame.repairExpected ? evidence.productionSemanticPredicate.repairSourceActorId : null, repairTargetActorId: frame.repairExpected ? evidence.productionSemanticPredicate.repairTargetActorId : null, formalRepairEventId: frame.repairExpected ? evidence.productionSemanticPredicate.formalRepairEventId : null, captureTimeMs: Number(evidence.state.time) * 1000, timestampDeltaMs: Number(evidence.state.time) * 1000 - frame.timeMs, viewport: await viewport(), screenMetrics, productionDom: { forbiddenStrings: leaked, visibleTextLength: visibleText.length }, productionSemanticPredicate: evidence.productionSemanticPredicate, stateSignature: evidence.stateSignature, hudContract: evidence.hudContract, selection: evidence.selection, imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
      }
      scenes.push({ sceneId: scene.sceneId, result: scene.result, seed: scene.seed, frames: capturedFrames });
    }
    const baseScene = machine.scenes[0]; await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 720, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate(call('battlePresentationRenderAt', 0)); await sleep(80); const geometry480 = await viewport();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await cdp.evaluate(call('battlePresentationRenderAt', 0)); await sleep(80); const geometry390 = await viewport();
    for (const [label, geometry] of [['480x720', geometry480], ['390x844', geometry390]]) { const battlefieldWidthRatio = geometry.canvas?.width / geometry.innerWidth || 0; const row = { label, ...geometry, battlefieldWidthRatio: Number(battlefieldWidthRatio.toFixed(4)), panelHidden: geometry.panel?.display === 'none', battleFirst: battlefieldWidthRatio >= .8 }; if (!row.battleFirst || !row.panelHidden) throw new Error(`D-B.1a responsive geometry failed ${label}`); responsiveGeometry.push(row); }
    const productionText = await domText(); const productionForbidden = forbiddenProductionStrings.filter((item) => productionText.includes(item)); const browserFrames = scenes.flatMap((scene) => scene.frames); const leakOutput = { stage: '8.2G-D-B.1a', scanned: true, forbiddenStrings: forbiddenProductionStrings, productionDomForbidden: productionForbidden, internalIdentifiersVisible: productionForbidden.length > 0, debugOverlayPreserved: true, passed: productionForbidden.length === 0 };
    const geometryOutput = { stage: '8.2G-D-B.1a', viewport: responsiveGeometry, productionBattleFirstLayout: responsiveGeometry.every((item) => item.battleFirst && item.panelHidden), passed: responsiveGeometry.every((item) => item.battleFirst && item.panelHidden) };
    await fs.writeFile(path.join(root, 'stage8_2g_db1a_responsive_geometry.json'), `${JSON.stringify(geometryOutput, null, 2)}\n`); await fs.writeFile(path.join(root, 'stage8_2g_db1a_production_leak_check.json'), `${JSON.stringify(leakOutput, null, 2)}\n`);
    if (pageErrors.length || consoleErrors.length) throw new Error(`D-B.1a browser errors ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = { stage: '8.2G-D-B.1a', version: 1, generatedBy: 'tests/browser/stage8-2G-D-B-1a-evidence.mjs', machineEvidenceFile: path.basename(machinePath), browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: browserFrames.length, uniqueImageHashes: hashes.size }, semantic: { checkedFrames: browserFrames.length, browserRecomputed: browserFrames.every((frame) => frame.productionSemanticPredicate?.passed === true), stateSignaturesMatched: browserFrames.every((frame) => frame.stateSignature === frame.semanticResolution.stateSignature), failClosed: true }, repairBinding: { frames: browserFrames.filter((frame) => frame.repairExpected).map((frame) => ({ file: frame.file, formalRepairEventId: frame.formalRepairEventId, repairSourceActorId: frame.repairSourceActorId, repairTargetActorId: frame.repairTargetActorId, selectedActorId: frame.selectedActorId, selectedHudActorId: frame.selectedHudActorId })), fourLayerSelectionBinding: browserFrames.filter((frame) => frame.repairExpected).every((frame) => frame.selectedActorId === frame.selectedHudActorId && frame.selectedActorId === frame.repairSourceActorId) }, responsive: geometryOutput, productionLeak: leakOutput, scenes, passed: true };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, screenshots: browser.length, uniqueImageHashes: hashes.size, repairFrames: output.repairBinding.frames.length, selectionBinding: output.repairBinding.fourLayerSelectionBinding, responsive: geometryOutput.passed, productionLeakFree: leakOutput.passed, output: manifestPath }));
  } finally { cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); try { removeIsolatedTempRoot(isolatedRoot); } catch {} }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage8-2G-DB1a-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
