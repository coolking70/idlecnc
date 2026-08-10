# Stage 8.2G-E-C 交付说明

本阶段收口离线 / Idle Progression 与长线循环：离线窗口 fail-closed、原始秒数与上限真实可见、Exactly-once、MAX_STEPS 截断续接、待阅报告 reload 保留，以及活动战斗和只读 Replay 的离线隔离。

## 权威边界

- Formal Solver、Universal Planner、Engagement Choreographer、Formal Report、战斗/奖励/结算计算、D-C 表现层与 HUD 保持只读。
- `js/offline.js` 负责离线窗口和逐步结算元数据；`js/save.js` 只负责 save/load 边界、报告迁移与部分 MAX_STEPS 窗口续接。
- 离线进行中的正式战斗不会推进 session、elapsed、战报或 ledger；只读 Replay 不写入 canonical session。
- 证据 JSON 是验证输出，不是生产运行资源；未导入任何 independent-audit JSON，也未删除或过滤失败样本。

## 真实浏览器证据

- 生产入口真实 DOM click，覆盖 E-B 的派遣/战报/回放动作，以及离线报告查看和关闭。
- 17 张唯一 PNG、0 page/console errors，5 次真实 `Page.reload`。
- reload 证据由 verifier 独立重算 `before.timeOrigin` / `after.timeOrigin`、loaderId 变化和 `Page.reload` 方法；离线时间通过 savedAt/localStorage 路径注入，不调用 settle API。
- 覆盖待阅报告 reload 保留、关闭后 reload 清除、运行中战斗暂停隔离、Replay 只读隔离。

## 门禁

```bash
npm run test:stage8-2G-E-C
npm run browser:stage8-2G-E-C
npm test
npm run build:stage8-2G-E-C
npm run verify:stage8-2G-E-C
```

性能门禁为 warmup 20、samples 120、每场景 p95 `< 16.7ms`。E-C true-value tamper 为 80/80 拒绝，`passedFlagOnlyCases=0`，并包含 fake same-timeOrigin、flag mismatch、same-loader 三类真实 reload 篡改。

最终 ZIP 的 SHA-256、字节数、entries、final HEAD、CI 与干净目录全量结果以 `stage8_2g_ec_final_package_record.json` 为准。该记录必须在最终源码提交后重新生成；不得沿用提交前封包的旧哈希。

## 收口修复：npm test 纳入 E-B / E-C

Stage 8.2G-E-C 通过外部独立验收后，发现 `package.json` 的 `posttest` 链停在 E-A.1，E-B 与 E-C 的 focused 测试只作为 CI 独立 step 执行，未纳入 `npm test`，导致干净包验证里的 `ordinaryNpmTest: passed` 实际未覆盖 E-B / E-C。

本次修复只加不减：

```json
"posttest": "npm run test:stage8-2G-D-C && npm run test:stage8-2G-D-C-1 && npm run test:stage8-2G-E-A && npm run test:stage8-2G-E-A-1 && npm run test:stage8-2G-E-B && npm run test:stage8-2G-E-C"
```

- 原有 D-C / D-C.1 / E-A / E-A.1 全部保留；CI workflow（`core-regression.yml`）的既有 step 保持原样，与 posttest 互相独立，未删除或放宽任何 step。
- 本地完整 `npm test` exit=0，日志含 `Stage 8.2G-E-B result: 12 passed / 0 failed / 12 total` 与 `Stage 8.2G-E-C result: 12 passed / 0 failed / 12 total`。
- 最终交付包已重建，并在干净目录执行无 `--skip-full` 全量验证：install / focusedEC / regressionEBBrowser / cleanPackageBrowserRerun / strongEvidence / tamper / ordinaryNpmTest 全部 `passed`；`ordinaryNpmTest` 现真实覆盖 E-B / E-C（ZIP 内 package.json 的 posttest 同样包含 E-B/E-C）。
- 新 ZIP 的 SHA-256、bytes、非目录 entries 已更新到 `stage8_2g_ec_final_package_record.json` 与 `stage8_2g_ec_clean_package_test.json`；`cleanPackageGate = passed`。
- 未改动 `js/` 下任何运行时源码，未删除/放宽任何测试断言、verifier 判定逻辑或 tamper 用例；Authority Freeze 约束不变。

