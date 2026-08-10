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

- 收口源码提交（含 `package.json` posttest 修复、`progress.md`、`STAGE8-2G-E-C-DELIVERY.md` 与再生成证据）：`38ef77d` → `41d1694`；record 元数据提交：`3a8828f`。`finalHead` 指向 ZIP 内容对应的源码提交 `41d1694`（record 文件不进 ZIP，故 record 元数据提交不影响 ZIP 内容）。
- 本地完整 `npm test` 真实输出已作为本 Issue 附件上传（`npm-test-full.log`），exit=0 且含 `Stage 8.2G-E-B result` / `Stage 8.2G-E-C result`；干净目录全量验证日志也已上传（`ec-verify.log`），全部子项 `passed`。
- GitHub Actions `core-regression` 为权威门禁：上一交付链所依据的 CI run 为 `31331527716`（commit `1f66a85`），其中 D-C / D-C.1 / E-A / E-A.1 / browser:E-A.1 / E-B / browser:E-B / E-C / browser:E-C 九个 step 全部 success。
- 本仓库以 CNB 为工作镜像，未配置等价流水线；本收口提交的绿色依据为上述本地完整 `npm test` + 干净目录全量验证（不带 `--skip-full`）的真实输出。

## E-C.1 收口说明

- README、progress 与本交付说明已统一指向 E-C，不再把 C.1.1a 作为当前阶段。
- 开发方独立复核已重新检查 E-C focused、E-B browser regression、E-C browser、strong verifier、true-value tamper、普通 `npm test` 与清洁目录验证。
- 本次收口不导入或修改任何 independent-audit JSON，也不删除或过滤历史失败样本。
- 外部独立审计仍须由独立验收方使用最终 ZIP 执行；本文件中的开发方复核结论不等同于外部批准。
