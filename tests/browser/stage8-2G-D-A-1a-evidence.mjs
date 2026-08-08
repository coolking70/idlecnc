import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';
import { evaluateDA1SemanticPredicate } from '../lib/stage8-2G-DA1-semantic-predicates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_da1a_machine_semantic_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_da1a_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-D-A-1a');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-D-A.1a' || machine.frameCount !== 13 || machine.sceneCount !== 2) throw new Error('D-A.1a machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true }); await fs.rm(screenshotDir, { recursive: true, force: true }); await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-DA1a-'); const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = []; const consoleErrors = []; const imageHashes = new Map(); let server; let browser; let cdp;
  try {
    server = localStaticServer(root); const port = await listenEphemeral(server); browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`); const pageTarget = targets.find((target) => target.type === 'page'); cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('D-A.1a page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    const viewport = () => cdp.evaluate(`(() => { const rect = document.querySelector('#base-canvas')?.getBoundingClientRect(); return { innerWidth, innerHeight, canvas: rect ? { width: rect.width, height: rect.height } : null }; })()`);
    const capturedScenes = [];
    for (const scene of machine.scenes) {
      const loaded = await cdp.evaluate(call('loadEvidenceBattle', { id: scene.sceneId, seed: scene.seed, report: scene.sourceReport })); if (!loaded?.ok) throw new Error(`D-A.1a scene load failed ${scene.sceneId}`);
      await cdp.evaluate(call('setSpeed', 0)); const capturedFrames = [];
      for (const frame of scene.frames) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: frame.viewportKind === 'narrow' ? 780 : 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await cdp.evaluate(call('battlePresentationSetAssetDisabled', 'unit_friendly_infantry', frame.fallbackExpected === true)); await cdp.evaluate(call('battlePresentationRenderAt', frame.visualTimeSeconds));
        const assetRuntime = frame.fallbackExpected ? await cdp.evaluate(`window.__IRON_COMMAND__.battlePresentationAssetStatus?.()`) : await cdp.evaluate(`new Promise((resolve) => { const start = performance.now(); const poll = () => { const state = window.__IRON_COMMAND__.battlePresentationAssetStatus?.(); if (state?.allReady || performance.now() - start > 3000) resolve(state); else setTimeout(poll, 50); }; poll(); })`);
        await sleep(60); const evidence = await cdp.evaluate(call('battlePresentationEvidenceStateAt', frame.visualTimeSeconds, { sceneId: scene.sceneId, seed: scene.seed, semanticName: frame.semantic })); if (!evidence?.ok) throw new Error(`D-A.1a evidence state unavailable ${frame.file}`);
        const screenMetrics = await cdp.evaluate(call('battlePresentationScreenMetricsAt', frame.visualTimeSeconds)); if (!screenMetrics) throw new Error(`D-A.1a runtime screen metrics unavailable ${frame.file}`);
        const predicate = evaluateDA1SemanticPredicate(frame.semantic, { state: evidence.state, screenMetrics, timeSeconds: Number(evidence.state.time), viewportKind: frame.viewportKind, fallbackExpected: frame.fallbackExpected === true }); if (!predicate.passed) throw new Error(`D-A.1a browser semantic predicate failed ${frame.file}: ${JSON.stringify(predicate)}`);
        const pngPath = path.join(screenshotDir, frame.file); await cdp.screenshot(pngPath); const imageSha256 = sha(await fs.readFile(pngPath)); if (imageHashes.has(imageSha256)) throw new Error(`duplicate D-A.1a PNG ${frame.file}`); imageHashes.set(frame.semanticFrameId, imageSha256);
        const actualTimeMs = Number(evidence.state.time) * 1000; if (Math.abs(actualTimeMs - frame.timeMs) > 16.7) throw new Error(`D-A.1a browser timestamp ${frame.file}`);
        const rows = screenMetrics.actors || []; if (rows.some((row) => row.rendererGeometrySource !== 'production-final-draw-geometry')) throw new Error(`D-A.1a non-production geometry ${frame.file}`); if (frame.viewportKind === 'narrow' && rows.some((row) => Number(row.screenFootprint) < Number(row.minimumScreenFootprint))) throw new Error(`D-A.1a narrow footprint ${frame.file}`);
        if (frame.fallbackExpected) { const fallback = rows.find((row) => row.actorId === 'unit_stage8g-c1-mining-0'); if (!fallback || fallback.actualDrawPath !== 'procedural-fallback') throw new Error(`D-A.1a fallback path missing ${frame.file}`); } else if (!assetRuntime?.allReady) throw new Error(`D-A.1a asset runtime not ready ${frame.file}`);
        capturedFrames.push({ ...frame, captureTimeMs: actualTimeMs, timestampDeltaMs: actualTimeMs - frame.timeMs, viewport: await viewport(), stateSignature: evidence.c1StateSignature, environmentSignature: evidence.state.environment?.signature || null, destructionSignature: evidence.state.destruction?.signature || null, predicate, screenMetrics, assetRuntime: { allReady: assetRuntime?.allReady === true, assets: assetRuntime?.assets || [] }, imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 }, browserStateSnapshot: evidence.state });
      }
      capturedScenes.push({ sceneId: scene.sceneId, result: scene.result, seed: scene.seed, sceneHash: scene.sceneHash, fixtureType: scene.fixtureType, frames: capturedFrames });
    }
    if (pageErrors.length || consoleErrors.length) throw new Error(`D-A.1a browser errors ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const machineBytes = await fs.readFile(machinePath); const output = { stage: '8.2G-D-A.1a', version: 1, generatedBy: 'tests/browser/stage8-2G-D-A-1a-evidence.mjs', independentAudit: false, machineEvidenceFile: path.basename(machinePath), machineEvidenceSha256: sha(machineBytes), browser: { currentCodeCaptured: true, legacyFallbackUsed: false, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: capturedScenes.reduce((sum, scene) => sum + scene.frames.length, 0), uniqueImageHashes: new Set(imageHashes.values()).size }, scenes: capturedScenes, binding: { machineEvidenceToBrowserCapture: true, browserStateReadFromCurrentRenderer: true, semanticPredicateRecomputedFromCurrentState: true, finalDrawGeometryFromRenderer: true, animationResolverFromProductionRenderer: true, assetRuntimeStateFromRenderer: true, fallbackFrame: 'runtime-disabled-asset', exactTimestampToleranceMs: 16.7, nonTurretFacingPredicate: true } };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: output.scenes.length, screenshots: output.browser.captureCount, uniqueImageHashes: output.browser.uniqueImageHashes, pageErrors, consoleErrors, output: manifestPath }));
  } finally { cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage8-2G-DA1a-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
