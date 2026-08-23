import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Downstream-safe Stage 9 frozen authority guard.
//
// Stage 9 is closed at the accepted baseline below. Downstream stages
// (10, 11, 12, ...) may add presentation code, tests, evidence, workflows and
// documents, but the frozen Stage 9 gameplay / formal authority surface must
// stay byte-identical to that accepted baseline. This module is the single
// source of truth for that check so every Stage 9 regression guard asserts the
// same manifest instead of misreading "anything changed since Stage 9-D" as an
// authority violation.
//
// Stage 10-A boundary adjustment (per the accepted Stage 10-A instruction):
// Stage 10 legitimately adds new gameplay state (operational tasking), so the
// shared integration files it must extend move from byte-freeze to an
// "additive-only" contract:
//
//   1. every export that existed in the Stage 9 baseline must still exist
//      (no removals / renames — checked structurally below);
//   2. Stage 9 semantics for saves without Stage 10 tasking stay frozen and
//      are proven by the existing Stage 9 regression suites (battle
//      determinism, equipment, salvage, formal settlement, replay, offline,
//      formation lifecycle) that run in `npm test` / posttest;
//   3. the Stage 10 additions themselves are guarded by the Stage 10-A
//      targeted tests (tests/stage10-A-operational-tasking-test.mjs).
//
// Stage 10-A.1: js/formations.js joins theater.js / offline.js under this
// contract because tasking-aware member-management guards are genuine
// authority-layer invariants (tasked formations keep the Stage 9 idle
// lifecycle, so the idle-only edit checks cannot see the conflict).
//
// Everything else keeps the original byte-level freeze. The guard still fails
// closed: unreadable files, hash mismatches, missing baseline exports, or new
// files under a frozen prefix are violations.

export const STAGE9_ACCEPTED_BASE = 'ca408bb7031afda79a65af7aad27b6b64b7c18c4';

export const STAGE9_FROZEN_AUTHORITY_FILES = [
  'js/config.js',
  'js/state.js',
  'js/construction.js',
  'js/production.js',
  'js/equipment.js',
  'js/battle.js',
  'js/battle-salvage.js',
  'js/production-battle-session.js',
  'js/save-diff.js'
];

// Files Stage 10 gameplay must legitimately extend (operational tasking
// hooks: dispatch eligibility, offline progression, and the Stage 10-A.1
// tasking-aware member-management guards in the formation authority).
// Byte-freeze is replaced by the additive-only export contract described
// above; Stage 9 formation semantics remain guarded by the Stage 9
// regression suites, the additive behavior by the Stage 10-A tests.
export const STAGE9_SEMANTIC_SHARED_FILES = [
  'js/theater.js',
  'js/offline.js',
  'js/formations.js',
  // Stage 10-B: migrate() carries the additive theaterPressure payload for
  // the dynamic-theater-pressure stage; save/load semantics for Stage 9
  // saves stay covered by the Stage 9 regression suites.
  'js/save.js'
];

// Formal solver / planner authority that STAGE9-FINAL.md freezes in addition to
// the gameplay authority files above. `js/battle-presentation/universal/` is
// guarded as a frozen prefix: baseline members must stay byte-identical and no
// new file may appear under it.
export const STAGE9_FROZEN_AUTHORITY_EXACT_PATHS = [
  'experiments/battle-sandbox/universal-planner/universal-planner.js'
];

export const STAGE9_FROZEN_AUTHORITY_PREFIXES = [
  'js/battle-presentation/universal/'
];

const MAX_BUFFER = 32 * 1024 * 1024;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function gitLines(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER })
    .split('\n').map((row) => row.trim()).filter(Boolean);
}

function baselineBlob(root, relativePath) {
  return execFileSync('git', ['show', `${STAGE9_ACCEPTED_BASE}:${relativePath}`], { cwd: root, maxBuffer: MAX_BUFFER });
}

function baselineTreeFiles(root, prefix) {
  return gitLines(root, ['ls-tree', '-r', '--name-only', STAGE9_ACCEPTED_BASE, '--', prefix]);
}

function currentTreeFiles(root, prefix) {
  if (!fs.existsSync(path.join(root, prefix))) return [];
  const untracked = new Set(gitLines(root, ['ls-files', '--others', '--exclude-standard', '--', prefix]));
  const tracked = gitLines(root, ['ls-files', '--', prefix]);
  return [...new Set([...tracked, ...untracked])];
}

