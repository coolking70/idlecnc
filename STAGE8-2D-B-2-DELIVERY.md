# 《钢铁指令》阶段 8.2D-B.2 交付说明

## 交付结论

已完成独立 contract-demo 的胜利模板参数化。页面默认加载正式 campaign victory Fixture，并可通过查询参数切换到两份不同 seed、不同 report ID/事件统计的合法胜利战报；三份战报均由同一套确定性模板驱动，未修改正式 `js/`、根目录 `css/`、正式测试、正式报告/HP/奖励/存档逻辑。

交付包：`iron-command-stage8-2D-B-2-parameterized-victory-template.zip`

## 三份真实胜利战报

| 来源 | reportId | seed | 演员 | events | required anchors | damage | repair | destroy | 友方最终 HP | capture |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| fixture | `battle_1_fixture-f_border_road_breakthrough` | 1 | 12 | 120 | 71 | 41 | 5 | 7 | `100/90/90/0/123/32` | true |
| scenario-b | `battle_2_formation-scenario-b_border_road_breakthrough` | 2 | 12 | 104 | 61 | 36 | 3 | 7 | `100/90/90/160/0/59` | true |
| scenario-c | `battle_3_formation-live-a_border_road_breakthrough` | 3 | 12 | 121 | 72 | 41 | 6 | 7 | `100/90/90/0/92/39` | true |

HP 顺序为：步兵、反装甲步兵、侦察车、领头坦克、支援坦克、维修车。C 场景使用 `unit_live-test-a-*` 与 `enemy_live-test-a-*`，演员身份不依赖 A 场景固定 ID。

## 实现与演出契约

- 语义时间节点由真实战报锚点推导，结果固定映射到 35 秒，末个敌军摧毁在展示时间 32.5 秒前完成。
- 角色最终状态由 `alive`、role 与 HP ratio 决定，所有临时状态在 35 秒收束；胜利时不存在存活敌军。
- 维修组从实际 repair 锚点动态分组，支持不同数量、演员、目标及无维修组。
- FIRE/DAMAGE 使用取帧时冻结的发射点和命中点，短弹道不会随当前演员位置漂移。
- 页面支持 `?source=fixture`、`?source=scenario-b`、`?source=scenario-c`，不使用 localStorage。

## 浏览器取证

- 主来源 15 张 PNG 的 SHA-256 全部唯一。
- `11-short-projectile-8s.png` 实际时间为 `7.810251`，`activeProjectileCount=1`，画面中可见短弹道。
- 10 号与 15 号都为 35 秒，分别为 `overview` 与 `final_status_focus`，PNG SHA 不同；15 号包含最终状态摘要且无 debug 演员标签。
- scenario-b 与 scenario-c 各有 `contact`、`major-loss`、`victory` 三张 PNG。
- `capture-manifest.json` 保存每行的 `file/sourceId/reportId/requestedTime/actualTime/viewMode/activeProjectileCount/appliedRequiredAnchors/pngSha256`，浏览器错误为 0。

## 自动化结果

| 检查 | 结果 |
| --- | ---: |
| `contract-victory-template-parameterization-test.mjs` | 186/186 |
| `contract-driven-victory-demo-test.mjs` | 85/85 |
| `contract-demo-visual-integrity-test.mjs` | 135/135 |
| 五组既有沙盒回归 | 28 + 30 + 40 + 63 + 53 |

正式工程边界哈希保持不变：`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`。

## 允许范围与后续边界

本阶段新增/修改集中于 `experiments/battle-sandbox/contract-demo/`、`experiments/battle-sandbox/tests/`、本实验 README、`progress.md` 与本交付说明。为保证脱离工作区仍可运行测试，ZIP 另外携带未修改的 report-adapter、正式边界哈希所需的只读模块、`package.json` 与测试入口；这些只是验证依赖，不是本阶段的正式接入改动。ZIP 不包含旧 ZIP、临时输出或 node_modules。下一步如需正式接入，应另开阶段定义正式 renderer、结算和存档边界；本包不执行该接入。