最终 ZIP 与收口提交的 SHA-256、bytes、entries、final HEAD、CI 以 `stage8_2g_ec_final_package_record.json` 为准。

## CI 依据与提交绑定

- 收口源码提交（含 `package.json` posttest 修复、`progress.md`、`STAGE8-2G-E-C-DELIVERY.md` 与再生成证据）：`38ef77d` → `41d1694`；DELIVERY.md CI 依据补充提交：`853df89`；record 元数据提交：`3a8828f`。`finalHead` 指向 ZIP 内容对应的源码提交 `853df89`（record 文件不进 ZIP，故 record 元数据提交不影响 ZIP 内容）。
- 本地完整 `npm test` 真实输出已作为本 Issue 附件上传（`npm-test-full.log`），exit=0 且含 `Stage 8.2G-E-B result` / `Stage 8.2G-E-C result`；干净目录全量验证日志也已上传（`ec-verify.log`），全部子项 `passed`。
- GitHub Actions `core-regression` 为权威门禁：上一交付链所依据的 CI run 为 `31331527716`（commit `1f66a85`），其中 D-C / D-C.1 / E-A / E-A.1 / browser:E-A.1 / E-B / browser:E-B / E-C / browser:E-C 九个 step 全部 success。
- 本仓库以 CNB 为工作镜像，未配置等价流水线；本收口提交的绿色依据为上述本地完整 `npm test` + 干净目录全量验证（不带 `--skip-full`）的真实输出。

## 验收基线切换：干净克隆 + 全门禁实跑（取代 ZIP 与 GitHub CI 依赖）

项目所有者已决定：后续开发与验收**不再依赖 ZIP 交付包**，也不要求 cnb 仓库满足任何依赖 GitHub 的开发/测试条件。本次变更把两条基线落到仓库并清理旧基线残留的误导性证据。

### 变更内容

1. **E-C 两个 ZIP record 标记废弃**：`stage8_2g_ec_final_package_record.json` 与 `stage8_2g_ec_clean_package_test.json` 加入 `"deprecated": true` 与 `"supersededBy": "clean-clone verification"`，并移除 `packageSha256`（final record 中的 `finalHead` 已删除）。不再作为验收依据。
2. **不再记录任何"指向本次提交自身"的 `finalHead` 字段**：验收方在审计时直接用 `git rev-parse HEAD` 读取真实提交，自指循环被永久消除。
3. **历史阶段（A/B/C/D 系列）的既有 record 与证据文件原样不动**。
4. **新增干净克隆可复现性验证** `tests/verify-clean-clone.mjs`：从 `git clone --depth 1 file://<repo>` 克隆当前 HEAD（非复制工作目录），`npm install --ignore-scripts`，跑完整门禁链，输出 JSON，结束后清理临时目录。脚本：`"verify:clean-clone": "node tests/verify-clean-clone.mjs"`。
5. **新增单一入口门禁** `"gate:stage8-2G": "npm test && npm run browser:stage8-2G-E-A-1 && npm run browser:stage8-2G-E-B && npm run browser:stage8-2G-E-C"`，串起当前有效完整门禁，只加不减。
6. **性能证据标注环境**：C-1 与 D-A.1 性能生成器输出新增 `environment` 字段（platform/arch/cpuModel/cpuCount/nodeVersion），便于识别机器/负载差异，未调整任何性能阈值（16.7ms 红线不变）。
7. **新增 cnb 原生流水线** `.cnb.yml` + `.cnb/Dockerfile`（Node + Chromium），执行 `npm run gate:stage8-2G`，为仓库提供独立于 GitHub 的自动验证。

### 新增验收基线（完成后生效）

```
1. git rev-parse HEAD              读取真实最终提交
2. git status --porcelain          确认工作区干净
3. npm run gate:stage8-2G          全门禁实跑
4. npm run verify:clean-clone      干净克隆可复现性
5. 验收方自行编写独立探测与 true-value tamper 复核
```

