# 《钢铁指令》阶段 8.2E-A 交付说明

## 交付结论

正式战斗页面已接入参数化公路胜利演出旁路。默认 `auto` 会在正式 `activeBattle.report` 满足全部准入条件时使用 `contract_road_victory`，否则安全回退既有 `BattleRenderer`；业务求解、结算、奖励、HP、占领、返航和存档语义未改动。

## 正式边界

- 新增正式演出侧车：`js/battle-presentation/`。
- `js/main.js` 只负责路由接入、生命周期刷新、浏览器诊断接口和时间桥调用。
- `js/battle-renderer.js` 保留为兼容渲染器。
- 正式代码不读取 `experiments/`，不读取静态演出数据，不包含演出专用演员 ID。
- 契约准入严格要求：活动战斗/战报存在、`border_road`、结果为 `victory`、契约校验和支持诊断通过、计划校验通过、模板为 `road_assault_v1_infantry_defense`。
- 用户偏好仅保存在当前 session：`auto`、`legacy`、`contract`。实际渲染模式只有 `contract_road_victory` 和 `legacy`。

## 生命周期与时间

1. 派遣时不生成第二份战报；旁路只读正式 `activeBattle.report`。
2. 缓存键包含 battle ID、report ID、seed 和 result，同一场战斗只构建一次计划。
3. 画面时间由正式 `activeBattle.elapsed` 驱动，语义时间映射到 0～35 秒；暂停时不自行推进。
4. 结算后 `presentationPhase=returning`，契约画面锁定 35 秒并只做视觉返航偏移。
5. 返航结束或跳过返航后清理侧车缓存，回到基地视图。
6. 读档仍由原 `loadGame()` 完成；活动战斗恢复后，路由按同一准入链重新计算，不写入业务状态。

## 模式与失败回退

| 情况 | 实际模式 | 处理 |
| --- | --- | --- |
| 正式公路胜利战报且契约通过 | `contract_road_victory` | 使用契约计划、动态角色、维修接触、弹道和占领状态 |
| 用户偏好 `legacy` | `legacy` | 继续使用原 BattleRenderer |
| 撤退、失败、全灭、非公路或字段不完整 | `legacy` | 记录一次诊断并保持战斗页面可用 |
| 契约渲染器异常 | `legacy` | 记录一次 `render_error`，不阻断结算 |

## 测试与证据

- `tests/stage8-2E-A-test.mjs`：102 项通过。
- `experiments/battle-sandbox/tests/formal-contract-presentation-integration-test.mjs`：动态正式战报集成通过。
- `tests/outputs/stage8-2E-A-full-test-output.txt`：全量 `npm test` 输出。
- `screenshots/stage8-2E-A-screenshot-manifest.json`：9 张正式页面取帧、battle/report ID、模式、elapsed、result 与 SHA-256。
- 取帧覆盖：开始、接敌、维修、受损、占领、模式切换、返航、兼容撤退、返航后基地。
- 取证浏览器无 `pageerror` / `console.error`；动态活动统计：契约计划构建 1 次、重复渲染命中缓存、同一战斗保持单一 report ID。

## 性能与安全

- 计划构建只在 battle/report/seed/result 键变化时执行；每帧仅由已冻结契约和不可变计划生成当前视觉状态。
- 渲染状态不回写 report、dispatchSnapshot、activeBattle 或全局 state。
- 旧回归链保持通过，正式业务模块未被旁路改写。

## 封包自检

- 正式边界清单和哈希：`tests/stage8-2E-A-boundary.json`。
- 构建：`node tests/build-stage8-2E-A-delivery-package.mjs`。
- 自包含验证：`node tests/verify-stage8-2E-A-delivery-package.mjs iron-command-stage8-2E-A-formal-sidecar-integration.zip`。
- 交付包：`iron-command-stage8-2E-A-formal-sidecar-integration.zip`。
