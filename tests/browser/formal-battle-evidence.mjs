import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { FORMAL_EVIDENCE_FILES, FORMAL_EVIDENCE_MANIFEST } from './formal-battle-evidence-config.js';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { prepareFormalWithdrawBattle } from './formal-withdraw-evidence.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';
import { buildNavigationFailureError } from './browser-policy-diagnostics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const screenshotDir = path.isAbsolute(process.env.IRON_COMMAND_EVIDENCE_DIR || '')
  ? process.env.IRON_COMMAND_EVIDENCE_DIR
  : path.join(root, process.env.IRON_COMMAND_EVIDENCE_DIR || 'screenshots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;

function inverseTimeMap(timeMap, presentation) {
  const knots = (timeMap?.knots || []).slice().sort((a, b) => a.presentation - b.presentation);
  if (!knots.length || presentation <= knots[0].presentation) return knots[0]?.source || 0;
  for (let index = 1; index < knots.length; index += 1) {
    const left = knots[index - 1]; const right = knots[index];
    if (presentation <= right.presentation) {
      const amount = (presentation - left.presentation) / Math.max(1e-6, right.presentation - left.presentation);
      return left.source + (right.source - left.source) * amount;
    }
  }
  return knots.at(-1).source;
}

async function closeServerSafely(server) {
  if (!server) return true;
  if (!server.listening) return true;
  return await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    const timer = setTimeout(finish, 2000);
    server.close(() => { clearTimeout(timer); finish(); });
  });
}

