# Iron Command Stage 8.2G-E-A.1 Final Report

本报告以 8.2G-E-A.1 开发提示词为需求主体；未发现并未导入上一轮 independent-audit JSON。失败样本没有删除或过滤，所有结论均来自当前代码重算、真实 UI 浏览器运行和 clean package verifier。

1. 阶段：8.2G-E-A.1 Replay Persistence, Real UI Path & Save-Diff Closure。
2. 工作分支：`agent/stage8-2G-E-A-1-replay-persistence-closure`。
3. 实现基线：E-A commit `58cb6c97fd2000fd6c7c7bb11a8e54e053c0ebac`。
4. 最终 HEAD：`11b057de46b22991655cd4ba0c34a5cd0c53aa65`（提交后重建最终 ZIP）。
5. PR：本分支以 E-A production-loop branch 为基线，等待推送后创建/更新 Draft PR。
6. 直接修改文件：`js/theater.js`、`js/ui.js`、`index.html`、`js/save-diff.js`、`package.json`、`.github/workflows/core-regression.yml`。
7. 新增模型测试：`tests/stage8-2G-E-A-1-replay-reload-test.mjs`，5/5 通过。
8. 新增浏览器证据：`tests/browser/stage8-2G-E-A-1-replay-persistence.mjs`。
9. 新增强校验：`tests/lib/stage8-2G-EA1-strong-integration-verifier.mjs`。
10. 新增封包脚本：`tests/build-stage8-2G-E-A-1-delivery-package.mjs` 与 `tests/verify-stage8-2G-E-A-1-delivery-package.mjs`。
11. Formal Solver：未修改。
12. Universal Planner：未修改。
13. Engagement Choreographer：未修改。
14. target assignment：未修改。
15. shot schedule/timing/facing：未修改。
16. Formal Repair Authority：未修改。
17. settlement calculation：未修改；仅增加观察和门禁重算。
18. Replay 架构：回放建立独立 `replayReadOnly` active context，不再复用 canonical production session 对象。
19. Replay canonical source：`state.battleSessions[sourceBattleSessionId]`。
20. Replay source session binding：保留 `replayContext.sourceBattleSessionId`。
21. Formal report binding：回放只消费 `state.battles` 中与 session 绑定的正式报告。
22. Formal report hash：同时校验 session/report 的正式 hash。
23. Settlement ledger binding：只读回放保留 settlement id/hash，但不写 ledger。
24. `activeBattleSessionId`：生产战斗使用 canonical id；Replay 强制为 `null`。
25. Replay settlement permission：`settlementAllowed=false`，Settlement API fail-closed。
26. Replay presentation time：只写 `replayContext.presentationTime`，不污染 canonical session。
27. Canonical hash before replay：由独立 verifier 重算并记录在 `stage8_2g_ea1_replay_persistence_check.json`。
28. Canonical hash during replay：推进半程后保持不变。
29. Canonical hash after replay reload：真实 reload 后保持不变。
30. Canonical hash after replay finish：回放结束并返回基地后保持不变。
31. Formation at production reload：`fighting`，按正式生产状态恢复。
32. Formation during replay：`idle`，不会再次进入 fighting/deployed。
33. Formation after replay reload：仍为 `idle`。
34. Participating unit at production reload：保持 `deployed` 状态。
35. Participating unit during/after replay reload：保持已结算后的 `assigned`/实际状态。
36. Replay `productionSession`：不存在，避免 replay 写穿 canonical session。
37. Stored formal report：不重新 simulate，不生成第二份 report。
38. Result reload：ledger 与 report 各保持 exactly once。
39. UI launch path：建造、生产、编队、选战区、选策略、派遣均由正式 DOM 点击完成。
40. UI selectors：使用 `data-action=build/produce/create-formation/add-unit/select-theater/select-strategy/launch-battle`。
41. Dispatch API shortcut：浏览器核心路径未使用，`dispatchApiUsed=false`。
42. Replay API shortcut：浏览器核心路径未使用，`replayApiUsed=false`。
43. Launch duplicate guard：真实同一 DOM 按钮 double-click，session delta 为 1。
44. Result UI path：结算后通过“查看完整战报”和真实返航按钮进入报告/基地。
45. Save UI path：使用顶部 `#btn-save` 正式保存按钮。
46. Real reload method：使用 CDP `Page.reload`，不是 debug `load()`。
47. Running reload loader evidence：记录 `Page.frameNavigated.loaderId`。
48. Running reload time evidence：记录 reload 前后 `performance.timeOrigin` 改变。
49. Replay reload evidence：第二次真实 `Page.reload` 同样记录 loader/timeOrigin。
50. Browser frame count：11/11，全部唯一 PNG。
51. Browser semantic coverage：基地、生产入口、运行中、运行中 reload、正式结果、结算后基地、Replay、Replay reload 前后、Replay 结束基地、save-diff summary。
52. Browser errors：pageErrors=0，consoleErrors=0。
53. Action provenance：36 个记录均为 `source=production_ui` 且 `syntheticApiCall=false`。
54. Recursive save diff：对象、数组、标识数组、数组顺序和 primitive 均递归比较。
55. Explicit ignored paths：仅允许显式 `savedAt` 忽略，未用隐式全局过滤。
56. Save diff changed paths：当前 clean evidence 重算为 51 条。
57. Save diff unexpected paths：0。
58. Save diff allowed paths：由 formal settlement plan 动态生成，不硬编码 passed。
59. Formal plan match：奖励、单位、编队、战区、统计和 report exactly-once 均重算。
60. Unrelated building preservation：篡改会被 verifier 拒绝。
61. Unrelated unit preservation：篡改会被 verifier 拒绝。
62. Unrelated research preservation：篡改会被 verifier 拒绝。
63. Unrelated theater preservation：篡改会被 verifier 拒绝。
64. Duplicate settlement：第二次正式 settlement 被阻断且 ledger/resources 不变。
65. Replay settlement：Replay 中 settlement 被 `SETTLEMENT_BLOCKED` 阻断。
66. Tamper matrix：独立模型 24/24，含 browser/UI 伪造后总拒绝 31/31。
67. Tamper categories：canonical lifecycle、presentation time、formation、unit、ledger、reload、building、research、theater、fake save-diff passed/allowed-path、fake UI provenance、fake PNG。
68. Strong verdict/selfcheck：independent strong verifier passed，developer selfcheck passed，ready flag 为 true。
69. Regression/CI：原 E-A 13/13、E-A.1 focused 5/5、D-C.1 gate、clean browser/strong/tamper、clean ordinary `npm test` 均通过；package script 与 workflow 已在 E-A 后追加 E-A.1 focused/browser。
70. Delivery/next stage：ZIP 为 `iron-command-stage8-2G-E-A-1-replay-persistence-closure.zip`，SHA/bytes/entries 见外部 final package record；clean package gate passed。E-A.1 可关闭，未进入 E-B；独立审计仍需使用最终 ZIP 复验。
