# 《钢铁指令》阶段 8.2D-B.2.1 交付说明

## 交付结论

本轮完成完整项目封包、通用战术槽位、多阵容参数化和自包含验收。演出仍是独立 `contract-demo` 实验，没有接入正式战斗页面、正式 HP、奖励、存档或结算逻辑。

交付包：`iron-command-stage8-2D-B-2-1-complete.zip`

最终构建 SHA-256：由构建器在最后一次封包输出并在交付前复核。

该 ZIP 从完整工作区根目录构建，包含根 `index.html`、`package.json`、`css/`、`js/`、`scripts/`、`tests/`、完整旧沙盒、report-adapter 和契约演出。解压后可直接运行 `npm test`、`npm start` 及全部沙盒/适配器/契约测试。

## 阵容与原始报告

| 来源 | 类型 | reportId | seed | 友军阵容 | events | required | repair | 友军最终 HP |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| scenario-d | `formal_solver_raw` | `battle_1_formation-scenario-d_border_road_breakthrough` | 1 | 2 infantry + AT + scout + 2 MBT + repair | 116 | 67 | 4 | `100/100/90/90/149/0/31` |
| scenario-e | `formal_solver_raw` | `battle_1_formation-scenario-e_border_road_breakthrough` | 1 | 3 infantry + AT + scout + 2 MBT + repair | 113 | 64 | 3 | `100/100/100/90/90/160/0/36` |
| scenario-f | `formal_solver_raw` | `battle_1_formation-scenario-f_border_road_breakthrough` | 1 | 2 infantry + AT + scout + 2 MBT，无 repair | 111 | 62 | 0 | `100/100/7/90/0/137` |

三份报告均直接来自 `simulateBattle()`，保存完整 `scenario`、`report` 和 `rebuildHash`。自动测试会重新构造输入、再次调用求解器，并对完整报告进行 `stableStringify` 与 SHA 校验。

既有 scenario-c 保留为身份压力样本，标记为 `transformed_identity_fuzz`，含 `derivedFromReportId` 与 `transformation: stable_actor_id_remap`，不计入原始正式报告数量。

## 通用路线与槽位

- 新增 `friendly_south_infantry_assault`，普通步兵与 `friendly_south_at_assault` 使用不同路线和最终战位。
- 每个计划包含独立 `routeRegistry`，记录 `slotId/side/category/points/finalPosition/source`；不存在共享可变路线表。
- E 场景第三个普通步兵使用动态 `friendly_reserve_1`，路线不在 `(640,400)`，也不与南北步兵路线重复。
- 未注册槽位返回 `unknown_template_slot`，计划校验失败，不再静默回退中心点。
- `slot-layout-validator.js` 检查演员/槽位/路线一一对应、有限坐标、关键时刻 0/7/13/21/26/32/35 的中心碰撞、建筑/目标最终位置和 reserve 路线。
- F 场景没有维修角色、repair 锚点为 0、repairGroups 为空，维修表现始终 `stowed`。

## 浏览器取证

已用官方 Playwright 客户端检查 scenario-e 页面，并用真实浏览器生成 D/E/F 三组截图：

```text
scenario-d/01-three-infantry-lanes.png
scenario-d/02-contact.png
scenario-d/03-victory.png
scenario-e/01-reserve-deployment.png
scenario-e/02-reserve-in-combat.png
scenario-e/03-victory.png
scenario-f/01-no-repair-roster.png
scenario-f/02-no-repair-battle.png
scenario-f/03-victory.png
```

Manifest 保存每张图的实际时间、source/report、viewMode、活动弹道、required 锚点和 SHA-256；D/E/F 新增截图均唯一，浏览器错误为 0。E 的部署图可见 reserve 在左侧推进线，F 的三张图无维修机械臂或焊接效果。

## 测试结果

| 检查 | 结果 |
| --- | ---: |
| 正式 `npm test` | 627/627 |
| 五组固定沙盒 | 28 + 30 + 40 + 63 + 53 |
| report-adapter | 76/76 |
| adapter integrity | 85/85 |
| 契约演示 B | 85/85 |
| B.1 visual integrity | 135/135 |
| B.2 parameterization | 186/186 |
| B.2.1 layout generalization | 38/38 |
| 合并基线及本轮新增 | 1446 passed |

构建脚本：`experiments/battle-sandbox/report-adapter/build-b2-1-delivery-package.mjs`

自包含验证器：

```bash
node experiments/battle-sandbox/report-adapter/verify-b2-1-delivery-package.mjs \
  iron-command-stage8-2D-B-2-1-complete.zip
```

验证器会自行解压、执行完整测试、启动并检查 `npm start`、检查根页/沙盒页/scenario-e、校验截图 Manifest 和正式边界哈希，不依赖外部已运行端口。

正式边界哈希保持：

`2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`

## 未解决问题与下一阶段建议

本轮没有遗留会阻断交付的问题。路线空间检查将建议距离作为诊断依据、把实际中心碰撞作为失败条件，以兼容既有固定敌军掩体路线的交错演出。下一阶段如需继续，只能另开正式旁路接入设计；本阶段不接入正式战斗页面。
