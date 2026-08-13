# Stage 9-C.1b Delivery Contract

## Scope

Stage 9-C.1b closes two process defects on baseline `27c115848bea9aaa965fa46b784940a9949537e4`:

1. D-C.1 hosted-runner qualification now distinguishes an unfit microbenchmark environment from a formal product performance failure.
2. Final verification is emitted as a same-SHA GitHub Actions artifact, so recording runtime truth never creates a new commit and changes the verified HEAD.

No Stage 9-D work or gameplay expansion is included.

## Performance contract

- `warmupSamples >= 20`
- `sampleCount >= 120` for every required scene
- `p95TotalPresentationBuildMs < 16.7`
- `maxEffects <= 96`
- `maxSmokeParticles <= 32`
- exactly one formal product measurement per performance-component execution
- no retry after product measurement starts
- no best-of-N, outlier trimming, ignored first failure, or threshold relaxation

`tests/lib/perf-environment.mjs` is the only modified file under `tests/lib/`. Its scope is limited to pre-measurement qualification. Raw qualification probes and raw product timing samples are persisted so the new verifier can recompute the decision instead of trusting `fit`, `measurementValid`, `passed`, or p95 declarations.

Eight true-value qualification tamper cases cover high calibration variance, excessive event-loop jitter, qualification/measurement mismatch, over-budget p95, insufficient samples, forged percentile, retry/best-of injection, and forged environment metadata. All preserve `passed=true`; `passedFlagOnlyCases` must remain zero.

## CI topology

`core-regression` has three required jobs:

1. `dc1-performance`: a fresh Ubuntu runner performs qualification and one formal D-C.1 measurement, then uploads raw and summarized evidence.
2. `node-core`: consumes that same-run performance artifact and runs the complete functional/evidence regression, including Stage 9-A/B/C Node and Browser gates.
3. `final-closure`: consumes both artifacts, runs `verify:clean-clone` on the exact checkout SHA, generates the closure JSON, and uploads `stage9-c1b-final-closure-${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`. Including run identity preserves both same-SHA executions instead of overwriting Attempt 1 evidence.

The aggregate local command `test:stage8-2G-D-C-1` still contains both performance and functional components. Ordinary `npm test` runs the performance component first and the functional component later, preserving full coverage while avoiding a late duplicate measurement after the heavy suite.

## Immutable final-head procedure

All source, tests, workflow and static documents are committed before FINAL_HEAD is created. This document deliberately does not hard-code a future commit SHA, workflow run ID, runner measurements, or clean-clone result.

After FINAL_HEAD is pushed:

- no runtime result is added to Git;
- Run A must be the push-triggered first execution and must succeed without rerun;
- Run B must independently execute the same SHA and also succeed;
- both runs must retain the `16.7ms` / `120`-sample contract and complete Stage 9-A/B/C Node and Browser jobs;
- clean-clone current and cloned HEAD must both equal `${GITHUB_SHA}`;
- runtime truth lives only in the workflow artifact and external delivery response;
- there are zero post-validation commits.

The required artifact files are:

- `stage9_c1b_runtime_closure.json`
- `stage9_c1b_clean_clone_result.json`
- `stage9_c1b_performance_result.json`
- `stage9_c1b_stage9c_result.json`

## Authority Freeze

The closure generator diffs the baseline against the checked-out SHA. It fails if any Formal Battle authority file, universal planner/choreographer file, or any `tests/lib/` helper other than `perf-environment.mjs` changed. Production JS, battle settlement semantics, equipment acquisition semantics, Stage 9-A values and the Stage 9-B equipment seam remain unchanged.

## Closure criteria

Stage 9-C closes only when Run A first execution and Run B same-SHA execution both succeed, their performance artifacts independently qualify and remain below budget, Stage 9-C remains 9 frames / 4 reloads / 141 of 141 tamper / 11 of 11 coupled tamper / 0 flag-only, clean clone verifies the same SHA, remote HEAD equals FINAL_HEAD, and no commit follows validation.
