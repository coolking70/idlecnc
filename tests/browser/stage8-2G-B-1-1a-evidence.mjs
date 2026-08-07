/* Stage 8.2G-B.1.1a browser capture.
 * The machine evidence file is the only frame target list. No legacy manifest,
 * screenshot or resolver output is used as a fallback. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';
import { buildNavigationFailureError } from './browser-policy-diagnostics.mjs';
import { semanticPredicateForName } from '../../js/battle-presentation/universal/evidence-integrity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_b11a_machine_semantic_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_b11a_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots', 'stage8-2G-B-1-1a');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function browserPredicates(frame, payload) {
  const eventTypes = (payload.activeAuthoritativeEvents || []).map((item) => item.type);
  const rearGuardIds = new Set((payload.retreatOrders || []).filter((item) => item.role === 'rear_guard').map((item) => item.actorId));
  const rearGuardCoverFire = rearGuardIds.size > 0 && (payload.suppressionSources || []).length > 0 && (payload.activePresentationShots || []).some((shot) => rearGuardIds.has(shot.attackerId));
  return semanticPredicateForName(frame.file, {
    phase: payload.phase,
    friendlyShotCount: (payload.activePresentationShots || []).filter((shot) => String(shot.attackerId || '').startsWith('unit_')).length,
    enemyShotCount: (payload.activePresentationShots || []).filter((shot) => !String(shot.attackerId || '').startsWith('unit_')).length,
    weaponFamilies: (payload.activePresentationShots || []).map((shot) => shot.weaponProfileId).filter(Boolean), suppressionTargets: payload.suppressionTargets || [], coverMoves: payload.coverMoves || [], targetSwitches: payload.targetSwitches || [],
    activeAuthoritativeEvents: eventTypes, retreatOrders: payload.retreatOrders || [], cameraInterest: payload.cameraInterest, rearGuardCoverFire
  });
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-B.1.1a' || machine.frameCount !== 24 || machine.browserFallbackAllowed !== false) throw new Error('machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true }); await fs.rm(screenshotDir, { recursive: true, force: true }); await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-B11a-'); const evidenceEnv = buildIsolatedTempEnv(isolatedRoot); const usedHashes = new Set(); const scenes = []; const pageErrors = []; const consoleErrors = []; let server; let browser; let cdp;
  try {
    server = localStaticServer(root); const port = await listenEphemeral(server);
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') }); const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`); const pageTarget = targets.find((target) => target.type === 'page'); if (!pageTarget?.webSocketDebuggerUrl) throw new Error('chromium_target_missing');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl)); cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception')); cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); }); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    const url = `http://127.0.0.1:${port}/`; await cdp.send('Page.navigate', { url });
    try { await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('stage 8.2G-B.1.1a page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`); } catch (error) { const diagnostics = await cdp.evaluate(`({ actualUrl: location.href, title: document.title, readyState: document.readyState, visibleText: (document.body?.innerText || '').slice(0, 500) }).catch?.(() => ({}))`).catch(() => ({})); throw buildNavigationFailureError({ requestedUrl: url, ...diagnostics, pageErrors, consoleErrors, browserVersion: browser.devtools?.version?.Browser, executable: browser.executable, cause: error }); }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const viewport = () => cdp.evaluate(`(() => { const canvas = document.querySelector('#base-canvas'); const rect = canvas?.getBoundingClientRect(); return { innerWidth, innerHeight, canvas: rect ? { width: rect.width, height: rect.height } : null }; })()`);
    const captureScene = async (machineScene) => {
      const loaded = await cdp.evaluate(call('reset')); if (loaded?.ok === false) throw new Error(`reset failed: ${JSON.stringify(loaded)}`);
      await cdp.evaluate(call('setPresentationMode', 'universal'));
      const installed = await cdp.evaluate(call('loadEvidenceBattle', { id: machineScene.sceneId, seed: machineScene.seed, report: machineScene.sourceReport })); if (!installed?.ok) throw new Error(`evidence battle load failed: ${machineScene.sceneId}`);
      await cdp.evaluate(call('setBattlePresentationDebug', machineScene.sceneId.startsWith('debug-'), { showRoutes: true, showZones: true, showActorIds: true, showEventAnchors: true, showEngagements: true, showSuppression: true, showRetreatOrder: true }));
      const current = { sourceTime: 0, visualTime: 0 }; const frames = [];
      for (const frame of machineScene.frames.slice().sort((a, b) => a.timeMs - b.timeMs)) {
        const visualSeconds = frame.timeMs / 1000; const sourceTarget = machineScene.sourceReport.duration && machineScene.visualDuration ? visualSeconds * machineScene.sourceReport.duration / machineScene.visualDuration : visualSeconds; const delta = Math.max(0, sourceTarget - current.sourceTime);
        if (delta > 0) await cdp.evaluate(call('tickBattle', delta)); current.sourceTime = sourceTarget; current.visualTime = visualSeconds; await cdp.evaluate('window.advanceTime(0)'); await sleep(45);
        const evidence = await cdp.evaluate(call('battlePresentationEvidenceStateAt', visualSeconds, { sceneId: machineScene.sceneId, seed: machineScene.seed })); if (!evidence?.ok) throw new Error(`browser evidence state unavailable: ${frame.file}`);
        const pngPath = path.join(screenshotDir, frame.file); await cdp.screenshot(pngPath); const png = await fs.readFile(pngPath); const imageSha256 = sha256(png); if (usedHashes.has(imageSha256)) throw new Error(`browser_capture_failed: duplicate PNG ${frame.file}`); usedHashes.add(imageSha256);
        const payload = evidence.payload; const browserFrame = { ...frame, semanticFrameId: frame.semanticFrameId, sceneId: machineScene.sceneId, seed: machineScene.seed, resolverTimeMs: frame.timeMs, captureTimeMs: payload.timeMs, timestampDeltaMs: payload.timeMs - frame.timeMs, viewport: await viewport(), sceneHash: evidence.state.sceneHash, stateSignature: evidence.stateSignature, browserStateSnapshot: payload, semanticPredicates: browserPredicates(frame, payload), imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } };
        if (browserFrame.sceneHash !== frame.sceneHash || browserFrame.stateSignature !== frame.stateSignature || browserFrame.semanticFrameId !== frame.semanticFrameId || Math.abs(browserFrame.timestampDeltaMs) > 16.7) throw new Error(`browser_capture_failed: machine/browser mismatch ${frame.file} ${JSON.stringify({ sceneHash: browserFrame.sceneHash === frame.sceneHash, stateSignature: browserFrame.stateSignature === frame.stateSignature, semanticFrameId: browserFrame.semanticFrameId === frame.semanticFrameId, timestampDeltaMs: browserFrame.timestampDeltaMs })}`);
        if (browserFrame.semanticPredicates[frame.requiredPredicate] !== true) throw new Error(`browser_capture_failed: required predicate ${frame.requiredPredicate} is false for ${frame.file}`);
        frames.push(browserFrame);
      }
      return { sceneId: machineScene.sceneId, result: machineScene.result, seed: machineScene.seed, sceneHash: machineScene.sceneHash, frames };
    };
    for (const machineScene of machine.scenes) scenes.push(await captureScene(machineScene));
    if (pageErrors.length || consoleErrors.length) throw new Error(`browser_capture_failed: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const flat = scenes.flatMap((scene) => scene.frames); if (flat.length !== 24) throw new Error(`browser_capture_failed: expected 24 frames, got ${flat.length}`);
    await fs.writeFile(manifestPath, JSON.stringify({ stage: '8.2G-B.1.1a', version: 1, generatedBy: 'tests/browser/stage8-2G-B-1-1a-evidence.mjs', independentAudit: false, machineEvidenceFile: path.basename(machinePath), machineEvidenceSha256: sha256(await fs.readFile(machinePath)), browser: { currentCodeCaptured: true, legacyFallbackUsed: false, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: flat.length }, scenes, binding: { machineEvidenceToBrowserCapture: true, browserStateReadFromCurrentRenderer: true, exactTimestampToleranceMs: 16.7, duplicateImageHashes: false } }, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, stage: '8.2G-B.1.1a', screenshots: flat.length, pageErrors, consoleErrors, output: manifestPath }));
  } finally { cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: error.code || 'browser_capture_failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
