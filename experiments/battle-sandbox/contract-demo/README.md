# Stage 8.2D-B.2 参数化胜利演出沙盒

这是独立的 HTML5 Canvas 战斗演出实验，不接入正式 `main.js`、正式 Canvas、结算、经济、存档或奖励系统。页面只读取真实战报，经过 `buildPresentationContract(report)` 后生成确定性的 35 秒胜利演出计划。

入口：`/experiments/battle-sandbox/contract-demo/`

## 六个战报来源

| 查询参数 | sourceId | 战报 | seed |
| --- | --- | --- | ---: |
| 默认或 `?source=fixture` | fixture | `campaign-victory.json` | 1 |
| `?source=scenario-b` | scenario-b | 独立胜利战报 B | 2 |
| `?source=scenario-c` | scenario-c | 动态演员身份胜利战报 C | 3 |
| `?source=scenario-d` | scenario-d | 双普通步兵原始求解战报 D | 1 |
| `?source=scenario-e` | scenario-e | 三普通步兵含 reserve 原始求解战报 E | 1 |
| `?source=scenario-f` | scenario-f | 无维修车原始求解战报 F | 1 |

每个来源都经过同一套胜利模板、语义时间映射、角色表现策略和冻结弹道端点处理；没有按固定演员 ID 分支。D 的第二个普通步兵进入正式 `friendly_south_infantry_assault`，E 的第三个普通步兵进入计划自有的动态 `friendly_reserve_1`；F 不包含维修角色且无 repair 锚点。`scenario-c` 的友军 ID 使用 `unit_live-test-a-*`，敌军 ID 使用 `enemy_live-test-a-*`，并明确标记为 `transformed_identity_fuzz`，不计入原始正式报告。

## 浏览器验收接口

```js
window.seekContractDemoTime(35)
window.setContractDemoViewMode('final_status_focus')
window.render_contract_demo_to_text()
```

`seekContractDemoTime` 每次从新的权威初始状态开始，按确定性时间顺序应用当前战报的全部锚点。移动、粒子与 Canvas 绘制只负责表现，不参与 HP 结算。

## 参数化契约

- `semantic-time-mapper.js` 从 `sourceStart`、`firstContact`、首次/中段/末个敌军摧毁、友方重大损失和 `resultTime` 构造 0～35 秒映射；末个敌军摧毁映射不晚于 32.5 秒。
- `role-presentation-policy.js` 仅依据 `alive`、角色和 HP 比例生成最终状态：侦察车 `scanning`，步兵类 `holding_objective`，装甲车依据损伤进入 `overwatch`/`damaged_*`，维修车进入 `support_holding`/`damaged_support_holding`。
- `launch-pose-resolver.js` 在 FIRE/DAMAGE 配对时冻结 `launchPosition`、`impactPosition`、`sourcePosition` 与 `targetPosition`；后续移动不会改变已经发射的短弹道。
- `repair-choreography.js` 按实际维修锚点动态生成维修组，可处理任意数量、演员和目标，也可为空。
- `dynamic-route-registry.js` 将固定槽位和动态 reserve 路线注册到每个 plan；未知槽位返回 `unknown_template_slot` 并使计划校验失败，不再静默落到 `(640,400)`。
- `slot-layout-validator.js` 检查演员/槽位一一对应、路线、关键时刻空间分离、建筑/目标最终位置和 reserve 路线独立性。

## 取证与测试

`screenshots/capture-manifest.json` 记录每张图的 source/report、请求与实际时间、viewMode、活动弹道数、应用锚点和 SHA-256。主来源包含 15 张取帧；其中 11 号图在约 7.81 秒保留活动短弹道，10/15 号均为 35 秒但使用不同视图模式；B/C 各有 3 张取证图。

```bash
node experiments/battle-sandbox/tests/contract-victory-template-parameterization-test.mjs
node experiments/battle-sandbox/tests/contract-victory-layout-generalization-test.mjs
node experiments/battle-sandbox/tests/contract-driven-victory-demo-test.mjs
node experiments/battle-sandbox/tests/contract-demo-visual-integrity-test.mjs
```

场景生成器为只读调用正式求解器并写入本目录的 B/C/D/E/F 示例；D/E/F 保存 `sourceKind: formal_solver_raw` 与 `rebuildHash`，C 单独标记为身份重映射压力样本：

```bash
node experiments/battle-sandbox/contract-demo/demo-scenario-generator.mjs
```

正式工程边界保持原有 SHA-256：`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`。
