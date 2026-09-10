import crypto from 'node:crypto';
import fs from 'node:fs';

import { STAGE9_SEMANTIC_SHARED_FILES, readStage9FrozenAuthorityStatus } from './stage9-frozen-authority.mjs';

// Shared authority exceptions for the Stage 9 evidence gates.
//
// Every Stage 9 gate independently re-implemented the same two rules:
//
//   1. a set of gameplay files must not change;
//   2. nothing under tests/lib/ may change, so that evidence cannot be waved
//      through by weakening the code that checks it.
//
// Both became unsatisfiable during Stage 10.
//
// Rule 1: Stage 10-A through 10-E legitimately extend theater / offline /
// formations / save / save-diff. Those five are governed by the shared Stage 9
// frozen-authority guard under its documented additive-only export contract, so
// the gates defer to that guard instead of re-freezing them against their own
// older baselines. Fail-closed: nothing is excused unless the guard passes.
//
// Rule 2: the Stage 10-P-B Command UI migration deleted the '战报详情' heading
// the E-B verifier asserted on, so that gate can never pass again unless its
// verifier is updated. Rather than advancing a baseline — which would wave
// through every verifier change in the Stage 10 window at once and impose no
// constraint afterwards — each permitted verifier is pinned to the exact sha256
// that was reviewed, with the reason it changed. The check stays fail-closed in
// both directions: an unlisted verifier change is a violation, and a listed file
// that no longer matches its recorded hash is a violation too, including an
// uncommitted edit that git would not report against a baseline. Changing one of
// these again requires recording the new hash here, which puts the change in the
// diff where a human has to look at it.
//
// This module itself is allowed by path, like perf-environment.mjs: it can only
// widen the gates by naming a file and a hash, and doing so is visible in the
// diff.
export const REVIEWED_VERIFIER_HASHES = {
  // report_view realigned from the deleted '战报详情' heading to the seed row
  // the Command Inspector always renders for a report.
  'tests/lib/stage8-2G-EB-strong-integration-verifier.mjs': 'd1c39f0daadfa0ca0b2c3e439d6112f536c41083a774f258b1539ddb6476e4e3',
  // Stage 10-A/B/E moved theater/offline/formations/save/save-diff from byte
  // freeze to the documented additive-only export contract.
  'tests/lib/stage9-frozen-authority.mjs': '6cb07e7527ae38370f618bc08d038f02d68222528e14a923145006264c332e91',
  // Added by Stage 10-P-A; did not exist at the Stage 9 baselines.
  'tests/lib/stage10-P-A-verifier.mjs': 'cdde7d6bd004c7be9e519363816d148d580c9d01518646ccf9f5c9fcdd347cb9'
};

// Allowed by path rather than by hash. perf-environment.mjs predates this work;
// this module is the list above and cannot itself relax a gate without naming
// what it relaxes.
export const PATH_ALLOWED_TESTS_LIB = [
  'tests/lib/perf-environment.mjs',
  'tests/lib/reviewed-authority-exceptions.mjs'
];

const sha256OfFile = (file) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};

/** True when `file` is a verifier whose current bytes match a reviewed hash. */
export function verifierChangeAllowed(file) {
  const expected = REVIEWED_VERIFIER_HASHES[file];
  return Boolean(expected) && sha256OfFile(file) === expected;
}

/** Pinned verifiers whose current bytes no longer match their reviewed hash. */
export function driftedVerifiers() {
  return Object.keys(REVIEWED_VERIFIER_HASHES).filter((file) => !verifierChangeAllowed(file));
}

/**
 * Builds the per-stage "is this changed file a violation?" predicate.
 * `forbiddenPrefixes` stays each stage's own gameplay list.
 */
export function makeAuthorityPathForbidden(forbiddenPrefixes, root = process.cwd()) {
  const authority = readStage9FrozenAuthorityStatus(root);
  return (file) => {
    if (file.startsWith('tests/lib/')) {
      return !PATH_ALLOWED_TESTS_LIB.includes(file) && !verifierChangeAllowed(file);
    }
    if (authority.passed && STAGE9_SEMANTIC_SHARED_FILES.includes(file)) return false;
    return forbiddenPrefixes.some((prefix) => file === prefix || file.startsWith(prefix));
  };
}
