import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildUniversalBattleHud, validateUniversalHud } from '../js/battle-presentation/universal/universal-hud-policy.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { buildActorDrawSpec, buildWreckDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const expectedFrameNames = new Set(['d-b-01-full-friendly-lineup.png', 'd-b-02-full-enemy-lineup.png', 'd-b-03-scout-move-fire.png', 'd-b-04-repair-vehicle-action.png', 'd-b-05-support-vehicle.png', 'd-b-06-production-mixed-battle.png', 'd-b-07-cover-advance-production.png', 'd-b-08-retreat-rear-guard-production.png', 'd-b-09-selected-unit-hud.png', 'd-b-10-damaged-unit-health.png', 'd-b-11-objective-and-phase.png', 'd-b-12-victory-result.png', 'd-b-13-defeat-result.png', 'd-b-14-narrow-production-battle.png', 'd-b-15-narrow-result-ui.png', 'd-b-16-production-fallback.png']);

export function buildDbTamperReference() {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json'), 'utf8')).report;
  const presentation = createUniversalBattlePresentation({ id: 'stage8g-db-verifier', report, duration: report.duration, presentationPhase: 'battle' });
  const state = presentation.renderState.atTime(0); const selected = state.actors.find((actor) => actor.side === 'friendly' && actor.alive) || state.actors[0]; const hud = buildUniversalBattleHud({ report }, presentation, state, { selectedActorId: selected.id }); const final = presentation.renderState.atTime(presentation.plan.timeline.duration); const finalHud = buildUniversalBattleHud({ report }, presentation, final, { selectedActorId: selected.id });
  const scoutSpec = buildActorDrawSpec({ id: 'tamper-scout', side: 'friendly', type: 'scout_car', category: 'vehicle', shape: 'vehicle', hp: 90, maxHp: 90, alive: true, facing: 0 }, { zoom: .86 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)), presentationSeconds: 0 });
  const wreckSpec = buildWreckDrawSpec({ id: 'tamper-repair-wreck', sourceActorId: 'tamper-repair', sourceType: 'repair_vehicle', side: 'friendly', visualClass: 'support_vehicle', wreckType: 'light_vehicle_wreck', angle: 0 }, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)) });
  return { selectedActorId: selected.id, hp: hud.selection.selected.hp, maxHp: hud.selection.selected.maxHp, status: hud.selection.selected.status, phase: hud.phase, objective: hud.objective.label, result: finalHud.resultPanel.result, reward: stableStringify(finalHud.resultPanel.rewards), factionAssetId: scoutSpec.assetId, unitAssetId: scoutSpec.assetId, wreckAssetId: wreckSpec.assetId, duplicateImageHashes: false, authorityStable: true };
}

export function verifyTamperPayload(payload, reference = buildDbTamperReference()) {
  const errors = [];
  if (payload.selectedActorId !== reference.selectedActorId) errors.push('selected_actor_binding');
  if (Number(payload.hp) !== Number(reference.hp) || Number(payload.maxHp) !== Number(reference.maxHp)) errors.push('health_binding');
  if (payload.status !== reference.status) errors.push('status_binding');
  if (payload.phase !== reference.phase) errors.push('phase_binding');
  if (payload.objective !== reference.objective) errors.push('objective_binding');
  if (payload.result !== reference.result) errors.push('result_binding');
  if (payload.reward !== reference.reward) errors.push('reward_binding');
  if (payload.factionAssetId !== reference.factionAssetId) errors.push('faction_asset_binding');
  if (payload.unitAssetId !== reference.unitAssetId) errors.push('unit_asset_binding');
  if (payload.wreckAssetId !== reference.wreckAssetId) errors.push('wreck_asset_binding');
  if (payload.duplicateImageHashes !== reference.duplicateImageHashes) errors.push('duplicate_png_binding');
  if (payload.authorityStable !== reference.authorityStable) errors.push('authority_binding');
  return { ok: errors.length === 0, errors };
}

