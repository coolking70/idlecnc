# Stage 9-C.1a — Final-Head CI Regression Closure

## Scope and result

This is a reproducibility hotfix only. It does not add equipment gameplay, drops, crafting, economy, UI, or Stage 9-D work.

- Baseline HEAD: `86067c36fe94ecadca1c968f05550220cdf62bed`
- Final HEAD: recorded in `stage9_c1a_ci_regression_check.json` after the final commit
- Root cause: Stage 9-A performance test duplicated the already-independent D-C.1 performance command inside a cumulative Ubuntu runner; the duplicate environment-sensitive measurement failed closed while 21/21 Stage 9-A functional checks passed.
- Fix: remove only that duplicate nested command; retain the independent D-C.1 CI step and all 16.7ms/performance guards.

## Authority boundary

The only source change is `tests/stage9-A-performance-test.mjs`. No `js/` runtime authority, Formal Battle, Formal Report, Planner, Choreographer, Solver, settlement, save-diff, `tests/lib/`, workflow step, or performance threshold was modified.

## Real CI evidence

The original run `31630388697`, job `94227353734`, was read through the GitHub Actions job log. It records Stage 9-A `21 passed / 0 failed / 21 total`, followed by `ok:false` from the nested regression summary. The official failed job was rerun before this fix as an incident reproduction check. The final-head CI evidence below must be refreshed after the final commit and must not report success until the same final `head_sha` completes all steps.

## Commands and required results

The final run records exit codes in `stage9_c1a_ci_regression_check.json`, `stage9_c1a_clean_clone_result.json`, and `stage9_c1a_final_head_ci.json`:

```text
npm install --ignore-scripts --no-audit --no-fund
npm run test:stage9-A
npm run browser:stage9-A
npm run test:stage9-B
npm run browser:stage9-B
npm run test:stage9-C
npm run browser:stage9-C
npm run gate:stage8-2G
npm run verify:clean-clone
git rev-parse HEAD
git status --porcelain
git ls-remote origin auto/stage9-c-equipment-acquisition
```

The independent final-head CI must have `head_sha == FINAL_HEAD`, `conclusion=success`, and successful, non-skipped Stage 9-A, 9-B, and 9-C Node/Browser steps.

## Stage 9-C invariants

- tamper: `141/141` rejected
- coupled tamper: `11/11` rejected
- `passedFlagOnlyCases`: `0`
- performance: warmup `20`, samples `120`, p95 `<16.7ms`
- clean-clone: `overallPassed=true`

## Closure status

Stage 9-C.1a is only `PASSED` and Stage 9-C is only `CLOSED` when the final evidence JSONs, clean-clone result, remote SHA, and same-SHA GitHub Actions success all agree. Until then, this document must retain a pending status rather than self-declare closure.
