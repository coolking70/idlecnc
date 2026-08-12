# Stage 9-C.1a — Final-Head CI Regression Root Cause

## Baseline and incident

- Baseline HEAD: `86067c36fe94ecadca1c968f05550220cdf62bed`
- Workflow: `core-regression`
- Run: `31630388697`
- Job: `94227353734`
- Failing step: `npm run test:stage9-A`

The complete GitHub Actions log shows that all 21 Stage 9-A functional checks passed. The step then reported:

```text
{"ok":false,"stage":"9-A","p95Ms":0.0595520000000036,"maxMs":0.8968190000000007,"regressions":5}
```

The failure was therefore in the nested regression aggregation inside `tests/stage9-A-performance-test.mjs`, not in a Stage 9-A business assertion. The nested list included `tests/stage8-2G-D-C-1-performance-test.mjs`, which was already executed as the independent CI step `npm run test:stage8-2G-D-C-1` earlier in the same job. That second execution re-entered the environment-sensitive performance guard after the runner had accumulated the preceding CPU-heavy regression work. The D-C.1 performance budget itself remained unchanged and its independent CI step had passed.

## Classification

Primary categories: **D — Windows/macOS vs Linux difference** and **L — timing / race**.

The Ubuntu runner's serialized process history made the duplicate D-C.1 measurement non-reproducible. Local macOS dirty-tree and local clean-clone runs passed. The GitHub run's 21/21 Stage 9-A functional checks passed, while the independent D-C.1 run passed earlier and the duplicated invocation was the unstable part of the Stage 9-A aggregate. A fresh clean clone reproduced `npm run test:stage9-A` with exit 0.

The first final-head attempt after that fix exposed a second, separate runner-order failure. Run `31637103269`, job `94250091443`, passed Stage 8.2G through D-C, then the independent D-C.1 step measured the `stage8g-dc-art` scene at p95 `17.442ms` on Ubuntu 24.04 / Node 22.23.2 after the preceding D-A/D-B workload; the assertion failed at `tests/stage8-2G-D-C-1-performance-test.mjs:46`. The same command passed before the heavy regression on the local machine (`3.468/2.885/4.161ms` in the three scenes). This is category **L** (timing/runner load), with the platform-specific manifestation in category **M**.

The second candidate then exposed a deterministic ordering dependency created by moving D-C.1: Run `31638840429`, job `94255921991`, failed before measurement because `generate-stage8-2G-DC1-machine-evidence.mjs` consumed D-C-derived files that had not yet been created (`ENOENT stage8_2g_dc_muzzle_effect_check.json`). This is category **F** (ordering instability), not a production or performance change.

## Fix

`tests/stage9-A-performance-test.mjs` no longer repeats the already-independent D-C.1 performance command. The independent D-C.1 CI step remains immediately after install, before the CPU-heavy D-A/D-B regression sequence. A narrow prep step creates only the D-C source machine/evidence inputs required by the existing D-C.1 verifier; the full D-C regression remains later in its original position. No step was deleted, made optional, or allowed to continue after failure. The D-C.1 guard, warmup, 120 samples, and strict 16.7ms budget are unchanged.

No production authority, battle, planner, choreographer, solver, settlement, save-diff, or `tests/lib/` file was changed.

## Final closure evidence

- Final commit: `d2be365cf2bf5d1f56c1bd52e7101bc8c8e54dd3`
- Remote branch: `auto/stage9-c-equipment-acquisition`
- Same-SHA workflow: run `31642115695`, job `94266919302`, conclusion `success`
- Clean clone: exit `0`, `overallPassed=true`, `clonedHead == currentHead == d2be365cf2bf5d1f56c1bd52e7101bc8c8e54dd3`
- Stage 9-C browser evidence: 9 frames, 4 real reloads, 141/141 true-value tamper rejections, 11/11 coupled tamper rejections, `passedFlagOnlyCases=0`
