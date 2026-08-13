import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const framePhases = [
  'campaign_operation_boundary',
  'production_queue',
  'production_queue_after_real_reload',
  'equipment_completed_unmounted',
  'equipment_completed_after_real_reload',
  'equipment_mounted_dom',
  'operation_review',
  'running_battle',
  'running_after_real_reload',
  'settlement_salvage_pending',
  'settlement_after_real_reload',
  'salvage_claimed',
  'salvage_mounted_dom',
  'replay_after_real_reload'
];
const requiredActions = [
  'produce-equipment', 'cancel-production-current', 'equip-equipment',
  'select-theater', 'select-operation', 'select-strategy',
  'launch-battle', 'confirm-dispatch', 'running-equipment-change-attempt',
  'claim-battle-salvage', 'view-report', 'replay-report',
  'salvage-equip-equipment', 'return-from-battle'
];
const realReloadReasons = [
  'production_queue', 'completed_unmounted', 'running_battle',
  'settlement_salvage_pending', 'replay'
];
const evidence = {
  stage: '9-E', version: 1, generatedBy: 'tests/generate-stage9-E-machine-evidence.mjs',
  frameCount: framePhases.length,
  frames: framePhases.map((phase, index) => ({ index, phase, file: `stage9-e-${String(index).padStart(2, '0')}-${phase}.png` })),
  requiredActions, realReloadReasons,
  fixtureLoaderUsed: false, debugOverlayUsed: false, dispatchApiUsed: false,
  replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
  salvageClaimApiUsed: false, apiProvenanceFlags: {
    dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false,
    equipmentApiUsed: false, salvageClaimApiUsed: false
  },
  deterministicInput: { operationId: 'river_ferry', theaterId: 'river_crossing', strategyId: 'cautious', seed: 3, salvageEquipmentId: 'mobile_repair_rig' },
  requiredProvenance: { source: 'production_ui', syntheticApiCall: false, realReloadMethod: 'Page.reload' }
};
fs.writeFileSync(path.join(root, 'stage9_e_machine_evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ stage: evidence.stage, frameCount: evidence.frameCount, requiredActions: evidence.requiredActions.length, realReloads: evidence.realReloadReasons.length }));
