import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadSnapshot } from './lib/perf-environment.mjs';

const BASELINE = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const outputDir = path.resolve(process.argv[2] || 'artifacts/stage9-c1b-final-closure');
const locate = (file) => {
  const direct = path.join(outputDir, file);
  if (fs.existsSync(direct)) return direct;
  const pending = [outputDir];
  while (pending.length > 0) {
    const current = pending.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.name === file) return candidate;
    }
  }
  throw new Error(`missing runtime evidence ${file} under ${outputDir}`);
};
const read = (file) => JSON.parse(fs.readFileSync(locate(file), 'utf8'));
const githubSha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const changedFiles = execFileSync('git', ['diff', '--name-only', `${BASELINE}..${githubSha}`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const frozenExact = new Set(['js/battle.js', 'js/theater.js', 'js/save-diff.js', 'experiments/battle-sandbox/universal-planner/universal-planner.js']);
const modifiedFrozenFiles = changedFiles.filter((file) => frozenExact.has(file) || file.startsWith('js/battle-presentation/universal/'));
const otherTestsLibAuthorityHelpersModified = changedFiles.filter((file) => file.startsWith('tests/lib/') && file !== 'tests/lib/perf-environment.mjs');
const performance = read('stage9_c1b_performance_result.json');
const stage9 = read('stage9_c1b_stage9c_result.json');
const cleanClone = read('stage9_c1b_clean_clone_result.json');
const cloneHead = cleanClone.steps.find((step) => step.step === 'clone-head-matches');

const closure = {
  stage: 'Stage 9-C.1b',
  githubSha,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 0) || null,
  runner: { name: process.env.RUNNER_NAME || null, os: process.env.RUNNER_OS || process.platform, arch: process.env.RUNNER_ARCH || process.arch, imageOS: process.env.ImageOS || null, imageVersion: process.env.ImageVersion || null, environment: loadSnapshot() },
  authorityFreeze: {
    baseline: BASELINE,
    changedFiles,
    modifiedFrozenFiles,
    performanceEnvironmentHelperModified: changedFiles.includes('tests/lib/perf-environment.mjs'),
    otherTestsLibAuthorityHelpersModified,
    passed: modifiedFrozenFiles.length === 0 && otherTestsLibAuthorityHelpersModified.length === 0
  },
  performance: {
    measurementValid: performance.measurementValid,
    environmentQualified: performance.environmentQualified,
    environmentQualificationReason: performance.environmentQualificationReason,
    warmupSamples: performance.warmupSamples,
    sampleCount: performance.sampleCount,
    formalMeasurementRuns: performance.formalMeasurementRuns,
    scenes: performance.scenes.map(({ sceneId, p50Ms, p90Ms, p95Ms, maxMs }) => ({ sceneId, p50Ms, p90Ms, p95Ms, maxMs, limitMs: 16.7, passed: p95Ms < 16.7 })),
    passed: performance.passed === true
  },
  stage9A: stage9.stage9A,
  stage9B: stage9.stage9B,
  stage9C: stage9.stage9C,
  cleanClone: {
    currentHead: cloneHead?.currentHead || null,
    clonedHead: cloneHead?.clonedHead || null,
    headMatches: cloneHead?.passed === true,
    overallPassed: cleanClone.overallPassed === true
  }
};
closure.passed = closure.githubSha === performance.githubSha && closure.githubSha === stage9.githubSha && closure.githubSha === closure.cleanClone.currentHead && closure.githubSha === closure.cleanClone.clonedHead && closure.authorityFreeze.passed && closure.performance.passed && stage9.passed === true && closure.cleanClone.overallPassed;
assert.equal(closure.passed, true, JSON.stringify(closure));
fs.writeFileSync(path.join(outputDir, 'stage9_c1b_runtime_closure.json'), `${JSON.stringify(closure, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, githubSha, output: path.join(outputDir, 'stage9_c1b_runtime_closure.json'), authorityFreeze: closure.authorityFreeze, performance: closure.performance, cleanClone: closure.cleanClone }));
