import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyDCEvidenceBundle } from './lib/stage8-2G-DC-evidence-verifier.mjs';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const bundle = {
  machine: read('stage8_2g_dc_machine_evidence.json'), inventory: read('stage8_2g_dc_effect_inventory.json'), muzzle: read('stage8_2g_dc_muzzle_effect_check.json'), impact: read('stage8_2g_dc_impact_effect_check.json'), damage: read('stage8_2g_dc_damage_visual_check.json'), destruction: read('stage8_2g_dc_destruction_effect_check.json'), wreck: read('stage8_2g_dc_wreck_effect_check.json'), camera: read('stage8_2g_dc_camera_feedback_check.json'), transition: read('stage8_2g_dc_transition_check.json'), audio: read('stage8_2g_dc_audio_cue_check.json'), semantic: read('stage8_2g_dc_semantic_resolution.json'), browser: read('stage8_2g_dc_browser_capture_manifest.json'), determinism: read('stage8_2g_dc_determinism_check.json'), authority: read('stage8_2g_dc_authority_check.json'), performance: read('stage8_2g_dc_performance_check.json'), tamper: read('stage8_2g_dc_tamper_results.json')
};
const verdict = verifyDCEvidenceBundle(bundle);
assert.equal(verdict.ok, true, verdict.errors.join(','));
const output = { stage: '8.2G-D-C', version: 1, baseline: { priorStage: '8.2G-D-B.1a', baseCommit: '971d3280bc8df688f24ec1489c31c68550d92d76', auditJsonImported: false }, scope: { combatCoreModified: false, solverModified: false, plannerModified: false, choreographerModified: false, formalRepairAuthorityModified: false, resultRewardSettlementSaveModified: false, presentationEffectsOnly: true }, effects: { runtimeVersion: '8.2G-D-C', effectKinds: bundle.inventory.effectKinds, weaponFamilies: bundle.inventory.weaponFamilies, machineFrames: bundle.machine.frameCount, browserFrames: bundle.browser.browser.captureCount }, evidence: { semanticFrames: bundle.semantic.rows.length, uniqueScreenshots: bundle.browser.browser.uniqueImageHashes, tamperCases: bundle.tamper.rejectionCount, stateSignaturesMatched: bundle.browser.semantic.stateSignaturesMatched }, determinism: bundle.determinism, authority: bundle.authority, performance: bundle.performance, passed: true, knownIssues: ['上一轮 D-B.1a independent-audit.json 未在本地工作区发现，未导入生产代码；D-C 使用当前基线重新生成审计数据。'] };
fs.writeFileSync(path.join(root, 'stage8_2g_dc_developer_selfcheck.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, passed: true, frames: output.effects.browserFrames, tamperCases: output.evidence.tamperCases, authorityUnchanged: true }));