async function prepareFormalBattle(cdp) {
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
      for (const tech of ['tactical_datalink', 'field_maintenance', 'expanded_command_network']) { const result = api.research(tech); if (!result.ok) throw new Error('research ' + tech + ': ' + result.reason); await step(70000); }
      for (let index = 0; index < 10; index += 1) await step(1800000);
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle']) { const result = api.produce(type); if (!result.ok) throw new Error('produce ' + type + ': ' + result.reason); await step(40000); }
      const created = api.createFormation('正式胜利取证编队'); if (!created.ok) throw new Error('create formation: ' + created.reason);
      const formationId = created.formation.id; const units = api.units(); const used = new Set();
      for (const type of ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle']) {
        const unit = units.find((row) => row.type === type && row.status === 'ready' && !used.has(row.id)); if (!unit) throw new Error('missing ready unit ' + type);
        used.add(unit.id); const result = api.addUnit(formationId, unit.id); if (!result.ok) throw new Error('add ' + type + ': ' + result.reason);
      }
      const findSeed = (theaterId, predicate) => { for (let seed = 1; seed <= 800; seed += 1) { const report = api.simulate(formationId, theaterId, 'breakthrough', seed); if (report && predicate(report)) return { seed, report }; } throw new Error('evidence seed not found for ' + theaterId); };
      const captureSeed = findSeed('scrap_mine', (report) => report.result === 'victory' && report.final.friendly.every((row) => row.alive));
      const capture = api.dispatch(formationId, 'scrap_mine', 'breakthrough', captureSeed.seed); if (!capture.ok) throw new Error('capture dispatch: ' + capture.reason);
      api.tickBattle(999); api.tickBattleReturn(5);
      const formalSeed = findSeed('border_road', (report) => report.result === 'victory' && report.events.some((event) => event.type === 'repair') && report.events.some((event) => event.type === 'destroy' && String(event.target || '').startsWith('enemy_')));
      const dispatched = api.dispatch(formationId, 'border_road', 'breakthrough', formalSeed.seed); if (!dispatched.ok) throw new Error('formal dispatch: ' + dispatched.reason);
      api.setSpeed(0); await step(0);
      return { captureSeed: captureSeed.seed, formalSeed: formalSeed.seed, report: api.activeBattle().report, battleId: api.activeBattle().id };
    })()
  `;
  return cdp.evaluate(script, true, true);
}

async function main() {
  const evidenceRunId = crypto.randomUUID();
  const isolatedRoot = createIsolatedTempRoot('iron-command-evidence-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  let server;
  await fs.mkdir(screenshotDir, { recursive: true });
  server = localStaticServer(root);
  const port = await listenEphemeral(server);
  let browser;
  let cdp;
  const pageErrors = [];
  const consoleErrors = [];
  const resources = [];
  const manifest = [];
  const usedPngHashes = new Set();
  try {
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const devtoolsPort = browser.devtools.devtoolsPort;
    const targets = await getJson(`http://127.0.0.1:${devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    if (!pageTarget?.webSocketDebuggerUrl) { const error = new Error('chromium_target_missing: Chromium page target was not created'); error.code = 'chromium_target_missing'; throw error; }
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    cdp.on('Network.requestWillBeSent', ({ request }) => resources.push({ url: request.url, type: 'request' }));
    cdp.on('Network.responseReceived', ({ response }) => resources.push({ url: response.url, status: response.status, type: 'response' }));
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Network.enable');
    const url = `http://127.0.0.1:${port}/`;
    await cdp.send('Page.navigate', { url });
    try {
      await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => window.__IRON_COMMAND__ ? resolve(true) : performance.now() - start > 10000 ? reject(new Error('formal page bootstrap timeout')) : setTimeout(poll, 25); poll(); })`);
    } catch (error) {
      const diagnostics = await cdp.evaluate(`({ actualUrl: location.href, title: document.title, readyState: document.readyState, visibleText: (document.body?.innerText || '').slice(0, 500) })`).catch(() => ({ actualUrl: null, title: null, readyState: null, visibleText: '' }));
      const navigationError = buildNavigationFailureError({ requestedUrl: url, ...diagnostics, pageErrors, consoleErrors, resources: resources.slice(-40), browserVersion: browser.devtools?.version?.Browser, executable: browser.executable });
      navigationError.cause = error;
      throw navigationError;
    }

    const victory = await prepareFormalBattle(cdp);
    let activeContext = { ...victory.report, battleId: victory.battleId };
    const diagnostics = () => cdp.evaluate('window.__IRON_COMMAND__.battlePresentationDiagnostics()');
    const contractDiagnostics = () => cdp.evaluate(`(async () => { const adapter = await import('/js/battle-presentation/contract-battle-adapter.js'); const builder = await import('/js/battle-presentation/core/contract-plan-builder.js'); const active = window.__IRON_COMMAND__.activeBattle(); const candidate = adapter.createContractBattlePresentation(active); const contract = adapter.buildPresentationContract(active.report); const plan = builder.buildVictoryPresentationPlan(contract); return { ok: candidate.ok, mode: candidate.mode, code: candidate.code, reason: candidate.reason, planErrors: candidate.diagnostics?.planErrors || plan.validation?.errors || [], actors: plan.actors?.map((actor) => ({ id: actor.id, type: actor.type, category: actor.category, role: actor.role, slot: actor.templateSlot })), repairGroups: plan.repairGroups?.map((group) => ({ repairVehicleId: group.repairVehicleId, targetId: group.targetId, approachStart: group.approachStart, workingStart: group.workingStart, retractStart: group.retractStart, end: group.end })) }; })()`, true);
    const textState = () => cdp.evaluate('JSON.parse(window.render_game_to_text())');
    const visibleText = () => cdp.evaluate('document.body?.innerText || ""');
    const canvasSignature = () => cdp.evaluate(`(() => { const canvas = document.querySelector('#base-canvas'); const data = canvas.toDataURL('image/png'); let h = 2166136261; for (let i = 0; i < data.length; i += 1) { h ^= data.charCodeAt(i); h = Math.imul(h, 16777619); } return 'canvas-' + (h >>> 0).toString(16).padStart(8, '0'); })()`);
    const domState = () => cdp.evaluate(`({ viewChipText: document.querySelector('#view-chip')?.textContent || '', modeButtonText: document.querySelector('#battle-presentation-mode')?.textContent || '' })`);
    const advanceBattleTo = async (sourceElapsed) => { const current = await cdp.evaluate('window.__IRON_COMMAND__.activeBattle()?.elapsed || 0'); const delta = Math.max(0, Number(sourceElapsed) - Number(current)); if (delta > 0) await cdp.evaluate(call('tickBattle', delta)); await cdp.evaluate('window.advanceTime(0)'); await sleep(70); };
    const capture = async (file, expectedMode, expectedPreference, expectedPhase = null, reportContext = activeContext, extra = {}) => {
      await cdp.evaluate('window.advanceTime(0)'); await sleep(80);
      const diag = await diagnostics(); const text = await textState(); const dom = await domState(); const canvas = await canvasSignature(); const pageText = await visibleText();
      if (diag.renderedMode !== expectedMode) throw new Error(`${file}: renderedMode ${diag.renderedMode} != ${expectedMode}; diagnostics=${JSON.stringify({ router: diag, contract: await contractDiagnostics() })}`);
      if (expectedMode === 'contract_road_victory' && !dom.viewChipText.includes('CONTRACT RTS')) throw new Error(`${file}: view chip is not contract`);
      if (expectedMode === 'universal_battle' && !dom.viewChipText.includes('UNIVERSAL RTS')) throw new Error(`${file}: view chip is not universal`);
      if (expectedMode === 'legacy' && diag.activeBattle && !dom.viewChipText.includes('TACTICAL BATTLE')) throw new Error(`${file}: view chip is not legacy`);
      if (expectedPreference === 'auto' && !dom.modeButtonText.includes('自动')) throw new Error(`${file}: auto button mismatch`);
      if (expectedPreference === 'legacy' && !dom.modeButtonText.includes('兼容')) throw new Error(`${file}: legacy button mismatch`);
      if (expectedPhase && diag.activeBattle?.presentationPhase !== expectedPhase) throw new Error(`${file}: phase mismatch`);
      if (extra.withdraw) {
        if (reportContext.result !== 'withdraw' || diag.renderedMode !== 'universal_battle') throw new Error(`${file}: withdraw evidence is not universal`);
        if (diag.preference !== 'auto') throw new Error(`${file}: withdraw evidence was not default auto`);
        if (pageText.includes('首占奖励') || pageText.includes('目标已占领')) throw new Error(`${file}: withdraw evidence contains victory-only settlement text`);
      }
      const target = path.join(screenshotDir, file); await cdp.screenshot(target); const pngSha256 = sha256(await fs.readFile(target));
      if (usedPngHashes.has(pngSha256)) throw new Error(`${file}: duplicate PNG hash`); usedPngHashes.add(pngSha256);
      const report = reportContext;
      const entry = {
        evidenceRunId,
        file, battleId: report.battleId || diag.activeBattle?.id || null, reportId: report.id || null,
        reportFingerprint: diag.reportFingerprint || extra.reportFingerprint || null, reportResult: report.result || null,
        reportSeed: report.seed ?? null, reportEventCount: Array.isArray(report.events) ? report.events.length : 0,
        retreatEventCount: Array.isArray(report.events) ? report.events.filter((event) => event.type === 'retreat').length : 0,
        capture: report.capture ?? null, rewards: report.rewards || {},
        preference: diag.preference, candidateMode: diag.mode, mode: diag.mode, renderedMode: diag.renderedMode,
        presentationPhase: diag.activeBattle?.presentationPhase || 'base', elapsed: diag.activeBattle?.elapsed || 0,
        presentationTime: diag.renderState?.time ?? null, returnElapsed: diag.activeBattle?.returnElapsed || 0,
        viewChipText: dom.viewChipText, modeButtonText: dom.modeButtonText, canvasSignature: canvas,
        stateSignature: sha256(JSON.stringify({ text, bodyText: pageText, diag: { renderedMode: diag.renderedMode, preference: diag.preference, phase: diag.activeBattle?.presentationPhase || 'base', renderState: diag.renderState } })),
        pngSha256, pageErrors: pageErrors.slice(), consoleErrors: consoleErrors.slice(), ...extra.manifest
      };
      manifest.push(entry); return { diag, text, dom, pageText, entry };
    };

    await advanceBattleTo(0.05); await capture(FORMAL_EVIDENCE_FILES[0], 'contract_road_victory', 'auto', 'battle');
    await advanceBattleTo(victory.report.events.find((event) => ['fire', 'damage'].includes(event.type))?.t || 12); await capture(FORMAL_EVIDENCE_FILES[1], 'contract_road_victory', 'auto', 'battle');
    const firstRepair = (await diagnostics()).repairAnchors[0]; const plan = (await diagnostics()).plan; if (!firstRepair) throw new Error('formal plan exposes no REPAIR anchor');
    await advanceBattleTo(inverseTimeMap(plan.timeMap, firstRepair.presentationTime + 0.10));
    const repairCapture = await capture(FORMAL_EVIDENCE_FILES[2], 'contract_road_victory', 'auto', 'battle');
    const repairState = repairCapture.diag.renderState?.choreography; if (!repairState || repairState.state !== 'working' || repairState.sparkActive !== true || !(repairState.distance >= 55 && repairState.distance <= 82)) throw new Error(`repair evidence invalid: ${JSON.stringify(repairState)}`);
    await advanceBattleTo(victory.report.events.find((event) => event.type === 'destroy' && String(event.target || '').startsWith('friendly_'))?.t || 24); await capture(FORMAL_EVIDENCE_FILES[3], 'contract_road_victory', 'auto', 'battle');
    await advanceBattleTo(victory.report.duration); await capture(FORMAL_EVIDENCE_FILES[4], 'contract_road_victory', 'auto', 'returning');
    await cdp.evaluate(call('setPresentationMode', 'legacy')); await cdp.evaluate('window.advanceTime(0)'); await sleep(80); await capture(FORMAL_EVIDENCE_FILES[5], 'legacy', 'legacy', 'returning');
    await cdp.evaluate(call('setPresentationMode', 'auto')); await cdp.evaluate('window.advanceTime(0)'); await sleep(80); await capture(FORMAL_EVIDENCE_FILES[6], 'contract_road_victory', 'auto', 'returning');
    await cdp.evaluate(call('tickBattleReturn', 2.5)); await cdp.evaluate('window.advanceTime(0)'); await sleep(80); const mid = await capture(FORMAL_EVIDENCE_FILES[7], 'contract_road_victory', 'auto', 'returning');
    if (!(mid.diag.renderState?.returnProgress > 0)) throw new Error('victory returning mid did not advance');
    await cdp.evaluate(call('tickBattleReturn', 2.2)); await cdp.evaluate('window.advanceTime(0)'); await sleep(80); await capture(FORMAL_EVIDENCE_FILES[8], 'contract_road_victory', 'auto', 'returning');
    await cdp.evaluate(call('finishBattleReturn')); await cdp.evaluate('window.advanceTime(0)'); await sleep(80);

    const withdraw = await prepareFormalWithdrawBattle(cdp); activeContext = { ...withdraw.report, battleId: withdraw.battleId };
    await cdp.evaluate(call('tickBattle', 999)); await cdp.evaluate(call('tickBattleReturn', 0.8)); await cdp.evaluate('window.advanceTime(0)'); await sleep(80);
    await capture(FORMAL_EVIDENCE_FILES[9], 'universal_battle', 'auto', 'returning', activeContext, { withdraw: true, reportFingerprint: (await diagnostics()).reportFingerprint, manifest: { retreatEventCount: 1, capture: false, rewards: {} } });
    await cdp.evaluate(call('tickBattleReturn', 2.2)); await cdp.evaluate('window.advanceTime(0)'); await sleep(80);
    await capture(FORMAL_EVIDENCE_FILES[10], 'universal_battle', 'auto', 'returning', activeContext, { withdraw: true, reportFingerprint: (await diagnostics()).reportFingerprint, manifest: { retreatEventCount: 1, capture: false, rewards: {} } });
    await cdp.evaluate(call('finishBattleReturn')); await cdp.evaluate('window.advanceTime(0)'); await sleep(80);
    const baseCapture = await capture(FORMAL_EVIDENCE_FILES[11], 'legacy', 'auto', null, activeContext, { reportFingerprint: withdraw.reportFingerprint || manifest.at(-1)?.reportFingerprint, manifest: { activeBattleAfterReturn: false, retreatEventCount: 1, capture: false, rewards: {} } });
    if (baseCapture.diag.activeBattle !== null) throw new Error('base-after-return still has activeBattle');

    if (manifest.length !== 12 || new Set(manifest.map((entry) => entry.pngSha256)).size !== 12) throw new Error('A.2 screenshot count/SHA uniqueness failed');
    if (pageErrors.length || consoleErrors.length) throw new Error(`browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const battles = [...new Map(manifest.filter((entry) => entry.battleId).map((entry) => [entry.battleId, { battleId: entry.battleId, reportId: entry.reportId, reportResult: entry.reportResult, reportSeed: entry.reportSeed, reportEventCount: entry.reportEventCount, reportFingerprint: entry.reportFingerprint, retreatEventCount: entry.retreatEventCount || 0, capture: entry.capture ?? null, rewards: entry.rewards ?? {} }])).values()];
    await fs.writeFile(path.join(screenshotDir, FORMAL_EVIDENCE_MANIFEST), JSON.stringify({ version: 3, evidenceRunId, generatedBy: 'tests/browser/formal-battle-evidence.mjs', serverUrl: `http://127.0.0.1:${port}/`, battles, screenshots: manifest, errors: { pageErrors, consoleErrors }, resources: resources.slice(-100) }, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, evidenceRunId, url: `http://127.0.0.1:${port}/`, browserExecutable: browser.executable, browserVersion: browser.devtools.version.Browser, noSandbox: browser.args.includes('--no-sandbox'), screenshots: 12, battles: battles.map((battle) => ({ battleId: battle.battleId, reportId: battle.reportId, result: battle.reportResult })), pageErrors, consoleErrors }));
  } finally {
    cdp?.close();
    await terminateManagedBrowser(browser).catch(() => {});
    await closeServerSafely(server);
    removeIsolatedTempRoot(isolatedRoot);
  }
}

main().catch((error) => {
  const code = error.code || (error.message?.match(/\b(chromium_[a-z_]+|navigation_[a-z_]+|formal_[a-z_]+)\b/) || [])[1] || 'browser_evidence_failed';
  console.error(JSON.stringify({ ok: false, code, message: error.message || String(error) }));
  console.error(error.stack || error);
  process.exitCode = 1;
});
