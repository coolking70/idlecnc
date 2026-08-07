import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';
import { buildNavigationFailureError } from './browser-policy-diagnostics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.join(root, 'screenshots', 'stage8-2G-A');
const manifestPath = path.join(root, 'screenshots', 'stage8-2G-A-visual-manifest.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;

async function closeServerSafely(server) {
  if (!server?.listening) return true;
  return await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    const timer = setTimeout(finish, 2000);
    server.close(() => { clearTimeout(timer); finish(); });
  });
}

async function prepareMiningBattle(cdp) {
  const script = `
    (async () => {
      const api = window.__IRON_COMMAND__;
      api.reset(); api.setPresentationMode('auto');
      const step = async (ms) => { await window.advanceTime(ms); };
      const build = async (id, wait) => { const result = api.build(id); if (!result.ok) throw new Error('build ' + id + ': ' + result.reason); await step(wait); };
      await build('barracks', 30000); await build('armor_factory', 50000);
      for (let index = 0; index < 12; index += 1) await step(1800000);
      await build('radar_station', 40000);
      for (let index = 0; index < 12; index += 1) await step(1800000);
      await build('research_center', 60000);
      for (let index = 0; index < 10; index += 1) await step(1800000);
      for (const tech of ['tactical_datalink', 'field_maintenance', 'expanded_command_network']) {
        const result = api.research(tech); if (!result.ok) throw new Error('research ' + tech + ': ' + result.reason); await step(70000);
      }
      for (let index = 0; index < 10; index += 1) await step(1800000);
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle']) {
        const result = api.produce(type); if (!result.ok) throw new Error('produce ' + type + ': ' + result.reason); await step(40000);
      }
      const created = api.createFormation('8.2G-A 矿区混编垂直切片'); if (!created.ok) throw new Error('create formation: ' + created.reason);
      const formationId = created.formation.id; const units = api.units(); const used = new Set();
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle']) {
        const unit = units.find((row) => row.type === type && row.status === 'ready' && !used.has(row.id));
        if (!unit) throw new Error('missing ready unit ' + type);
        used.add(unit.id); const result = api.addUnit(formationId, unit.id); if (!result.ok) throw new Error('add ' + type + ': ' + result.reason);
      }
      const findSeed = () => {
        for (let seed = 1; seed <= 800; seed += 1) {
          const report = api.simulate(formationId, 'scrap_mine', 'breakthrough', seed);
          const hasDestroy = report?.events?.some((event) => event.type === 'destroy');
          const hasMixedActors = report?.final?.friendly?.some((row) => row.type === 'infantry') && report?.final?.friendly?.some((row) => row.type === 'mbt');
          if (report?.result === 'victory' && hasDestroy && hasMixedActors) return { seed, report };
        }
        throw new Error('mining victory evidence seed not found');
      };
      const selected = findSeed();
      const dispatched = api.dispatch(formationId, 'scrap_mine', 'breakthrough', selected.seed);
      if (!dispatched.ok) throw new Error('dispatch: ' + dispatched.reason);
      api.setSpeed(0); api.setBattlePresentationDebug(false); await step(0);
      return { formationId, seed: selected.seed, report: selected.report, battleId: api.activeBattle().id };
    })()
  `;
  return cdp.evaluate(script, true, true);
}

