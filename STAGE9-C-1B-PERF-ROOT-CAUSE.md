# Stage 9-C.1b Performance Root Cause

## 审计基线

- Repository: `coolking70/idlecnc`
- Branch: `auto/stage9-c-equipment-acquisition`
- Baseline: `27c115848bea9aaa965fa46b784940a9949537e4`
- Historical workflow: `core-regression` Run `31648264645`
- Product budget: every required scene p95 must be strictly less than `16.7ms`
- Measurement contract: `20` warmups and `120` formal samples per scene

## Historical Attempt 1 / Attempt 2

The table below records only values present in the immutable GitHub job logs. “Unavailable” is intentional: the old workflow neither printed nor uploaded those fields, so attributing values from another run would be false evidence.

| Field | Attempt 1 | Attempt 2 |
| --- | --- | --- |
| Job | `94286720709` | `94287359188` |
| Result | FAIL | PASS |
| Azure region | `westcentralus` | `westus` |
| Runner image | Ubuntu 24.04, image `20260720.247.2` | Ubuntu 24.04, image `20260720.247.2` |
| Node | `v22.23.1` | `v22.23.1` |
| CPU model / count | Unavailable in the failed job log | `AMD EPYC 7763 64-Core Processor`, 4 CPUs, emitted later by Stage 9-B in the same job |
| Normalized load at D-C.1 | Unavailable | Unavailable; `0.28` was emitted about 17 minutes later and is not treated as the D-C.1 value |
| Old guard samples | Unavailable | Unavailable |
| Environment decision | Inferred `fit=true`, because the formal measurement started | Inferred `fit=true`, because the formal measurement started |

Attempt 1 formal measurements:

| Scene | average | p50 | p90 | p95 | max | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `stage8g-dc-victory` | 10.730 | 10.194 | 12.925 | 16.040 | 21.031 | PASS |
| `stage8g-dc-withdraw` | 9.206 | 8.760 | 10.097 | 12.150 | 19.630 | PASS |
| `stage8g-dc-art` | 13.753 | 13.648 | 14.974 | 17.218 | 22.419 | FAIL |

Attempt 2’s old success logger emitted only p95 and max:

| Scene | p50 | p90 | p95 | max | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `stage8g-dc-victory` | Unavailable | Unavailable | 14.700 | 19.883 | PASS |
| `stage8g-dc-withdraw` | Unavailable | Unavailable | 14.727 | 17.508 | PASS |
| `stage8g-dc-art` | Unavailable | Unavailable | 14.916 | 19.329 | PASS |

Both attempts used the same source SHA, image version and Node version, but they were separate hosted runners in different Azure regions. The art-scene p95 moved by `2.302ms`; that is large enough to cross a budget with only a small margin.

## Why the old guard admitted Attempt 1

The old `awaitFitEnvironment()` sampled only the 1-minute load average divided by `os.cpus().length`. It returned immediately after the first sample below `0.75`. That signal has four blind spots:

1. A 1-minute average cannot expose millisecond-scale scheduler pauses that affect a 120-sample microbenchmark.
2. Logical CPU count can overstate capacity when a Linux cgroup CPU quota is lower.
3. It measured neither event-loop jitter nor deterministic CPU-work variance.
4. It did not retain qualification details in the failed job log or an artifact.

Attempt 1’s art scene had p50 `13.648ms`, p95 `17.218ms` and max `22.419ms`. This shape is consistent with scheduling-tail interference, but the historical logs do not contain enough telemetry to claim a particular external process or throttle event. The defensible root cause is therefore: **the environment qualification was under-specified and non-auditable**, not that a known production algorithm regressed.

## Stage 9-C.1b correction

The new preflight runs before any product sample and records:

- normalized load using the minimum of logical CPUs, `availableParallelism`, and Linux cgroup quota;
- repeated event-loop scheduling-jitter samples;
- repeated deterministic CPU calibration samples, coefficient of variation, p95/median and max/median ratios;
- warm-up drift;
- Linux cgroup throttling deltas when available;
- every probe, rule, recomputed metric and qualification reason.

It also runs a fixed product-workload canary during each qualification probe: 20 warmups and 60 raw samples for each of the three D-C.1 scenes. The canary is not counted as the formal measurement; it is an early fail-closed signal for the exact workload whose p95 budget is being guarded. Its raw samples are retained and independently recomputed. A canary p95 at or above `16.7ms` rejects the environment before the formal 20-warmup/120-sample measurement begins.

If preflight is unfit, the test emits `ENVIRONMENT_UNFIT`, writes `measurementValid=false`, sets formal measurement runs to zero, and fails. If it is fit, exactly one 120-sample product measurement begins. A product p95 failure is final for that execution: there is no retry, best-of-N, outlier trimming or slow-sample deletion.

## Final-closure timeout diagnosis

The first independent same-SHA validation after the successful push-triggered
run exposed a separate process-boundary failure. Run A's clean clone completed
in about 29m53s. Run B completed the performance and node/browser jobs, but its
`verify:clean-clone` gate was still running when the previous 30-minute
`execFileSync` timeout fired. The runner then cleaned up the still-running
`browser:stage9-A` process, so the visible malformed-JSON and fixture `FAIL`
lines in the retained tail were expected test-fixture output, not the failure
cause.

The correction is limited to the clean-clone execution boundary: one bounded
60-minute gate window, an explicit 70-minute workflow-step bound, and runtime
diagnostics for `timeoutMs`, `elapsedMs`, and `timeoutTriggered`. There is no
retry, no best-of-N behavior, and no change to the 16.7ms product budget or
formal performance measurement.

The GitHub workflow also isolates the formal D-C.1 measurement in a fresh required job. The long functional regression consumes that job’s same-run performance artifact instead of measuring again or overwriting it with the legacy 8-sample smoke check.
