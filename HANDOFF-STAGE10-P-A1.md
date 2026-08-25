# Stage 10-P-A.1 - Downstream Regression & Final-Head Closure Hotfix Handoff

## Delivery identity

- Stage 9 accepted baseline (frozen authority manifest base): `ca408bb7031afda79a65af7aad27b6b64b7c18c4`
- Stage 10-P-A implementation checkpoint: `136b8573eefb85911f35b23c3043f5f5f6c87832`
- Stage 10-P-A previous remote head (this hotfix's base): `b0f51e44bde6f607e14fe77832041ba6acc50fd0`
- Branch: `auto/stage10-p-a1-downstream-regression-final-closure`
- Scope: downstream regression-guard fix and CI / final-head evidence closure only. No Stage 10-P-A UI rework, no Stage 10-P-B, no Stage 10-A, no gameplay changes.

## What was actually broken

GitHub Actions run `31837650080` (workflow `stage10-p-a-command-ui`) failed its "Stage 9 relevant regression" step: `tests/stage9-E-integration-test.mjs` ended 22/23. The failing check was the last one, the source-scope guard:

```js
git diff --name-only 5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6 --   // Stage 9-D.1 baseline
```

It interpreted "anything that changed in the repository since Stage 9-D" as "Stage 9 authority was violated". Every legitimate downstream addition - `tests/lib/stage10-P-A-verifier.mjs`, Stage 10 evidence, screenshots, workflows, docs - tripped it. The same downstream-unsafe pattern existed in `tests/stage9-B-equipment-test.mjs`, `tests/stage9-C-equipment-acquisition-test.mjs`, and `tests/stage9-A-theater-expansion-test.mjs` (they would have failed next in the same chain), and `tests/stage9-D-battle-salvage-test.mjs` recorded the same false positive into its evidence.

A second, independent defect: the committed Stage 10 machine evidence hardcoded `stage9RelevantRegression: true` and `STAGE10-P-A-SELFCHECK.json` claimed `passed: true`, while the real CI gate was failing - a static checkpoint was presented as delivery closure, and the committed evidence head (`136b857...`) was not the final remote head (`b0f51e4...`).

## Fix 1 - downstream-safe Stage 9 frozen authority guard

New shared guard: `tests/lib/stage9-frozen-authority.mjs`.

Old semantics ("has anything changed since Stage 9-D?") is replaced by the correct one: "is the frozen Stage 9 authority surface still byte-identical to the accepted Stage 9 closure baseline `ca408bb7031afda79a65af7aad27b6b64b7c18c4`?".

Protected manifest (the repository's existing Stage 9 closure contract, identical to the list already used by `tests/generate-stage10-P-A-evidence.mjs`):

- `js/config.js`
- `js/state.js`
- `js/construction.js`
- `js/production.js`
- `js/equipment.js`
- `js/save.js`
- `js/offline.js`
- `js/formations.js`
- `js/theater.js`
- `js/battle.js`
- `js/battle-salvage.js`
- `js/production-battle-session.js`
- `js/save-diff.js`

Plus, per `STAGE9-FINAL.md` Authority Freeze:

- exact frozen path: `experiments/battle-sandbox/universal-planner/universal-planner.js`
- frozen prefix: `js/battle-presentation/universal/` (all 49 baseline members byte-identical; no new files may appear under it)

Verification is `git show <baseline>:<file>` versus the current working tree compared by SHA-256, with per-file rows `{file, baselineSha256, currentSha256, unchanged}`. It fails closed when a file is missing, unreadable from the baseline object database, unreadable in the working tree, or hash-mismatched. 63 targets are checked in total; all are unchanged (`violations: []`).

Applied to:

- `tests/stage9-E-integration-test.mjs` - guard replaced, still exactly 23 checks, 23/23 pass
- `tests/stage9-B-equipment-test.mjs` - file-scope assertion replaced; equipment UI authority regexes and Stage 9-A counts kept
- `tests/stage9-C-equipment-acquisition-test.mjs` - file-scope assertion replaced; theater/operation/technology counts kept
- `tests/stage9-A-theater-expansion-test.mjs` - file-scope assertion replaced
- `tests/stage9-D-battle-salvage-test.mjs` - evidence now records the frozen-authority result and fails on violations

All Stage 9 semantic checks (campaign, equipment acquisition, production queue, research gate, mount, dispatch, formal battle, settlement, salvage, claim exactly-once, migration, replay, offline production) still run unchanged. Downstream stages may freely add presentation code, tests, evidence, workflows and docs; they may not modify the frozen authority surface.

## Fix 2 - runtime-bound final closure

- `tests/record-stage10-P-A-runtime-gate.mjs` executes each real gate command and records its true exit code into `evidence/stage10-P-A/stage10-P-A-runtime-gates.json`, bound to the git HEAD that produced it (records from another HEAD are reset, and consumers re-verify the binding).
- `tests/generate-stage10-P-A-evidence.mjs` no longer hardcodes regression flags. `historicalCoreRegression`, `stage9RelevantRegression`, `stage10CommandUiTests`, `stage10BrowserRun` come from the recorded gates of this run at this HEAD; construction/unit/equipment/cancellation semantics come from the recomputed canonical state equivalence artifact; browser evidence comes from the run's browser JSON. Missing or failed records fail closed.
- `tests/lib/stage10-P-A-verifier.mjs` gains independent machine-evidence verification (stage9 base SHA, current-HEAD binding, frozen authority rows, runtime gate records, equivalence claim); the strong evidence test uses it.
- Tamper corpus: 16 cases (9 browser + 7 machine), including screenshot hash corruption, duplicate PNG bytes, semantic frame corruption, hidden page/console errors, machine head SHA mismatch, stale gate head binding, authority-changed flag, frozen-proof row change, state-equivalence flip, removed gate record, gate failure hidden by a regression flag, and passed-flag forgery. Every candidate declares `passed=true`; every candidate is rejected.
- `STAGE10-P-A-SELFCHECK.json` is now an implementation-only checkpoint by contract: `implementationPassed: true`, `deliveryClosed: false`, `passed: false`, with `externalGateRuns` explicitly null until the runtime closure. `tests/stage10-P-A-selfcheck-contract-test.mjs` locks this contract so a committed static JSON can never again contradict the real gate.
- `tests/generate-stage10-P-A-final-closure.mjs` produces `evidence/stage10-P-A/stage10-P-A-final-closure.json` at runtime: it binds `finalHead === workflowHead === GITHUB_SHA`, requires all five recorded gates (historical, stage9, focused, browser, strong verifier) to have exit code 0 at that HEAD, re-verifies the browser evidence independently (13 frames, unique hashes, zero page/console errors, desktop/mobile/hover/long-press coverage), requires the strong verdict and full tamper rejection, reads the fresh Stage 9-E core evidence (23/23), confirms `gameplayAuthorityChanged === false` and `SAVE_VERSION === 10`, and only then sets `deliveryClosed: true, passed: true`. Any failure exits 1.
- `.github/workflows/stage10-p-a.yml` checks out the exact `github.sha`, wraps every gate in the recorder, adds the final runtime closure step before the evidence upload, and registers this branch. No `continue-on-error` anywhere.

## CI gate order (final head, single run)

1. checkout exact `github.sha`
2. install runtime
3. Historical core regression (recorded)
4. Stage 9 relevant regression (recorded)
5. restore accepted historical evidence bytes
6. Stage 10-P-A focused unit + canonical equivalence (recorded)
7. Stage 10-P-A real Chromium browser evidence (recorded)
8. Stage 10-P-A strong verifier + tamper corpus (recorded)
9. Stage 10-P-A final runtime closure
10. upload same-run evidence

## Product freeze confirmation

- `package.json` version stays `0.9.0`; `package-lock.json` metadata resynced to the same existing version (no version bump).
- `SAVE_VERSION` stays `10`. No new migration, no save schema change, no canonical state extension.
- No changes to `js/command-ui.js`, `js/command-presentation.js`, `js/ui.js`, `css/style.css`, `assets/command/*`, or any frozen gameplay authority file in this hotfix.

## Evidence state after this hotfix

- Committed evidence (machine/browser/equivalence/verdict/tamper/selfcheck) is the implementation checkpoint for this branch's head, regenerated by the full local gate.
- Committed `STAGE10-P-A-SELFCHECK.json` deliberately states `deliveryClosed: false, passed: false`.
- The authoritative delivery closure is the same-run CI artifact `evidence/stage10-P-A/stage10-P-A-final-closure.json` from the final workflow head; its `finalHead` must equal the final remote HEAD of this branch.

## Stage 10-P-B / Stage 10-A

NOT IMPLEMENTED (unchanged boundary).
