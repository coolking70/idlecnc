import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_db_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_db_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-D-B');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chooseActor(state, kind) {
  const actors = state?.actors || [];
  if (kind === 'enemy') return actors.find((actor) => actor.side === 'enemy' && actor.alive) || actors.find((actor) => actor.side === 'enemy');
  if (kind === 'scout') return actors.find((actor) => String(actor.type).includes('scout') && actor.alive) || actors.find((actor) => String(actor.type).includes('scout'));
  if (kind === 'repair') return actors.find((actor) => actor.type === 'repair_vehicle' && actor.alive) || actors.find((actor) => actor.type === 'repair_vehicle');
  if (kind === 'support') return actors.find((actor) => String(actor.type).includes('support') && actor.alive) || actors.find((actor) => String(actor.type).includes('support'));
  if (kind === 'damaged') return actors.find((actor) => actor.alive && Number(actor.hp) < Number(actor.maxHp)) || actors.find((actor) => actor.side === 'friendly' && actor.alive);
  return actors.find((actor) => actor.side === 'friendly' && actor.alive) || actors.find((actor) => actor.alive) || actors[0];
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-D-B' || machine.frameCount !== 16 || machine.sceneCount !== 3) throw new Error('D-B machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true }); await fs.rm(screenshotDir, { recursive: true, force: true }); await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-DB-'); const evidenceEnv = buildIsolatedTempEnv(isolatedRoot); const pageErrors = []; const consoleErrors = []; const hashes = new Set(); const scenes = []; let server; let browser; let cdp;
  try {
    server = localStaticServer(root); const port = await listenEphemeral(server); browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') }); const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`); const pageTarget = targets.find((target) => target.type === 'page'); cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('D-B page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    const viewport = () => cdp.evaluate(`(() => { const rect = document.querySelector('#base-canvas')?.getBoundingClientRect(); return { innerWidth, innerHeight, canvas: rect ? { width: rect.width, height: rect.height } : null }; })()`);
    for (const scene of machine.scenes) {
      await cdp.evaluate(call('reset')); await cdp.evaluate(call('setPresentationMode', 'universal')); await cdp.evaluate(call('setBattlePresentationDebug', false)); const loaded = await cdp.evaluate(call('loadEvidenceBattle', { id: scene.sceneId, seed: scene.seed, report: scene.sourceReport })); if (!loaded?.ok) throw new Error(`D-B scene load failed ${scene.sceneId}`);
      const capturedFrames = [];
      for (const frame of scene.frames) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: frame.viewportKind === 'narrow' ? 480 : 1280, height: frame.viewportKind === 'narrow' ? 720 : 720, deviceScaleFactor: 1, mobile: false });
        if (frame.fallbackExpected) { const reload = await cdp.evaluate(call('loadEvidenceBattle', { id: scene.sceneId, seed: scene.seed, report: scene.sourceReport })); if (!reload?.ok) throw new Error(`D-B fallback reload failed ${frame.file}`); await cdp.evaluate(call('setPresentationMode', 'universal')); }
        const previewState = await cdp.evaluate(call('battlePresentationRenderStateAt', frame.visualTimeSeconds)); const selectionActor = chooseActor(previewState, frame.selectionType); if (selectionActor?.id) await cdp.evaluate(call('battlePresentationSelectActor', selectionActor.id));
        await cdp.evaluate(call('battlePresentationSetAssetDisabled', 'unit_friendly_scout_car', frame.fallbackExpected === true)); const rendered = await cdp.evaluate(call('battlePresentationRenderAt', frame.visualTimeSeconds)); if (!rendered || Math.abs(Number(rendered.time || 0) - Number(frame.visualTimeSeconds)) > .001) throw new Error(`D-B exact render seek mismatch ${frame.file}: ${JSON.stringify({ expected: frame.visualTimeSeconds, actual: rendered?.time })}`);
        const assetRuntime = await cdp.evaluate(`new Promise((resolve) => { const start = performance.now(); const poll = () => { const state = window.__IRON_COMMAND__.battlePresentationAssetStatus?.(); if (state?.allReady || performance.now() - start > 3500) resolve(state); else setTimeout(poll, 50); }; poll(); })`);
        await sleep(75); const evidence = await cdp.evaluate(call('battlePresentationEvidenceStateAt', frame.visualTimeSeconds, { sceneId: scene.sceneId, seed: scene.seed, semanticName: frame.semantic })); if (!evidence?.ok) throw new Error(`D-B evidence state unavailable ${frame.file}`);
        const screenMetrics = await cdp.evaluate(call('battlePresentationScreenMetricsAt', frame.visualTimeSeconds)); if (!screenMetrics) throw new Error(`D-B geometry unavailable ${frame.file}`);
        const rows = screenMetrics.actors || []; if (rows.some((row) => row.rendererGeometrySource !== 'production-final-draw-geometry')) throw new Error(`D-B non-production geometry ${frame.file}`); if (frame.viewportKind === 'narrow' && rows.some((row) => Number(row.screenFootprint) < Number(row.minimumScreenFootprint))) throw new Error(`D-B narrow footprint ${frame.file}`);
        if (frame.fallbackExpected) { const fallback = rows.find((row) => row.assetId === 'unit_friendly_scout_car' || row.actorId === selectionActor?.id); if (!fallback || fallback.actualDrawPath !== 'procedural-fallback') throw new Error(`D-B fallback path missing ${frame.file}`); } else if (!assetRuntime?.allReady) throw new Error(`D-B asset runtime not ready ${frame.file}`);
        if (!evidence.hudContract?.sources || evidence.hudContract.sources.objective !== 'formal_objective_data') throw new Error(`D-B HUD authority binding missing ${frame.file}`);
        if (frame.semantic === 'repair-action') { const repair = evidence.state.actors.find((actor) => actor.type === 'repair_vehicle'); if (repair?.drawSpec?.animation !== 'repair' || repair.visualStatus !== 'repairing') throw new Error(`D-B repair state missing ${frame.file}`); }
        if (['scout-move', 'scout-fire', 'support-unarmed', 'cover-advance', 'retreat-rear-guard'].includes(frame.semantic) && evidence.productionSemanticPredicate?.passed !== true) throw new Error(`D-B production semantic predicate missing ${frame.file}`);
        if (frame.semantic === 'victory-result' && evidence.hudContract.resultPanel?.result !== 'victory') throw new Error('D-B victory result binding missing');
        if (frame.semantic === 'defeat-result' && evidence.hudContract.resultPanel?.result !== 'withdraw') throw new Error('D-B defeat result binding missing');
        const pngPath = path.join(screenshotDir, frame.file); await cdp.screenshot(pngPath); const imageSha256 = sha(await fs.readFile(pngPath)); if (hashes.has(imageSha256)) throw new Error(`duplicate D-B PNG ${frame.file}`); hashes.add(imageSha256);
        const actualTimeMs = Number(evidence.state.time) * 1000; if (Math.abs(actualTimeMs - frame.timeMs) > 16.7) throw new Error(`D-B browser timestamp ${frame.file}`);
        capturedFrames.push({ ...frame, selectedActorId: evidence.selection?.selectedActorId || null, captureTimeMs: actualTimeMs, timestampDeltaMs: actualTimeMs - frame.timeMs, viewport: await viewport(), stateSignature: evidence.c1StateSignature, productionSemanticPredicate: evidence.productionSemanticPredicate || null, screenMetrics, hudContract: evidence.hudContract, selection: evidence.selection, assetRuntime: { allReady: assetRuntime?.allReady === true, assets: assetRuntime?.assets || [] }, imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 }, browserStateSnapshot: evidence.state });
      }
      scenes.push({ sceneId: scene.sceneId, result: scene.result, seed: scene.seed, fixtureType: scene.fixtureType, frames: capturedFrames });
    }
    if (pageErrors.length || consoleErrors.length) throw new Error(`D-B browser errors ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const flat = scenes.flatMap((scene) => scene.frames); const output = { stage: '8.2G-D-B', version: 1, generatedBy: 'tests/browser/stage8-2G-D-B-evidence.mjs', independentAudit: false, machineEvidenceFile: path.basename(machinePath), machineEvidenceSha256: sha(await fs.readFile(machinePath)), browser: { currentCodeCaptured: true, legacyFallbackUsed: false, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: flat.length, uniqueImageHashes: hashes.size }, scenes, binding: { machineEvidenceToBrowserCapture: true, browserStateReadFromCurrentRenderer: true, universalDefaultProductionMode: true, finalDrawGeometryFromRenderer: true, animationResolverFromProductionRenderer: true, assetRuntimeStateFromRenderer: true, hudContractFromRenderer: true, selectionFromRenderer: true, resultFromFormalPlan: true, fallbackFrame: 'runtime-disabled-asset', narrowViewport: true, exactTimestampToleranceMs: 16.7, duplicateImageHashes: false } };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: scenes.length, screenshots: flat.length, uniqueImageHashes: hashes.size, pageErrors, consoleErrors, output: manifestPath }));
  } finally { cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage8-2G-DB-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
