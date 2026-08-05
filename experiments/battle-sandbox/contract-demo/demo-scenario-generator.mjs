import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuildScenarioInput } from '../report-adapter/fixture-scenarios.js';
import { simulateBattle } from '../../../js/battle.js';
import { buildPresentationContract } from '../report-adapter/presentation-contract.js';
import { stableStringify } from '../report-adapter/report-normalizer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, 'scenarios');

const SCENARIOS = [
  { id: 'scenario-b', seed: 2, prefix: 'scenario-b', formationId: 'formation-scenario-b', unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'] },
  { id: 'scenario-c', seed: 3, prefix: 'live-test-a', formationId: 'formation-live-a', unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'], identityRemap: true },
  { id: 'scenario-d', seed: 1, prefix: 'scenario-d', formationId: 'formation-scenario-d', unitTypes: ['infantry', 'infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'] },
  { id: 'scenario-e', seed: 1, prefix: 'scenario-e', formationId: 'formation-scenario-e', unitTypes: ['infantry', 'infantry', 'infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'] },
  { id: 'scenario-f', seed: 1, prefix: 'scenario-f', formationId: 'formation-scenario-f', unitTypes: ['infantry', 'infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt'] }
];

function hashReport(report) { return crypto.createHash('sha256').update(stableStringify(report)).digest('hex'); }

function dynamicInput({ seed, prefix, formationId, unitTypes }) {
  const scenario = { unitTypes, unitHpRatios: unitTypes.map(() => 1), theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road', seed };
  const input = rebuildScenarioInput(scenario);
  const ids = input.state.units.map((unit, index) => `${prefix}-u-${index + 1}`);
  input.state.units.forEach((unit, index) => { unit.id = ids[index]; unit.formationId = formationId; });
  input.formation.id = formationId; input.formation.unitIds = ids; input.formation.name = `${prefix} formation`;
  return { input, scenario: { ...scenario, id: `${prefix}-formal`, formationId, formationName: `${prefix} formation`, unitIdPrefix: prefix, unitTypes, unitHpRatios: unitTypes.map(() => 1) } };
}

function remapEnemyIds(report, prefix) {
  const ids = [...(report.initial?.enemy || [])].map((actor, index) => [actor.id, `enemy_${prefix}-${index + 1}`]);
  const mapping = Object.fromEntries(ids);
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return typeof value === 'string' && mapping[value] ? mapping[value] : value;
  }
  return visit(report);
}

function writeScenario(spec) {
  const { input, scenario } = dynamicInput(spec);
  const solved = simulateBattle(input);
  const report = spec.identityRemap ? remapEnemyIds(solved, spec.prefix) : solved;
  const contract = buildPresentationContract(report);
  if (report.result !== 'victory' || !contract.validation.ok || !contract.diagnostics.supported) throw new Error(`${spec.id} did not produce a supported victory report`);
  const payload = {
    fixtureVersion: 1,
    sourceKind: spec.identityRemap ? 'transformed_identity_fuzz' : 'formal_solver_raw',
    ...(spec.identityRemap ? { derivedFromReportId: solved.id, transformation: 'stable_actor_id_remap' } : {}),
    scenario: { ...scenario, expectedResult: report.result },
    report,
    rebuildHash: hashReport(report)
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, `${spec.id}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  return { id: spec.id, sourceKind: payload.sourceKind, report, contract, rebuildHash: payload.rebuildHash };
}

for (const spec of SCENARIOS) {
  const result = writeScenario(spec);
  console.log(JSON.stringify({ id: result.id, sourceKind: result.sourceKind, reportId: result.report.id, seed: result.report.seed, events: result.report.events.length, repair: result.report.events.filter((event) => event.type === 'repair').length, result: result.report.result, supported: result.contract.diagnostics.supported, rebuildHash: result.rebuildHash }));
}
