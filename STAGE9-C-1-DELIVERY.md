# Stage 9-C.1 — Equipment Acquisition Strong Evidence & Settlement Isolation Closure

## 状态

本阶段是 Stage 9-C 的证据闭环 hotfix，不新增玩法、不实现装备掉落、不进入 Stage 9-D。

- 基线：`39bad8cbdb93935ef3c79d0ed7bc1df64e22a032`
- 最终 SHA：本文件随最终提交落地；以最终 `git rev-parse HEAD` 与远端 `git ls-remote` 为准。
- 当前判定：本地 Stage 9-C.1 专项门禁已通过；最终提交后的 clean-clone 与远端 CI 仍是发布收口条件。

## 修改范围

- `tests/stage9-C-equipment-acquisition-test.mjs`：分离离线生产与 Formal Battle settlement；新增真实 Formal Battle settlement 前后装备快照。
- `tests/browser/stage9-C-equipment-acquisition.mjs`：浏览器 frame 增加 machine-readable authoritative production session、dispatch snapshot 与 formal report 来源。
- `tests/generate-stage9-C-evidence.mjs`、`tests/generate-stage9-C-machine-evidence.mjs`：证据版本标记升级为 9-C.1。
- `tests/stage9-C-strong-evidence-test.mjs`：从当前 production source 独立重建 expected state，并逐字段验证离线生产、Formal settlement、running/reload/replay 连续性。
- `tests/stage9-C-evidence-tamper-test.mjs`：增加 17 个新 true-value mutation，其中 11 个为 coupled tamper。
- `tests/generate-stage9-C-developer-selfcheck.mjs`：纳入新证据、coupled tamper 与超过 121 例门槛。
- `tests/stage9-C-performance-test.mjs`：证据版本升级；strong verifier 严格要求三个场景各 `samples === 120 && p95Ms < 16.7`。
- `stage9_c_formal_settlement_isolation_check.json`：新增 Formal Battle settlement 真实 before/after 证据。

未修改 Authority Freeze 文件：`js/save-diff.js`、`tests/lib/`、`js/battle.js`、`js/theater.js`、`js/battle-presentation/universal/`、`.cnb.yml`。

## B1：Settlement isolation

离线生产与 Formal Battle settlement 现在是两个明确证据域：

1. `core.isolation.offlineProduction` 保存 `equipmentBefore`、第一次令牌结算后的 `equipmentAfterFirst`、重复令牌后的 `equipmentAfterSecond`、确定性实例 ID、离线报告产出和战斗 identity。verifier 重新运行 `settleOfflineProgress()`，要求第一次恰好增加一个 `equipment-production-anti_armor_sights-1`，第二次状态逐字段不变。
2. `core.formalSettlement` 保存真实 Formal Battle settlement 前后的完整装备状态、canonical equipment hash、战报数、ledger 数、battleSessionId、deploymentHash、formalReportHash 与 settlementId。verifier 重新运行真实 `dispatchFormation()` 与 `tickActiveBattle()`，独立比较 before/after；装备状态必须 deepEqual，而战报和 ledger 各恰好增加一次。

任何 declared boolean 都不是 acceptance authority；`deepEqual`、canonical hash、生产源重算和真实状态转移才是判定依据。

## B2：Expected-state continuity

verifier 从生产源重建浏览器编队的预期装备 binding，并对 mounted frame、running frame、running reload、replay frame、replay reload 分别比较，而不是只比较相邻帧。它同时重算：

- deployment snapshot hash 与 snapshot 内装备编成；
- Formal report hash 与当前 formal report；
- production battle session、deploymentSnapshotId、settlementId；
- replay 的 historical equipment、session/hash identity、report/ledger 不新增。

因此同时把两帧清空或同时替换为同一个错误值仍会被拒绝。

## Tamper 与浏览器证据

- 证据 frame：9；唯一截图 hash：9；真实 `Page.reload`：4。
- reload reason：`production_queue`、`completed_unmounted`、`running_battle`、`replay`。
- API provenance：`dispatchApiUsed=false`、`replayApiUsed=false`、`offlineApiUsed=false`、`equipmentApiUsed=false`。
- 页面/控制台错误：最终浏览器运行必须为 0。
- 实际 tamper：`141/141` 拒绝；coupled tamper `11/11` 拒绝，`passedFlagOnlyCases=0`。

## 性能

继续使用现有 `awaitFitEnvironment()` 守卫；不修改 16.7ms 预算。三个场景 `effectiveStats`、`snapshot`、`inventory` 都要求 warmup 20、samples 120、p95 小于 16.7ms，并保留 environment 与 loadBefore/loadAfter。

## 最终验收闭环

本地收口已完成：

- `npm run test:stage9-C`：exit 0，核心 `10/10`，性能三个场景均 `warmup=20 / samples=120 / p95<16.7ms`。
- `npm run browser:stage9-C`：exit 0，`9` 帧、`9` 个唯一截图 hash、`4` 次真实 reload、`141/141` tamper、`0` flag-only。
- `npm test`：exit 0；Stage 8.2G、Stage 9-A、Stage 9-B 与 Stage 9-C 回归通过。
- 性能环境：darwin / arm64 / Apple M5 / 10 cores / Node `v25.2.1`；Stage 9-C.1 采样保留 `loadBefore/loadAfter`。

最终提交后的命令仍需在该 SHA 的干净克隆中执行：

- `npm install --ignore-scripts --no-audit --no-fund`
- `npm run gate:stage8-2G`
- `npm run verify:clean-clone`
- FINAL_HEAD、工作树、远端分支 HEAD 与 GitHub Actions `head_sha/conclusion`。

Stage 9-C.1 只有在上述命令均为 exit 0、clean-clone `overallPassed=true` 且 GitHub Actions 同一 SHA 通过后，才标记为 `PASSED`。
