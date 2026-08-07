import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import * as cfg from '../js/config.js';
import * as stateApi from '../js/state.js';
import * as economy from '../js/economy.js';
import { simulateBattle } from '../js/battle.js';
import { buildEvidenceSceneHash, buildEvidenceStatePayload, buildEvidenceStateSignature } from '../js/battle-presentation/universal/evidence-integrity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const load = async (file) => JSON.parse(await fs.readFile(path.join(fixtureRoot, file), 'utf8')).report;
function miningVictoryReport() {
  const state = stateApi.createInitialState(); const types = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle']; state.units = types.map((type, index) => ({ id: `stage8g-c-mining-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: 'stage8g-c-mining', experience: 0, battles: 0 })); state.formations = [{ id: 'stage8g-c-mining', name: 'C 矿区混合编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((unit) => unit.id), experience: 0, battles: 0 }]; economy.recalcDerived(state); return simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 1 });
}
const output = path.join(root, 'stage8_2g_c_machine_evidence.json');
const specs = {
  victory: [['victory-01-environment-opening.png', .08, 'environmentOpening'], ['victory-02-first-contact.png', .28, 'firstContact'], ['victory-03-mixed-weapon-fire.png', .48, 'mixedWeaponFire'], ['victory-04-heavy-impact-crater.png', .62, 'heavyImpact'], ['victory-05-authoritative-destruction.png', .72, 'authoritativeDestruction'], ['victory-06-wreck-smoke.png', .82, 'wreckSmoke'], ['victory-07-persistent-battlefield.png', .92, 'persistentBattlefield'], ['victory-08-battle-end.png', 1, 'battleEnd']],
  withdraw: [['defeat-01-main-engagement.png', .42, 'mainEngagement'], ['defeat-02-damaged-battlefield.png', .58, 'damagedBattlefield'], ['defeat-03-rear-guard-fire.png', .68, 'rearGuardFire'], ['defeat-04-retreat-through-smoke.png', .78, 'retreatThroughSmoke'], ['defeat-05-critical-loss.png', .88, 'criticalLoss'], ['defeat-06-final-wreck-field.png', 1, 'finalWreckField']]
};

async function buildScene(file, id, result, names) {
  const sourceReport = await load(file); const active = { id, report: sourceReport, duration: sourceReport.duration, presentationPhase: 'battle' }; const presentation = createUniversalBattlePresentation(active); if (!presentation.ok) throw new Error(`presentation failed: ${id}: ${presentation.reason}`);
  const duration = Number(presentation.plan.timeline.duration); const frames = names.map(([name, ratio, semantic]) => { const timeMs = Number((duration * ratio * 1000).toFixed(3)); const state = presentation.renderState.atTime(timeMs / 1000); const payload = buildEvidenceStatePayload({ sceneId: id, seed: sourceReport.seed, state, timeMs }); return { semanticFrameId: `${id}::${semantic}`, file: name, semantic, sceneId: id, seed: sourceReport.seed, timeMs, visualTimeSeconds: timeMs / 1000, sceneHash: buildEvidenceSceneHash(presentation.plan), stateSignature: buildEvidenceStateSignature({ sceneId: id, seed: sourceReport.seed, state, timeMs }), environmentSignature: state.environment.signature, destructionSignature: state.destruction.signature, statePayload: payload, viewportKind: 'default' }; });
  return { sceneId: id, result, seed: sourceReport.seed, reportId: sourceReport.id, sourceDuration: Number(sourceReport.duration), visualDuration: duration, sceneHash: buildEvidenceSceneHash(presentation.plan), sourceReport, frames };
}

const victorySource = miningVictoryReport(); const victoryPresentation = createUniversalBattlePresentation({ id: 'stage8g-c-victory', report: victorySource, duration: victorySource.duration, presentationPhase: 'battle' }); if (!victoryPresentation.ok) throw new Error(`mining victory presentation failed: ${victoryPresentation.reason}`);
async function buildSourceScene(sourceReport, id, result, names) { const duration = Number(victoryPresentation.plan.timeline.duration); const presentation = id === 'stage8g-c-victory' ? victoryPresentation : createUniversalBattlePresentation({ id, report: sourceReport, duration: sourceReport.duration, presentationPhase: 'battle' }); if (!presentation.ok) throw new Error(`presentation failed: ${id}`); const frames = names.map(([name, ratio, semantic]) => { const timeMs = Number((Number(presentation.plan.timeline.duration) * ratio * 1000).toFixed(3)); const state = presentation.renderState.atTime(timeMs / 1000); const payload = buildEvidenceStatePayload({ sceneId: id, seed: sourceReport.seed, state, timeMs }); return { semanticFrameId: `${id}::${semantic}`, file: name, semantic, sceneId: id, seed: sourceReport.seed, timeMs, visualTimeSeconds: timeMs / 1000, sceneHash: buildEvidenceSceneHash(presentation.plan), stateSignature: buildEvidenceStateSignature({ sceneId: id, seed: sourceReport.seed, state, timeMs }), environmentSignature: state.environment.signature, destructionSignature: state.destruction.signature, statePayload: payload, viewportKind: 'default' }; }); return { sceneId: id, result, seed: sourceReport.seed, reportId: sourceReport.id, sourceDuration: Number(sourceReport.duration), visualDuration: Number(presentation.plan.timeline.duration), sceneHash: buildEvidenceSceneHash(presentation.plan), sourceReport, frames }; }
const victory = await buildSourceScene(victorySource, 'stage8g-c-victory', 'victory', specs.victory);
const withdraw = await buildScene('campaign-withdraw.json', 'stage8g-c-withdraw', 'withdraw', specs.withdraw);
const formal = [
  { ...victory, sceneId: victory.sceneId, frames: [{ ...victory.frames[4], semanticFrameId: 'stage8g-c-formal-victory::default', file: 'formal-victory-default.png' }, { ...victory.frames[4], semanticFrameId: 'stage8g-c-formal-victory::narrow', file: 'formal-victory-narrow.png', viewportKind: 'narrow' }] },
  { ...withdraw, sceneId: withdraw.sceneId, frames: [{ ...withdraw.frames[2], semanticFrameId: 'stage8g-c-formal-withdraw::default', file: 'formal-defeat-default.png' }, { ...withdraw.frames[2], semanticFrameId: 'stage8g-c-formal-withdraw::narrow', file: 'formal-defeat-narrow.png', viewportKind: 'narrow' }] }
];
const debug = { ...withdraw, sceneId: withdraw.sceneId, debug: true, frames: [{ ...withdraw.frames[2], semanticFrameId: 'stage8g-c-debug::environment-logic', file: 'debug-environment-logic.png' }, { ...withdraw.frames[3], semanticFrameId: 'stage8g-c-debug::production-comparison', file: 'debug-production-comparison.png' }] };
const scenes = [victory, withdraw, ...formal, debug]; const flat = scenes.flatMap((scene) => scene.frames); if (new Set(flat.map((frame) => frame.semanticFrameId)).size !== flat.length) throw new Error('C machine semantic frame IDs are not unique');
await fs.writeFile(output, JSON.stringify({ stage: '8.2G-C', version: 1, generatedBy: 'tests/generate-stage8-2G-C-machine-evidence.mjs', baseline: '8.2G-B.1.1a', independentAudit: false, browserFallbackAllowed: false, canonical: { sceneHash: 'current-universal-plan-fingerprint', stateSignature: 'canonicalEvidenceString-v1/sha256' }, scenes, frameCount: flat.length }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: '8.2G-C', output, scenes: scenes.length, frames: flat.length }));
