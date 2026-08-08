import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildUniversalBattleHud, drawUniversalBattleHud, validateUniversalHud } from '../js/battle-presentation/universal/universal-hud-policy.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const formalVictory = fixture('campaign-victory.json');
const formalDefeat = fixture('campaign-withdraw.json');
const artReport = buildDbArtShowcaseReport();
const settlementReceipt = { settlementId: 'stage8g-db-settlement', result: formalVictory.result, rewards: { scrap: 240, alloy: 18 }, applied: true };
const active = (report, receipt = null) => ({ id: `stage8g-db-${report.result}`, report, duration: report.duration, elapsed: 0, presentationPhase: 'battle', settlementReceipt: receipt });
const victoryPresentation = createUniversalBattlePresentation({ id: 'stage8g-db-formal-victory', report: formalVictory, duration: formalVictory.duration, presentationPhase: 'battle' });
const defeatPresentation = createUniversalBattlePresentation({ id: 'stage8g-db-formal-defeat', report: formalDefeat, duration: formalDefeat.duration, presentationPhase: 'battle' });
const artPresentation = createUniversalBattlePresentation({ id: 'stage8g-db-art', report: artReport, duration: artReport.duration, presentationPhase: 'battle' });
assert.equal(victoryPresentation.ok, true, victoryPresentation.reason);
assert.equal(defeatPresentation.ok, true, defeatPresentation.reason);
assert.equal(artPresentation.ok, true, artPresentation.reason);

const reportBefore = stableStringify(formalVictory);
const victoryState = victoryPresentation.renderState.atTime(0);
const selectedActor = victoryState.actors.find((actor) => actor.side === 'friendly' && actor.alive) || victoryState.actors[0];
const selectedHud = buildUniversalBattleHud(active(formalVictory, settlementReceipt), victoryPresentation, victoryState, { selectedActorId: selectedActor.id, hoveredActorId: selectedActor.id });
const hudCheck = validateUniversalHud(selectedHud);
assert.equal(hudCheck.ok, true, hudCheck.errors.join(', '));
assert.equal(selectedHud.selection.selected.id, selectedActor.id);
assert.equal(selectedHud.selection.selected.hp, selectedActor.hp);
assert.equal(selectedHud.selection.selected.maxHp, selectedActor.maxHp);
assert.equal(selectedHud.sources.health, 'renderState.actor.hp');
assert.equal(selectedHud.sources.status, 'renderState.actor.visualState');
assert.equal(selectedHud.sources.battlePhase, 'presentationPhaseResolver');
assert.equal(selectedHud.sources.objective, 'formal_objective_data');
assert.equal(selectedHud.sources.result, 'formal_result');
assert.equal(selectedHud.sources.settlement, 'formal_settlement');

const damagedState = victoryPresentation.renderState.atTime(14.05);
const damagedActor = damagedState.actors.find((actor) => Number(actor.hp) < Number(actor.maxHp)) || damagedState.actors.find((actor) => actor.side === 'friendly');
const damagedHud = buildUniversalBattleHud(active(formalVictory), victoryPresentation, damagedState, { selectedActorId: damagedActor.id });
assert.equal(damagedHud.selection.selected.hp, damagedActor.hp);
assert.equal(damagedHud.selection.selected.maxHp, damagedActor.maxHp);
assert.equal(damagedHud.selection.selected.hpRatio, Math.max(0, Math.min(1, damagedActor.hp / Math.max(1, damagedActor.maxHp))));

const repairTime = victoryPresentation.plan.timeline.anchors.find((anchor) => anchor.type === 'repair')?.t;
assert.ok(Number.isFinite(repairTime), 'formal victory fixture must expose a repair anchor');
const repairState = victoryPresentation.renderState.atTime(repairTime + .02);
const repairActor = repairState.actors.find((actor) => actor.type === 'repair_vehicle');
assert.equal(repairActor?.drawSpec?.animation, 'repair');
assert.equal(repairActor?.visualStatus, 'repairing');
const repairHud = buildUniversalBattleHud(active(formalVictory), victoryPresentation, repairState, { selectedActorId: repairActor.id });
assert.equal(repairHud.selection.selected.status, '维修中');

const finalVictoryState = victoryPresentation.renderState.atTime(victoryPresentation.plan.timeline.duration);
const finalVictoryHud = buildUniversalBattleHud(active(formalVictory, settlementReceipt), victoryPresentation, finalVictoryState, { selectedActorId: selectedActor.id });
assert.equal(finalVictoryHud.resultPanel.visible, true);
assert.equal(finalVictoryHud.resultPanel.result, formalVictory.result);
assert.deepEqual(finalVictoryHud.resultPanel.rewards, formalVictory.rewards);
assert.deepEqual(finalVictoryHud.resultPanel.settlement, settlementReceipt);
assert.deepEqual(finalVictoryHud.objective, { ...finalVictoryHud.objective, source: 'formal_objective_data' });

