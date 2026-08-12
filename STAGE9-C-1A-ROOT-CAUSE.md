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

## Fix

`tests/stage9-A-performance-test.mjs` no longer repeats the already-independent D-C.1 performance command. It still runs the four non-performance regression commands, records their exit status, signal, and expanded output tail, and keeps the Stage 9-A performance measurement and 16.7ms semantics unchanged. The independent CI step remains in `.github/workflows/core-regression.yml`; no step was deleted, made optional, or allowed to continue after failure.

No production authority, battle, planner, choreographer, solver, settlement, save-diff, or `tests/lib/` file was changed.
