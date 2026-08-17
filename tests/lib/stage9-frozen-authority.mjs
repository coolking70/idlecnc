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
// The manifest follows the repository's existing Stage 9 closure contract
// (STAGE9-FINAL.md "Authority Freeze" plus the frozen authority list already
// used by tests/generate-stage10-P-A-evidence.mjs). It fails closed: a file
// that is missing, unreadable from the baseline object database, unreadable in
// the working tree, or hash-mismatched is a violation.

export const STAGE9_ACCEPTED_BASE = 'ca408bb7031afda79a65af7aad27b6b64b7c18c4';

export const STAGE9_FROZEN_AUTHORITY_FILES = [
  'js/config.js',
  'js/state.js',
  'js/construction.js',
  'js/production.js',
  'js/equipment.js',
  'js/save.js',
  'js/offline.js',
  'js/formations.js',
  'js/theater.js',
  'js/battle.js',
  'js/battle-salvage.js',
  'js/production-battle-session.js',
  'js/save-diff.js'
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

export function readStage9FrozenAuthorityStatus(root) {
  let gitHead = null;
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    gitHead = null;
  }

  const rows = STAGE9_FROZEN_AUTHORITY_FILES.map((file) => compareAgainstBaseline(root, 'authority-file', file));
  STAGE9_FROZEN_AUTHORITY_EXACT_PATHS.forEach((file) => rows.push(compareAgainstBaseline(root, 'frozen-path', file)));

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
    checkedCount: rows.length,
    rows,
    intrusions,
    violations,
    passed: violations.length === 0
  };
}
