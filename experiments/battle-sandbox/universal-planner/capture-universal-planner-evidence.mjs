import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from '../../../tests/browser/cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from '../../../tests/browser/managed-browser-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const plannerRoot = path.join(root, 'experiments/battle-sandbox/universal-planner');
const screenshotDir = path.join(plannerRoot, 'screenshots');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(path.join(plannerRoot, '.browser-temp'), { recursive: true });
  const server = localStaticServer(root); const port = await listenEphemeral(server); let browser; let cdp;
  const pageErrors = []; const consoleErrors = []; const captures = []; const hashes = new Set();
  const usedIds = new Set();
  const wanted = [
    ['01-repair-contact.png', (row) => row.eventTypes.includes('repair'), 0.48],
    ['02-multiple-repair-contact.png', (row) => row.eventTypes.filter((type) => type === 'repair').length >= 2, 0.56],
    ['03-convoy-victory-clear.png', (row) => row.missionId === 'convoy_escort' && row.result === 'victory', 0.92],
    ['04-convoy-withdraw-returned.png', (row) => row.missionId === 'convoy_escort' && row.result === 'withdraw', 0.99],
    ['05-convoy-wiped-stopped.png', (row) => row.missionId === 'convoy_escort' && row.result === 'wiped', 0.99],
    ['06-salvage-standoff.png', (row) => row.missionId === 'salvage_run', 0.58],
    ['07-fortified-obstacle-routing.png', (row) => row.terrain === 'fortified', 0.64],
    ['08-wreck-avoidance.png', (row) => row.friendlyLoss, 0.86],
    ['09-withdraw-obstacle-routing.png', (row) => row.result === 'withdraw', 0.78],
    ['10-many-actors-no-collision.png', (row) => row.friendlyCount === 8, 0.37],
    ['11-pyrrhic-partial-objective.png', (row) => row.result === 'pyrrhic', 0.82],
    ['12-spatial-debug-overlay.png', (row) => row.terrain === 'road', 0.31]
  ];
  try {
    browser = await launchManagedBrowser({ url: 'about:blank', tempDir: path.join(plannerRoot, '.browser-temp') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`); const target = targets.find((item) => item.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(target.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/experiments/battle-sandbox/universal-planner/index.html` });
    await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => document.querySelector('#scenario-select')?.options.length ? resolve(true) : performance.now() - start > 20000 ? reject(new Error('universal planner bootstrap timeout')) : setTimeout(poll, 30); poll(); })`);
    for (const [file, predicateText, timeRatio] of wanted) {
      const predicate = predicateText.toString();
      const id = await cdp.evaluate(`(() => { const options = [...document.querySelector('#scenario-select').options]; const predicate = ${predicate}; const used = new Set(${JSON.stringify([...usedIds])}); return options.map((option) => option.value).find((id) => !used.has(id) && predicate(window.__universalPlannerRows.find((row) => row.id === id))) || null; })()`);
      if (!id) throw new Error(`scenario not found for ${file}`);
      usedIds.add(id);
      const duration = await cdp.evaluate(`(() => { window.selectUniversalScenario(${JSON.stringify(id)}); return Number(document.querySelector('#time-range').max); })()`);
      const requestedTime = Number((duration * timeRatio).toFixed(3));
      await cdp.evaluate(`window.seekUniversalPlanTime(${JSON.stringify(requestedTime)});`); await sleep(100);
      await cdp.screenshot(path.join(screenshotDir, file)); const pngSha256 = sha256(await fs.readFile(path.join(screenshotDir, file))); if (hashes.has(pngSha256)) throw new Error(`duplicate screenshot hash: ${file}`); hashes.add(pngSha256);
      const state = await cdp.evaluate('JSON.parse(window.render_universal_plan_to_text())');
      const positions = (state.actors || []).map((actor) => ({ actorId: actor.actorId, x: actor.x, y: actor.y })).sort((a, b) => a.actorId.localeCompare(b.actorId));
      captures.push({ file, scenarioId: id, reportId: state.reportId, terrain: state.terrain, missionId: state.source?.missionId, strategyId: state.source?.strategyId, result: state.source?.result, actorCount: positions.length, planFingerprint: state.planFingerprint, requestedTime, actualTime: state.currentTime, currentPositionsHash: sha256(JSON.stringify(positions)), activeActions: (state.actors || []).map((actor) => ({ actorId: actor.actorId, action: actor.currentAction })).filter((item) => item.action && item.action !== 'holding'), pngSha256 });
    }
    if (pageErrors.length || consoleErrors.length) throw new Error(`browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    await fs.writeFile(path.join(screenshotDir, 'manifest.json'), `${JSON.stringify({ version: 1, generatedBy: 'capture-universal-planner-evidence.mjs', serverUrl: `http://127.0.0.1:${port}/experiments/battle-sandbox/universal-planner/`, screenshots: captures, sha256Unique: hashes.size === captures.length, pageErrors, consoleErrors }, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, screenshots: captures.length, sha256Unique: hashes.size === captures.length, pageErrors, consoleErrors }));
  } finally { cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server.close(() => resolve())); }
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, message: error.message })); process.exitCode = 1; });