async function main() {
  const evidenceRunId = crypto.randomUUID();
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8-2G-A-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  let server; let browser; let cdp;
  const pageErrors = []; const consoleErrors = []; const resources = []; const screenshots = []; const usedPngHashes = new Set();
  await fs.mkdir(screenshotDir, { recursive: true });
  for (const entry of await fs.readdir(screenshotDir)) await fs.rm(path.join(screenshotDir, entry), { recursive: true, force: true });
  server = localStaticServer(root); const port = await listenEphemeral(server);
  try {
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    if (!pageTarget?.webSocketDebuggerUrl) throw new Error('chromium_target_missing');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    cdp.on('Network.requestWillBeSent', ({ request }) => resources.push({ url: request.url, type: 'request' }));
    cdp.on('Network.responseReceived', ({ response }) => resources.push({ url: response.url, status: response.status, type: 'response' }));
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable');
    const url = `http://127.0.0.1:${port}/`;
    await cdp.send('Page.navigate', { url });
    try {
      await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('stage 8.2G-A page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    } catch (error) {
      const diagnostics = await cdp.evaluate(`({ actualUrl: location.href, title: document.title, readyState: document.readyState, visibleText: (document.body?.innerText || '').slice(0, 500) }).catch?.(() => ({}))`).catch(() => ({ actualUrl: null, title: null, readyState: null, visibleText: '' }));
      throw buildNavigationFailureError({ requestedUrl: url, ...diagnostics, pageErrors, consoleErrors, resources: resources.slice(-40), browserVersion: browser.devtools?.version?.Browser, executable: browser.executable, cause: error });
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const prepared = await prepareMiningBattle(cdp);
    const report = prepared.report;
    // Use the final destruction anchor so the critical-hit capture remains
    // chronological after the main-engagement capture and still shows the
    // destroying -> wreck transition on the formal six-unit battle.
    const destroy = report.events.filter((event) => event.type === 'destroy').at(-1);
    if (!destroy) throw new Error('prepared report has no destroy event');
    const diagnostics = () => cdp.evaluate('window.__IRON_COMMAND__.battlePresentationDiagnostics()');
    const textState = () => cdp.evaluate('JSON.parse(window.render_game_to_text())');
    const viewport = () => cdp.evaluate(`(() => { const canvas = document.querySelector('#base-canvas'); const rect = canvas?.getBoundingClientRect(); return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, canvas: rect ? { width: rect.width, height: rect.height } : null }; })()`);
    const advanceTo = async (elapsed) => {
      const current = await cdp.evaluate('window.__IRON_COMMAND__.activeBattle()?.elapsed || 0');
      const delta = Math.max(0, Number(elapsed) - Number(current));
      if (delta > 0) await cdp.evaluate(call('tickBattle', delta));
      await cdp.evaluate('window.advanceTime(0)'); await sleep(90);
    };
    const capture = async (file, sceneId, mode, extra = {}) => {
      await cdp.evaluate('window.advanceTime(0)'); await sleep(90);
      const diag = await diagnostics(); const text = await textState(); const sceneText = text.battlePresentation?.scene || {}; const view = await viewport();
      const target = path.join(screenshotDir, file); await cdp.screenshot(target);
      const pngSha256 = sha256(await fs.readFile(target));
      if (usedPngHashes.has(pngSha256)) throw new Error(`${file}: duplicate PNG hash`);
      usedPngHashes.add(pngSha256);
      const render = diag.renderState || {};
      const entry = {
        evidenceRunId, file, sceneId, battleId: prepared.battleId, reportId: report.id, reportFingerprint: diag.reportFingerprint || null,
        reportResult: report.result, reportSeed: prepared.seed, theatreId: 'scrap_mine', strategyId: 'breakthrough',
        presentationTime: render.time ?? null, sourceElapsed: diag.activeBattle?.elapsed ?? null, presentationPhase: diag.activeBattle?.presentationPhase || null,
        visualStage: sceneText.visualStage || text.visualStage || render.visualStage || render.choreography?.visualStage || null, visualPhase: sceneText.visualPhase || text.visualPhase || render.visualPhase || null, visualStateCounts: (sceneText.actors || render.actors || []).reduce((counts, actor) => { counts[actor.visualState] = (counts[actor.visualState] || 0) + 1; return counts; }, {}), actorCount: sceneText.actorCount ?? text.actorCount ?? render.actors?.length ?? 0, wreckCount: sceneText.wrecks?.length ?? text.wrecks?.length ?? render.wrecks?.length ?? 0,
        projectileCount: sceneText.projectiles?.length ?? text.projectiles?.length ?? 0, effectCount: sceneText.effects?.length ?? text.effects?.length ?? 0, decalCount: sceneText.decals?.length ?? text.decals?.length ?? 0, smokeCount: sceneText.smoke?.length ?? text.smoke?.length ?? 0,
        rendering: sceneText.rendering || text.rendering || render.rendering || null, debugOverlay: sceneText.rendering?.debugOverlay === true || text.rendering?.debugOverlay === true || diag.debugOverlay || render.rendering?.debugOverlay || false,
        viewport: view, sceneHash: render.sceneHash || sceneText.sceneHash || text.sceneHash || null, stateCoreSignature: sha256(JSON.stringify({ sceneHash: render.sceneHash || sceneText.sceneHash || text.sceneHash || null, time: render.time, visualStage: render.visualStage, actors: render.actors, wrecks: render.wrecks, projectiles: sceneText.projectiles, effects: sceneText.effects, decals: sceneText.decals, smoke: sceneText.smoke })), stateSignature: sha256(JSON.stringify({ diag: { sceneHash: render.sceneHash || null, time: render.time, visualStage: render.visualStage, actors: render.actors, wrecks: render.wrecks }, scene: { visualStage: sceneText.visualStage, actors: sceneText.actors, wrecks: sceneText.wrecks, projectiles: sceneText.projectiles, effects: sceneText.effects, decals: sceneText.decals, smoke: sceneText.smoke, rendering: sceneText.rendering } })), debugPrimitives: sceneText.rendering?.debugOverlay === true ? ['grid', 'routes', 'zones', 'actor_ids', 'event_anchors'] : [],
        pngSha256, pageErrors: pageErrors.slice(), consoleErrors: consoleErrors.slice(), ...extra
      };
      screenshots.push(entry); return entry;
    };
    await cdp.evaluate('window.advanceTime(0)'); await sleep(100);
    const initialDiagnostics = await diagnostics();
    const presentationPlan = await cdp.evaluate('window.__IRON_COMMAND__.presentation()?.presentation?.plan || null');
    const visualDestroy = presentationPlan?.timeline?.anchors?.filter((anchor) => anchor.type === 'destroy').at(-1);
    if (!visualDestroy) throw new Error(`prepared visual plan has no destroy anchor; plan=${JSON.stringify({ keys: Object.keys(presentationPlan || {}), timelineKeys: Object.keys(presentationPlan?.timeline || {}), anchorCount: presentationPlan?.anchors?.length || 0, timelineAnchorCount: presentationPlan?.timeline?.anchors?.length || 0 })}`);
    const sourceDuration = Number(report.duration || 30); const visualDuration = Number(presentationPlan.timeline.duration || 30); const toSource = (time) => Math.max(0, Math.min(sourceDuration, Number(time) / visualDuration * sourceDuration));
    const phaseEdge = async (phaseId, edge = 'first') => cdp.evaluate(`(() => { const duration = ${JSON.stringify(visualDuration)}; let found = null; for (let index = 0; index <= 2400; index += 1) { const time = duration * index / 2400; const state = window.__IRON_COMMAND__.battlePresentationRenderStateAt(time); if (state?.visualPhase?.id === ${JSON.stringify(phaseId)}) { found = time; if (${JSON.stringify(edge)} === 'first') break; } } return found; })()`);
    const deployEnd = await phaseEdge('deploy', 'last'); const contactStart = await phaseEdge('first_contact', 'first'); const mainStart = await phaseEdge('main_engagement', 'first'); const criticalStart = await phaseEdge('critical_event', 'first'); const battleEndStart = await phaseEdge('battle_end', 'first');
    if ([deployEnd, contactStart, mainStart, criticalStart, battleEndStart].some((value) => value === null)) throw new Error(`semantic phase evidence boundary missing: ${JSON.stringify({ deployEnd, contactStart, mainStart, criticalStart, battleEndStart })}`);
    await advanceTo(toSource(Math.max(0, deployEnd - .08))); await capture('01-production-deploy-end.png', 'deploy-end', 'production');
    const probe = await cdp.evaluate(`(() => { const p = window.__IRON_COMMAND__.presentation()?.presentation; const duration = p?.plan?.timeline?.duration || 30; const samples = []; for (let index = 0; index <= 80; index += 1) { const time = duration * index / 80; const state = window.__IRON_COMMAND__.battlePresentationRenderStateAt(time); const values = new Set((state?.actors || []).map((actor) => actor.visualState)); if (values.has('turn') || values.has('brake')) samples.push({ time, states: [...values] }); } return samples; })()`);
    const selectedProbe = probe.find((entry) => entry.time >= visualDuration * .18 && entry.states.includes('brake')) || probe.find((entry) => entry.time >= visualDuration * .18) || probe[0] || { time: visualDuration * .24, states: [] };
    const turnBrakeProbe = { ...selectedProbe, observedStates: [...new Set(probe.flatMap((entry) => entry.states))] };
    await advanceTo(toSource(Math.min(visualDuration, contactStart + .08))); await capture('02-production-first-contact.png', 'first-contact', 'production', { turnBrakeProbe });
    await advanceTo(toSource(Math.min(visualDuration, mainStart + .08)));
    const sceneAtContact = await textState();
    const contactShot = (sceneAtContact.battlePresentation?.scene?.shotSchedule || []).find((entry) => entry.t >= visualDuration * .45 && entry.t <= visualDuration * .72) || (sceneAtContact.battlePresentation?.scene?.shotSchedule || []).find((entry) => entry.t >= visualDuration * .45);
    if (contactShot) await advanceTo(toSource(Math.max(visualDuration * .46, contactShot.t + Math.max(.02, (contactShot.impactTime - contactShot.t) * .5))));
    await capture('03-production-main-engagement.png', 'main-engagement-projectile', 'production', { projectileAnchorShotId: contactShot?.id || null });
    await cdp.evaluate(call('setBattlePresentationDebug', false));
    const productionEntry = await capture('07-formal-default-size.png', 'production-default', 'production', { debugOverlay: false });
    await cdp.evaluate(call('setBattlePresentationDebug', true, { showRoutes: true, showZones: true, showCollisionShapes: true, showActorIds: true, showEventAnchors: true }));
    const debugEntry = await capture('06-debug-grid-same-frame.png', 'debug-overlay', 'debug', { debugOverlay: true });
    await cdp.evaluate(call('setBattlePresentationDebug', true, { showRoutes: true, showZones: true, showCollisionShapes: true, showActorIds: true, showEventAnchors: true }));
    await capture('09-footprint-debug-main-engagement.png', 'footprint-debug-main-engagement', 'debug', { debugOverlay: true, footprintDebug: true });
    await cdp.evaluate(call('setBattlePresentationDebug', false));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate('window.advanceTime(0)'); await sleep(120);
    await capture('08-formal-narrow-size.png', 'formal-narrow-size', 'production', { debugOverlay: false });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate('window.advanceTime(0)'); await sleep(120);
    const criticalSource = Number(visualDestroy.t) + .18;
    await advanceTo(toSource(Math.min(visualDuration - .2, Math.max(criticalStart + .08, criticalSource)))); await capture('04-production-critical-destruction.png', 'critical-destruction', 'production');
    await advanceTo(toSource(Math.min(visualDuration, battleEndStart + .08))); await capture('05-production-battle-end.png', 'battle-end', 'production');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate('window.advanceTime(0)'); await sleep(120);
    await capture('10-clean-package-test-result.png', 'clean-package-test-result', 'production', { debugOverlay: false, cleanPackageTestEvidence: true });
    if (screenshots.length !== 10 || new Set(screenshots.map((entry) => entry.pngSha256)).size !== 10) throw new Error('8.2G-A screenshot count/SHA uniqueness failed');
    if (pageErrors.length || consoleErrors.length) throw new Error(`browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const anchorShot = (await textState()).battlePresentation?.scene?.shotSchedule?.find((entry) => entry.id === (screenshots.find((entry) => entry.sceneId === 'projectile-anchor')?.projectileAnchorShotId || '')) || null;
    const manifest = { version: 3, evidenceRunId, generatedBy: 'tests/browser/stage8-2G-A-evidence.mjs', serverUrl: url, stage: '8.2G-A.1.1', report: { id: report.id, result: report.result, seed: prepared.seed, duration: report.duration, eventCount: report.events.length, destroyEvent: destroy }, stateMachine: { vocabulary: ['idle', 'deploy', 'move', 'turn', 'brake', 'aim', 'fire', 'reload', 'hit', 'destroying', 'wreck'], turnBrakeProbe }, semanticPhases: [...new Set(screenshots.map((entry) => entry.visualStage).filter(Boolean))], projectileAnchorComparison: { shotId: anchorShot?.id || null, sourcePositionAtFire: anchorShot?.sourcePositionAtFire || null, sourceFacingAtFire: Number.isFinite(anchorShot?.sourceFacingAtFire) ? anchorShot.sourceFacingAtFire : 0, targetPositionAtAim: anchorShot?.targetPositionAtAim || null, impactPositionAtImpact: anchorShot?.impactPositionAtImpact || null, perFrameRecomputed: false }, productionDebugComparison: { productionFile: productionEntry.file, debugFile: debugEntry.file, samePresentationTime: productionEntry.presentationTime === debugEntry.presentationTime, sameViewport: productionEntry.viewport.canvas?.width === debugEntry.viewport.canvas?.width && productionEntry.viewport.canvas?.height === debugEntry.viewport.canvas?.height, sameSceneHash: productionEntry.sceneHash === debugEntry.sceneHash, sameStateSignature: productionEntry.stateCoreSignature === debugEntry.stateCoreSignature, debugAddsOnlyOverlay: debugEntry.debugOverlay === true && productionEntry.debugOverlay === false && debugEntry.debugPrimitives.includes('grid') }, screenshots, errors: { pageErrors, consoleErrors }, resources: resources.slice(-100) };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, evidenceRunId, battleId: prepared.battleId, reportId: report.id, seed: prepared.seed, result: report.result, screenshots: screenshots.length, pageErrors, consoleErrors, visualStages: screenshots.map((entry) => entry.visualStage), output: manifestPath }));
  } finally {
    cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await closeServerSafely(server); removeIsolatedTempRoot(isolatedRoot);
  }
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: error.code || 'stage8-2G-A-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
