import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';
import { buildUniversalEngagementSchedule } from '../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { describeEvidenceFrameAt, resolveEvidenceFrameSpecs, STAGE8G_B11_EVIDENCE_NAMES } from '../js/battle-presentation/universal/evidence-frame-resolver.js';
import { buildEvidenceSceneHash, buildEvidenceStatePayload, buildEvidenceStateSignature, semanticPredicateForName, requiredPredicateForName } from '../js/battle-presentation/universal/evidence-integrity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const report = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8')).report;
const reports = { victory: report('campaign-victory.json'), withdraw: report('campaign-withdraw.json') };
const active = (source, id) => ({ id, theaterId: source.theaterId, report: source, elapsed: 0, duration: source.duration, presentationPhase: 'battle' });
const build = (source, id) => {
  const presentation = createUniversalBattlePresentation(active(source, id));
  if (!presentation.ok) throw new Error(`machine evidence plan failed: ${id}: ${presentation.diagnostics?.reason || 'unknown'}`);
  const plan = presentation.plan; const compiled = compileUniversalPlan(plan);
  const sampler = (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time);
  return { source, presentation, plan, schedule: buildUniversalEngagementSchedule(plan, sampler) };
};
const built = { victory: build(reports.victory, 'machine-victory-b11a'), withdraw: build(reports.withdraw, 'machine-withdraw-b11a') };
const output = path.join(root, 'stage8_2g_b11a_machine_semantic_evidence.json');
const write = (value) => fs.writeFileSync(output, JSON.stringify(value, null, 2) + '\n');
const scene = (id, result, row, specs) => {
  const frames = specs.map((spec) => {
    if (spec.status !== 'resolved') throw new Error(`machine evidence unresolved frame: ${spec.name}`);
    const timeMs = Number(spec.timeMs);
    const state = row.presentation.renderState.atTime(timeMs / 1000);
    const payload = buildEvidenceStatePayload({ sceneId: id, seed: row.source.seed, state, timeMs });
    const described = describeEvidenceFrameAt(row.plan, row.schedule, timeMs / 1000, spec.name);
    const semanticPredicates = { ...semanticPredicateForName(spec.name, described), ...described.semanticPredicates };
    const requiredPredicate = requiredPredicateForName(spec.name);
    if (semanticPredicates[requiredPredicate] !== true) throw new Error(`machine semantic predicate unresolved: ${spec.name} -> ${requiredPredicate}`);
    return {
      semanticFrameId: `${id}::${spec.name}`,
      file: spec.name,
      sceneId: id,
      seed: row.source.seed,
      timeMs,
      phase: described.phase,
      sceneHash: buildEvidenceSceneHash(row.plan),
      stateSignature: buildEvidenceStateSignature({ sceneId: id, seed: row.source.seed, state, timeMs }),
      semanticPredicates,
      requiredPredicate,
      activePresentationShots: described.activePresentationShots,
      activeAuthoritativeEvents: described.activeAuthoritativeEvents,
      targetSwitches: described.targetSwitches,
      suppressionSources: described.suppressionSources,
      suppressionTargets: described.suppressionTargets,
      coverMoves: described.coverMoves,
      retreatOrders: described.retreatOrders,
      cameraInterest: described.cameraInterest,
      actors: payload.actors,
      statePayload: payload
    };
  });
  return { sceneId: id, result, seed: row.source.seed, reportId: row.source.id, sourceDuration: Number(row.source.duration), visualDuration: Number(row.plan.timeline?.duration || row.plan.duration || 1), sceneHash: buildEvidenceSceneHash(row.plan), sourceReport: row.source, frames };
};
const resolved = {
  victory: resolveEvidenceFrameSpecs(built.victory.plan, built.victory.schedule, { names: STAGE8G_B11_EVIDENCE_NAMES.victory }),
  withdraw: resolveEvidenceFrameSpecs(built.withdraw.plan, built.withdraw.schedule, { names: STAGE8G_B11_EVIDENCE_NAMES.withdraw })
};
const machineScenes = [
  scene('victory-mixed-b11a', 'victory', built.victory, resolved.victory),
  scene('withdraw-rear-guard-b11a', 'withdraw', built.withdraw, resolved.withdraw),
  scene('debug-withdraw-b11a', 'withdraw', built.withdraw, [
    { ...resolved.withdraw[5], name: 'debug-assignment-phase-slices.png' },
    { ...resolved.withdraw[3], name: 'debug-cover-retreat-shot.png' },
    { ...resolved.withdraw[5], name: 'debug-authoritative-shot-facing.png' },
    { ...resolved.withdraw[3], name: 'debug-evidence-frame-binding.png' }
  ]),
  scene('formal-victory-b11a', 'victory', built.victory, [
    { ...resolved.victory[1], name: 'formal-victory-default-size.png' },
    { ...resolved.victory[1], name: 'formal-victory-narrow-size.png' }
  ]),
  scene('formal-withdraw-b11a', 'withdraw', built.withdraw, [
    { ...resolved.withdraw[1], name: 'formal-defeat-default-size.png' },
    { ...resolved.withdraw[1], name: 'formal-defeat-narrow-size.png' }
  ])
];
const flat = machineScenes.flatMap((item) => item.frames);
if (flat.length !== 24 || new Set(flat.map((item) => item.semanticFrameId)).size !== 24) throw new Error(`machine evidence expected 24 unique semantic frames, got ${flat.length}`);
write({
  stage: '8.2G-B.1.1a', version: 1, generatedBy: 'tests/generate-stage8-2G-B-1-1a-machine-semantic-evidence.mjs',
  independentAudit: false, source: 'pure-node-current-code-plan',
  canonical: { serializer: 'canonicalEvidenceString-v1', positionDecimals: 4, angleDecimals: 5, timeDecimals: 3, hash: 'sha256' },
  browserMayReadOnlyAsTargetList: true, browserFallbackAllowed: false,
  scenes: machineScenes,
  frameCount: flat.length,
  semanticFrameIds: flat.map((item) => item.semanticFrameId)
});
console.log(JSON.stringify({ ok: true, stage: '8.2G-B.1.1a', output, scenes: machineScenes.length, frames: flat.length }));