function compareAgainstBaseline(root, kind, file, extra = {}) {
  const row = { kind, file, ...extra, baselineSha256: null, currentSha256: null, unchanged: false, reason: null };
  let baselineBytes = null;
  let currentBytes = null;
  try {
    baselineBytes = baselineBlob(root, file);
    row.baselineSha256 = sha256(baselineBytes);
  } catch (error) {
    row.reason = `baseline unreadable at ${STAGE9_ACCEPTED_BASE}: ${error.message}`;
  }
  try {
    currentBytes = fs.readFileSync(path.join(root, file));
    row.currentSha256 = sha256(currentBytes);
  } catch (error) {
    row.reason = `${row.reason ? `${row.reason}; ` : ''}current working tree unreadable: ${error.message}`;
  }
  if (row.reason === null) {
    row.unchanged = baselineBytes.equals(currentBytes);
    if (!row.unchanged) row.reason = 'bytes differ from the accepted Stage 9 baseline';
  }
  return row;
}

const EXPORT_NAME_PATTERN = /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g;

function exportNames(source) {
  const names = new Set();
  let match;
  EXPORT_NAME_PATTERN.lastIndex = 0;
  while ((match = EXPORT_NAME_PATTERN.exec(source)) !== null) names.add(match[1]);
  return names;
}

/**
 * Additive-only contract for shared integration files Stage 10 extends:
 * every Stage 9 baseline export must still exist under the same name. Stage 9
 * semantics for tasking-free saves are covered by the Stage 9 regression
 * suites; Stage 10 additions are covered by the Stage 10-A targeted tests.
 */
function compareSharedAdditive(root, file) {
  const row = { kind: 'shared-additive-file', file, baselineExports: null, currentExports: null, missingExports: [], unchanged: false, reason: null };
  let baselineSource = null;
  let currentSource = null;
  try {
    baselineSource = baselineBlob(root, file).toString('utf8');
  } catch (error) {
    row.reason = `baseline unreadable at ${STAGE9_ACCEPTED_BASE}: ${error.message}`;
  }
  try {
    currentSource = fs.readFileSync(path.join(root, file), 'utf8');
  } catch (error) {
    row.reason = `${row.reason ? `${row.reason}; ` : ''}current working tree unreadable: ${error.message}`;
  }
  if (row.reason !== null) return row;
  const baselineExports = exportNames(baselineSource);
  const currentExports = exportNames(currentSource);
  row.baselineExports = [...baselineExports].sort();
  row.currentExports = [...currentExports].sort();
  row.missingExports = row.baselineExports.filter((name) => !currentExports.has(name));
  row.unchanged = row.missingExports.length === 0;
  if (!row.unchanged) row.reason = `Stage 9 exports removed or renamed: ${row.missingExports.join(', ')}`;
  return row;
}

export function readStage9FrozenAuthorityStatus(root) {
  let gitHead = null;
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    gitHead = null;
  }

  const rows = STAGE9_FROZEN_AUTHORITY_FILES.map((file) => compareAgainstBaseline(root, 'authority-file', file));
  STAGE9_FROZEN_AUTHORITY_EXACT_PATHS.forEach((file) => rows.push(compareAgainstBaseline(root, 'frozen-path', file)));
  STAGE9_SEMANTIC_SHARED_FILES.forEach((file) => rows.push(compareSharedAdditive(root, file)));

  const intrusions = [];
  STAGE9_FROZEN_AUTHORITY_PREFIXES.forEach((prefix) => {
    const baselineMembers = baselineTreeFiles(root, prefix);
    baselineMembers.forEach((file) => rows.push(compareAgainstBaseline(root, 'frozen-prefix-member', file, { prefix })));
    currentTreeFiles(root, prefix).forEach((file) => {
      if (!baselineMembers.includes(file)) {
        intrusions.push({ kind: 'frozen-prefix-intrusion', file, prefix, reason: `new file under frozen authority prefix ${prefix}` });
      }
    });
  });

  const violations = [...rows.filter((row) => row.unchanged !== true), ...intrusions];
  return {
    baseline: STAGE9_ACCEPTED_BASE,
    gitHead,
    frozenFileCount: STAGE9_FROZEN_AUTHORITY_FILES.length,
    sharedFileCount: STAGE9_SEMANTIC_SHARED_FILES.length,
    checkedCount: rows.length,
    rows,
    intrusions,
    violations,
    passed: violations.length === 0
  };
}