export function verifyCurrentDbEvidence() {
  const errors = [];
  const coverage = readJson('stage8_2g_db_asset_coverage.json'); const topology = readJson('stage8_2g_db_weapon_topology_check.json'); const wreck = readJson('stage8_2g_db_wreck_check.json'); const hud = readJson('stage8_2g_db_hud_contract_check.json'); const selection = readJson('stage8_2g_db_selection_binding.json'); const health = readJson('stage8_2g_db_health_binding.json'); const objective = readJson('stage8_2g_db_objective_binding.json'); const result = readJson('stage8_2g_db_result_binding.json'); const responsive = readJson('stage8_2g_db_responsive_check.json');
  if (coverage.stage !== '8.2G-D-B' || Number(coverage.coverage?.ratio) < .95 || coverage.coverage?.wrongAliasCount !== 0 || JSON.stringify(coverage.coverage?.proceduralFallbackTypes) !== JSON.stringify(['unknown']) || coverage.passed !== true) errors.push('asset_coverage');
  if (topology.passed !== true || topology.rows?.some((row) => row.passed !== true)) errors.push('weapon_topology');
  if (wreck.passed !== true || wreck.friendlyEnemyDistinct !== true || wreck.orientationPreserved !== true) errors.push('wreck_check');
  if ([hud, selection, health, objective, result, responsive].some((item) => item.stage !== '8.2G-D-B' || item.passed !== true)) errors.push('hud_binding');
  const machine = readJson('stage8_2g_db_machine_evidence.json'); const browser = readJson('stage8_2g_db_browser_capture_manifest.json'); if (machine.stage !== '8.2G-D-B' || machine.frameCount !== 16) errors.push('machine_evidence');
  const frames = browser.scenes?.flatMap((scene) => scene.frames || []) || []; const names = new Set(frames.map((frame) => frame.file)); if (browser.stage !== '8.2G-D-B' || browser.browser?.pageErrors?.length || browser.browser?.consoleErrors?.length || frames.length !== 16 || names.size !== 16 || [...expectedFrameNames].some((name) => !names.has(name))) errors.push('browser_manifest');
  const hashes = new Set(); for (const frame of frames) { const file = path.join(root, frame.screenshot?.path || ''); if (!fs.existsSync(file)) { errors.push(`missing_screenshot:${frame.file}`); continue; } const hash = sha256File(file); if (hash !== frame.imageSha256 || hash !== frame.screenshot.sha256) errors.push(`screenshot_hash:${frame.file}`); hashes.add(hash); if (Math.abs(Number(frame.timestampDeltaMs)) > 16.7) errors.push(`timestamp:${frame.file}`); if (frame.screenMetrics?.actors?.some((row) => row.rendererGeometrySource !== 'production-final-draw-geometry')) errors.push(`geometry:${frame.file}`); }
  if (hashes.size !== frames.length || browser.browser?.uniqueImageHashes !== frames.length) errors.push('duplicate_png');
  const formal = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json'), 'utf8')).report; const before = stableStringify(formal); const p = createUniversalBattlePresentation({ id: 'stage8g-db-authority-verify', report: formal, duration: formal.duration, presentationPhase: 'battle' }); for (const time of [0, 5, 14, p.plan.timeline.duration]) p.renderState.atTime(time); if (stableStringify(formal) !== before) errors.push('formal_authority_mutated');
  return { ok: errors.length === 0, errors, counts: { frames: frames.length, uniqueImageHashes: hashes.size, assetCoverage: coverage.coverage?.ratio || 0 } };
}

if (path.basename(process.argv[1] || '') === 'verify-stage8-2G-D-B-evidence.mjs') { const result = verifyCurrentDbEvidence(); assert.equal(result.ok, true, result.errors.join(', ')); console.log(JSON.stringify({ ok: true, stage: '8.2G-D-B', ...result.counts })); }
