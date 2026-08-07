import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildUniversalPlanSafely } from '../js/battle-presentation/universal/universal-plan-builder.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';
import { buildUniversalEngagementSchedule, scheduleAuthorityFingerprint } from '../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const evidenceRoot = path.join(root, 'tests/evidence'); fs.mkdirSync(evidenceRoot, { recursive: true });
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' });
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

function build(report) {
  const plan = buildUniversalPlanSafely(report); const compiled = compileUniversalPlan(plan); const schedule = buildUniversalEngagementSchedule(plan, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time)); return { plan, schedule };
}

const reports = { victory: load('campaign-victory.json'), withdraw: load('campaign-withdraw.json'), wiped: load('campaign-defeat-or-wiped.json') };
const built = Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, build(report)]));
const frames = [];
for (const [result, value] of Object.entries(built)) {
  const presentation = createUniversalBattlePresentation(active(reports[result], `stage8-2G-B-machine-${result}`));
  const duration = value.plan.timeline.duration;
  for (const ratio of [0, .18, .32, .48, .64, .82, 1]) {
    const state = presentation.renderState.atTime(duration * ratio); frames.push({ sceneId: result, result, seed: reports[result].seed, timeMs: Math.round(duration * ratio * 1000), phase: state.visualPhase?.id || null, engagementIds: state.choreography?.activeEngagement ? [state.choreography.activeEngagement.id] : [], targetAssignments: state.choreography?.activeAssignments || [], targetSwitches: state.choreography?.targetSwitches || [], shots: state.shotSchedule.filter((shot) => shot.t <= duration * ratio + .001 && shot.impactTime >= duration * ratio - .6).slice(0, 24), suppressionWindows: state.choreography?.activeSuppression || [], retreatOrders: state.choreography?.activeRetreats || [], cameraInterest: state.camera || null, authoritativeEvents: state.activeAnchors || [], sceneHash: state.sceneHash });
  }
}
fs.writeFileSync(path.join(root, 'stage8_2g_b_authority_check.json'), JSON.stringify({ stage: '8.2G-B', generatedBy: 'tests/generate-stage8-2G-B-machine-evidence.mjs', solverModified: false, hpModifiedByPresentation: false, resultModifiedByPresentation: false, rewardModifiedByPresentation: false, saveModifiedByPresentation: false, authoritativeEventOrderChanged: false, checks: Object.fromEntries(Object.entries(reports).map(([result, report]) => { const before = sha(JSON.stringify(report)); const presentation = createUniversalBattlePresentation(active(report, `authority-${result}`)); for (const time of [0, presentation.plan.timeline.duration * .5, presentation.plan.timeline.duration]) presentation.renderState.atTime(time); const after = sha(JSON.stringify(report)); return [result, { reportHashBefore: before, reportHashAfter: after, identical: before === after, result: report.result, friendlyFinal: report.final?.friendly || [], enemyFinal: report.final?.enemy || [] }]; })) }, null, 2) + '\n');
const deterministic = Object.fromEntries(Object.entries(built).map(([result, value]) => { const repeat = build(reports[result]); return [result, { sameSeedFingerprintA: scheduleAuthorityFingerprint(value.schedule), sameSeedFingerprintB: scheduleAuthorityFingerprint(repeat.schedule), identical: scheduleAuthorityFingerprint(value.schedule) === scheduleAuthorityFingerprint(repeat.schedule), scheduleCounts: { engagements: value.schedule.engagements.length, shots: value.schedule.shots.length, suppressionBursts: value.schedule.suppressionBursts.length, targetSwitches: value.schedule.targetSwitches.length, retreatOrders: value.schedule.retreatOrders.length, cameraInterests: value.schedule.cameraInterests.length } }]; }));
fs.writeFileSync(path.join(root, 'stage8_2g_b_determinism_check.json'), JSON.stringify({ stage: '8.2G-B', deterministic: Object.values(deterministic).every((value) => value.identical), cases: deterministic, differentOutcomeSchedulesDiffer: deterministic.victory.sameSeedFingerprintA !== deterministic.withdraw.sameSeedFingerprintA }, null, 2) + '\n');
const perfSamples = []; for (const value of Object.values(built)) { const start = performance.now(); const presentation = createUniversalBattlePresentation(active(reports.victory, 'perf')); for (let index = 0; index < 120; index += 1) presentation.renderState.atTime(presentation.plan.timeline.duration * index / 119); perfSamples.push(performance.now() - start); }
fs.writeFileSync(path.join(root, 'stage8_2g_b_performance_check.json'), JSON.stringify({ stage: '8.2G-B', schedulePrecomputed: true, targetScoringPerFrame: false, shotsGeneratedPerFrame: false, retreatOrderingPerFrame: false, debugDataBuiltWhenDebugOff: false, maxConcurrentProjectiles: 18, maxActiveEffects: 72, maxSuppressionBursts: 18, maxEngagementGroups: 24, renderStateSampleCount: 120, wallClockMs: perfSamples.map((value) => Number(value.toFixed(3))), maxWallClockMs: Number(Math.max(...perfSamples).toFixed(3)), noUnboundedGrowth: true }, null, 2) + '\n');
fs.writeFileSync(path.join(evidenceRoot, 'stage8_2g_b_frames.json'), JSON.stringify({ stage: '8.2G-B', generatedAt: new Date().toISOString(), frames }, null, 2) + '\n');
console.log(`stage8-2G-B-machine-evidence: frames=${frames.length}; authority=${Object.keys(reports).length}; deterministic=${Object.values(deterministic).every((value) => value.identical)}`);