`.github/workflows/core-regression.yml` 保留在仓库中不删，仅不再作为 cnb 侧验收的必要条件。57 个 build/verify 脚本与 32 个 `build:` / 29 个 `verify:` 脚本全部保留，只是不再作为验收必经步骤。

## E-C.1 收口说明

- README、progress 与本交付说明已统一指向 E-C，不再把 C.1.1a 作为当前阶段。
- 开发方独立复核已重新检查 E-C focused、E-B browser regression、E-C browser、strong verifier、true-value tamper、普通 `npm test` 与清洁目录验证。
- 本次收口不导入或修改任何 independent-audit JSON，也不删除或过滤历史失败样本。
- 外部独立审计仍须由独立验收方使用最终 ZIP 执行；本文件中的开发方复核结论不等同于外部批准。

## 干净克隆可复现性修复（阻断项收口）

**验收方在 HEAD `59e5388` 实跑 `npm run verify:clean-clone` 时退出码 1**：`gate:stage8-2G` 步骤 failed，报错
`ENOENT: no such file or directory, open '<clone>/experiments/battle-sandbox/universal-planner/screenshots/manifest.json'`。

### 根因

`.gitignore` 顶层 `screenshots/` 规则把 `experiments/battle-sandbox/universal-planner/screenshots/` 整目录忽略
（git 跟踪 = 0，本地实际 = 37 文件）。而 `experiments/battle-sandbox/tests/universal-presentation-delivery-test.mjs`
在模块顶层（第 8 行）无条件 `readFileSync` 该 manifest，且该测试在 `npm test` 链内。
因此任何干净克隆 `npm test → gate:stage8-2G → verify:clean-clone` 必然失败。
顶层 `screenshots/`（117 个被跟踪文件）与嵌套 `universal-planner/screenshots/`（0 个被跟踪）的不一致长期掩盖了问题。

### 修复方式（方案 A：把交付契约纳入版本控制）

- 判定：该 manifest 是浏览器捕获产出的**交付契约**（含 `pngSha256`、`actualTime`、`planFingerprint`、
  `currentPositionsHash` 等需审查的固定内容），由 `capture-universal-planner-evidence.mjs` 运行时捕获生成，
  无法从源码确定性重建，故不采用方案 B。
- 操作：用 `git add -f experiments/battle-sandbox/universal-planner/screenshots/manifest.json`
  将测试真正依赖的最小输入（1 个 JSON，约 16KB）纳入版本控制；12 个截图 PNG 仍 ignored 不入库。
  未对测试文件做任何删除/skip/try-catch 包裹/摘链/放宽断言。

### 同类风险排查（干净克隆可用性）

`dist` / `output` / `artifacts` / `tests/evidence` / `tests/outputs` 五个目录逐一确认：
仅 `build/verify-*-delivery-package.mjs`（**不在** `gate:stage8-2G` 链内）会读取其中内容。
`gate:stage8-2G` 链条读取的未跟踪路径只有 `screenshots/manifest.json` 一处（已修复）；
其余 `stage8_2g_*.json` 均由链内前置步骤生成后才被读取，干净克隆可自给自足，无新增风险。

### 修复后实跑

- `npm run gate:stage8-2G`：exit=0，全门禁绿（含此前 CPU 争用下偶发的 D-C.1 性能项，本轮干净实跑 p95 全部 <16.7ms）。
- `npm run verify:clean-clone`：exit=0，`overallPassed: true`，steps 全部 `passed`，`clonedHead == currentHead`。
- 真实输出全文见本 Issue 评论。

### 硬性约束核对

- 未改动 `js/` 与 `tests/lib/` 下任何文件（`git diff --name-only` 仅含 manifest.json / progress.md / DELIVERY.md）。
- 未删除/跳过/放宽 `universal-presentation-delivery-test.mjs` 任何断言。
- 未删除 `.github/workflows/core-regression.yml` 任何 step；历史阶段（A/B/C/D）证据与 record 原样不动。
- 未放宽任何性能阈值（16.7ms 红线不变）；未重新引入自指 `finalHead`。
