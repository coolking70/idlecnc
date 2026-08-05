# 《钢铁指令》阶段 8.2E-A.1 交付说明

## 结论

已完成正式旁路加固、正式HUD、缓存身份、持久回退、返航编舞和 Chromium/CDP 取证。本轮没有新增战斗模板、单位、战区或美术系统；正式战斗求解、HP、结果、结算、奖励、占领、经验、返航业务时长、SAVE_VERSION=7 和存档结构保持不变。

## 运行时修复

- `formal-hud-policy.js` 将正式Canvas HUD改为“边境公路 / 正面突破 / 战术阶段 / 战报进度 / 演出：RTS”，默认不输出实验标题、report ID、seed 或 authority 诊断。
- `report-fingerprint.js` 对战报元数据、初末演员快照和全部事件做稳定摘要；缓存键现在包含 `battleId / report.id / seed / result / reportFingerprint`。
- 读档成功、新游戏、`battle:closed` 和活动战斗对象/指纹变化均显式清理或重建旁路缓存。
- `createContractRenderState()` 不再捕获 `activeBattle`；每帧显式传入当前阶段和返航计时。
- `runtime-fallback-registry.js` 对 `render_error` 等运行时错误按当前战斗做会话级永久回退，后续帧不再重复尝试。
- `return-choreography.js` 同步移动幸存友军车辆、步兵中心和全部步兵成员；敌军、摧毁演员和残骸不移动。
- UI chip、模式按钮和 `renderedMode` 使用同一帧状态快照；失败回退完成旧渲染后才发布状态。

## 浏览器取证

`tests/browser/formal-battle-evidence.mjs` 使用项目自包含的本地HTTP服务器、临时无头 Chrome 和 Chrome DevTools Protocol：

- 通过正式建造、科研、生产、编队和 `dispatchFormation()` 生成活动战斗；不把 Fixture report 写入正式 `activeBattle`。
- 自动读取正式计划中的 REPAIR 锚点，使用 `repairAnchor.presentationTime + 0.10` 反算业务时间，并检查55～82px距离、working机械臂、接触点和焊接火花。
- 每次同步采集PNG、`render_game_to_text()`、正式诊断、DOM模式状态、Canvas签名和错误列表。
- 自动生成 `screenshots/stage8-2E-A1-*` 共11张PNG及 `stage8-2E-A1-screenshot-manifest.json`。

## 测试与自检

- `npm test`：阶段3～8.2E-A旧回归 + 阶段8.2E-A.1加固测试。
- `node tests/stage8-2E-A-1-test.mjs`：正式HUD、指纹、缓存重建、生命周期、持久回退、返航编舞和Manifest检查。
- `npm run browser:evidence`：重新生成11张正式取证截图。
- `node tests/build-stage8-2E-A-1-delivery-package.mjs`：生成最终ZIP并调用自包含验证器。
- `node tests/verify-stage8-2E-A-1-delivery-package.mjs iron-command-stage8-2E-A-1-formal-sidecar-hardening.zip`：解压后重新执行npm、沙盒回归、Chromium取证、11张PNG SHA、Canvas/模式一致性和进程清理检查。

## 最终包

交付文件：`iron-command-stage8-2E-A-1-formal-sidecar-hardening.zip`。

正式边界聚合哈希记录在 `tests/stage8-2E-A-1-boundary.json`；浏览器证据记录在 `screenshots/stage8-2E-A1-screenshot-manifest.json`。

## 尚未解决的问题

本轮没有已知未解决问题。下一阶段仍未开始：公路撤退/失败模板和原创Sprite资源升级均不属于本轮范围。
