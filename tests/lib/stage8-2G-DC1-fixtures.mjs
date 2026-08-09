import fs from 'node:fs';
import path from 'node:path';
import { buildDbArtShowcaseReport } from './stage8-2G-DB-art-scenarios.mjs';
import { createUniversalBattlePresentation } from '../../js/battle-presentation/universal/universal-battle-adapter.js';

export const root = process.cwd();
export const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
export const writeJson = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
export const fixture = (name) => readJson(`experiments/battle-sandbox/report-adapter/fixtures/${name}`).report;
export const definitions = [
  { sceneId: 'stage8g-dc-victory', report: fixture('campaign-victory.json'), result: 'victory' },
  { sceneId: 'stage8g-dc-withdraw', report: fixture('campaign-withdraw.json'), result: 'withdraw' },
  { sceneId: 'stage8g-dc-art', report: buildDbArtShowcaseReport(), result: 'victory' }
];
export function buildPresentations() {
  return new Map(definitions.map(({ sceneId, report }) => [sceneId, createUniversalBattlePresentation({ id: sceneId, report, duration: report.duration, presentationPhase: 'battle' })]));
}
export function dcBundle(prefix = 'stage8_2g_dc_', { includeTamper = true } = {}) {
  const get = (suffix) => readJson(`${prefix}${suffix}.json`);
  const bundle = { machine: get('machine_evidence'), inventory: get('effect_inventory'), muzzle: get('muzzle_effect_check'), impact: get('impact_effect_check'), damage: get('damage_visual_check'), destruction: get('destruction_effect_check'), wreck: get('wreck_effect_check'), camera: get('camera_feedback_check'), transition: get('transition_check'), audio: get('audio_cue_check'), semantic: get('semantic_resolution'), browser: get('browser_capture_manifest'), determinism: get('determinism_check'), authority: get('authority_check'), performance: get('performance_check') };
  if (includeTamper) bundle.tamper = get('tamper_results');
  return bundle;
}