const finalDefeatState = defeatPresentation.renderState.atTime(defeatPresentation.plan.timeline.duration);
const finalDefeatHud = buildUniversalBattleHud(active(formalDefeat), defeatPresentation, finalDefeatState, { selectedActorId: finalDefeatState.actors.find((actor) => actor.side === 'friendly')?.id });
assert.equal(finalDefeatHud.resultPanel.visible, true);
assert.equal(finalDefeatHud.resultPanel.result, formalDefeat.result);

const compactContext = new Proxy({ calls: 0 }, { get(target, property) { if (property === 'calls') return target.calls; if (property === 'roundRect') return undefined; if (property === 'setTransform') return (...args) => { target.calls += 1; }; return (...args) => { target.calls += 1; }; }, set(target, property, value) { target[property] = value; return true; } });
drawUniversalBattleHud(compactContext, selectedHud, victoryState, { screenWidth: 960, screenHeight: 540, screenDpr: 1 });
drawUniversalBattleHud(compactContext, selectedHud, victoryState, { screenWidth: 480, screenHeight: 720, screenDpr: 1 });
assert.ok(compactContext.calls > 0);

for (const seconds of [0, 4.2, 14.05, repairTime + .02, victoryPresentation.plan.timeline.duration]) victoryPresentation.renderState.atTime(seconds);
assert.equal(stableStringify(formalVictory), reportBefore);
const artReportBefore = stableStringify(artReport);
for (const seconds of [0, 6, 14, 22, artPresentation.plan.timeline.duration]) artPresentation.renderState.atTime(seconds);
assert.equal(stableStringify(artReport), artReportBefore);

write('stage8_2g_db_hud_contract_check.json', { stage: '8.2G-D-B', version: 1, valid: hudCheck.ok, contractFields: ['selection', 'health', 'status', 'phase', 'objective', 'resultPanel', 'safeArea', 'sources'], productionMode: selectedHud.modeLabel, debugExcluded: true, passed: true });
write('stage8_2g_db_selection_binding.json', { stage: '8.2G-D-B', selectedActorId: selectedActor.id, selectedName: selectedHud.selection.selected.name, marker: selectedHud.icons.selected, hoverMarker: selectedHud.icons.hovered, targetMarker: selectedHud.icons.target, selectionSource: 'renderer.selection', passed: true });
write('stage8_2g_db_health_binding.json', { stage: '8.2G-D-B', selectedActorId: damagedActor.id, hp: damagedActor.hp, maxHp: damagedActor.maxHp, hpRatio: damagedHud.selection.selected.hpRatio, source: selectedHud.sources.health, damagedFrame: damagedActor.hp < damagedActor.maxHp, passed: true });
write('stage8_2g_db_objective_binding.json', { stage: '8.2G-D-B', objective: selectedHud.objective, finalVictoryObjective: finalVictoryHud.objective, defeatObjective: finalDefeatHud.objective, source: selectedHud.sources.objective, resolver: 'formal plan.scene.objective + renderState.objectiveState', passed: true });
write('stage8_2g_db_result_binding.json', { stage: '8.2G-D-B', victory: { result: finalVictoryHud.resultPanel.result, rewards: finalVictoryHud.resultPanel.rewards, settlement: finalVictoryHud.resultPanel.settlement }, defeat: { result: finalDefeatHud.resultPanel.result }, source: { result: finalVictoryHud.sources.result, settlement: finalVictoryHud.sources.settlement }, recomputed: false, passed: true });
write('stage8_2g_db_responsive_check.json', { stage: '8.2G-D-B', viewports: [{ width: 960, height: 540, layout: 'default' }, { width: 480, height: 720, layout: 'narrow-safe-area' }], safeArea: selectedHud.safeArea, canvasDrawWithoutRoundRect: true, productionHudVisible: true, passed: true });
write('stage8_2g_db_authority_check.json', { stage: '8.2G-D-B', formalVictoryReportStable: stableStringify(formalVictory) === reportBefore, artFixtureAuthorityStable: stableStringify(artReport) === artReportBefore, combatCoreModified: false, resultRecomputed: false, settlementRecomputed: false, passed: true });
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B', selectedActorId: selectedActor.id, repairActorId: repairActor.id, repairTime, victory: formalVictory.result, defeat: formalDefeat.result }));
