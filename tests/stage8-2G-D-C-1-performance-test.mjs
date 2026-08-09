import assert from 'node:assert/strict';
import os from 'node:os';
import { buildPresentations, definitions, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';

const warmupSamples = 20;
const sampleCount = 120;
const rows = [];
for (const { sceneId } of definitions) {
  const presentation = buildPresentations().get(sceneId);
  assert.equal(presentation?.ok, true, `presentation ${sceneId}`);
  const duration = presentation.plan.timeline.duration;
  for (let index = 0; index < warmupSamples; index += 1) presentation.renderState.atTime((duration * ((index * 17) % 101)) / 100);
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const start = process.hrtime.bigint();
    const state = presentation.renderState.atTime((duration * ((index * 37) % 101)) / 100);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    samples.push({ elapsedMs, effectCount: state.effects.length, smokeCount: state.smoke.length, projectileCount: state.projectiles.length, environmentObjectCount: state.environment?.objects?.length || 0 });
  }
  const sorted = [...samples].sort((a, b) => a.elapsedMs - b.elapsedMs);
  const percentile = (ratio) => sorted[Math.floor((sorted.length - 1) * ratio)].elapsedMs;
  const averageMs = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0) / samples.length;
  rows.push({ sceneId, actorCount: presentation.plan.forces.profile.totalCount, durationSeconds: duration, warmupSamples, samples: sampleCount, averageMs: Number(averageMs.toFixed(3)), medianMs: Number(percentile(.5).toFixed(3)), p90Ms: Number(percentile(.9).toFixed(3)), p95Ms: Number(percentile(.95).toFixed(3)), maxMs: Number(sorted.at(-1).elapsedMs.toFixed(3)), averageEffectCount: Number((samples.reduce((sum, sample) => sum + sample.effectCount, 0) / samples.length).toFixed(3)), peakEffectCount: Math.max(...samples.map((sample) => sample.effectCount)), peakSmokeCount: Math.max(...samples.map((sample) => sample.smokeCount)), peakProjectileCount: Math.max(...samples.map((sample) => sample.projectileCount)), peakEnvironmentObjectCount: Math.max(...samples.map((sample) => sample.environmentObjectCount)) });
}
const limits = { p95TotalPresentationBuildMs: 16.7, sampleCountMinimum: 100, maxEffects: 96, maxSmokeParticles: 32 };
const passed = rows.every((row) => row.samples >= limits.sampleCountMinimum && row.p95Ms < limits.p95TotalPresentationBuildMs && row.peakEffectCount <= limits.maxEffects && row.peakSmokeCount <= limits.maxSmokeParticles);
assert.equal(passed, true, JSON.stringify(rows));
writeJson('stage8_2g_dc1_performance_check.json', { stage: '8.2G-D-C.1', version: 1, measurement: 'complete presentation renderState.atTime including effects, camera, audio, transitions and environment state', runtime: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model || null }, warmupSamples, sampleCount, scenes: rows, limits, passed });
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C.1', sampleCount, rows: rows.map(({ sceneId, p95Ms, maxMs, peakEffectCount, peakSmokeCount }) => ({ sceneId, p95Ms, maxMs, peakEffectCount, peakSmokeCount })) }));
