# 《钢铁指令》阶段 8.2D-A 交付说明

## 交付范围

本阶段交付独立的 RTS 战报适配实验：把正式 `js/battle.js` 的真实 `simulateBattle()` 报告转换为稳定的 normalized battle、战术角色绑定、权威事件锚点和 35 秒 presentation contract。适配器只位于 `experiments/battle-sandbox/report-adapter/`，测试只位于 `experiments/battle-sandbox/tests/`；未接入正式战斗 renderer、存档、结算、经济或 Canvas 状态，也未扩展 35 秒演出模板。

主要新增文件：

- `report-normalizer.js`：正式/旧别名字段归一化；`actor/actorId`、`target/targetId`、`value/amount` 冲突直接拒绝。
- `report-validator.js`：演员初末生命、事件时间/引用、撤退事件、结果和权威覆盖校验。
- `tactical-role-binder.js`：确定性角色绑定；角色槽缺失时返回诊断，不伪造 actor。
- `authority-anchor-builder.js`：一事件一来源锚点，保留 source event、actor、target、value。
- `presentation-contract.js`：冻结 normalized battle、role binding、authority anchors 和 35 秒时间窗；`templateId=null`。
- `fixture-scenarios.js`、`fixture-generator.mjs`、`fixtures/*.json`：从正式 solver 生成真实 fixture，并以正式 `compareBattleReports()` 重算确认确定性。
- `fixture-viewer.html/js/css`：只读查看器。
- `sandbox-report-adapter-test.mjs`：74 项自动检查。

## Fixture 统计

| Fixture | 正式 report id | seed | theater / strategy | mission | result | friendly / enemy | events | damage | repair | destroy | retreat | missing roles | supported |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| campaign-victory | `battle_2_fixture-f_border_road_breakthrough` | 2 | border_road / breakthrough | campaign | victory | 5 / 6 | 151 | 60 | 3 | 6 | 0 | 5 | true |
| campaign-withdraw | `battle_12_fixture-f_border_road_breakthrough` | 12 | border_road / breakthrough | campaign | withdraw | 5 / 6 | 147 | 59 | 3 | 6 | 1 | 5 | true |
| campaign-defeat-or-wiped | `battle_1_fixture-f_enemy_outpost_cautious` | 1 | enemy_outpost / cautious | campaign | wiped | 1 / 10 | 32 | 12 | 0 | 1 | 0 | 7 | false |
| operation-result | `battle_1_fixture-f_operation_salvage_run_breakthrough` | 1 | scrap_mine / breakthrough | operation `salvage_run` | victory | 5 / 2 | 33 | 11 | 0 | 2 | 0 | 9 | true |

`supported=false` 的 wiped fixture 仍是有效真实战报；它被标记为诊断态，是因为单步兵编队不满足完整演出候选角色要求，而不是因为 normalized report 或 authority coverage 无效。四份 fixture 的 validation errors 均为 0，uncovered events 均为 0。

## 测试结果

正式项目：

~~~text
npm test
stage3: 63 passed
stage4: 76 passed
stage5: 99 passed
stage6: 116 passed
stage7: 65 passed
stage8: 90 passed
stage8-1: 36 passed
stage8-1-1: 43 passed
total: 588 passed / 0 failed
~~~

沙盒回归：

~~~text
sandbox-opening-test: 28 passed
sandbox-opening-patch-test: 30 passed
sandbox-damage-repair-test: 40 passed
sandbox-breakthrough-capture-test: 63 passed
sandbox-integration-readiness-test: 53 passed
sandbox-report-adapter-test: 74 passed / 74 total
~~~

## 正式边界 SHA 对比

将当前 `js/`、`css/`、`scripts/`、`tests/`、根 `index.html` 和 `package.json` 共 36 个文件与上一阶段基线 `iron-command-stage8-2C-1-integration-readiness.zip` 解包内容逐文件比较：

~~~text
archive aggregate SHA-256: 2024208dcb2dc2411a9ca8361309e8e45f60e587067871b156f158326753d6d2
current aggregate SHA-256: 2024208dcb2dc2411a9ca8361309e8e45f60e587067871b156f158326753d6d2
same: true
~~~

## Viewer 验收

URL：<http://127.0.0.1:8000/experiments/battle-sandbox/report-adapter/fixture-viewer.html>

通过真实浏览器依次调用 `window.selectFixture(id)`，再读取 `window.render_contract_to_text()`。四个 fixture 均完成加载、契约渲染和摘要读取；console errors 为 0。截图：

- [01-victory-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/01-victory-contract.png>)
- [02-withdraw-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/02-withdraw-contract.png>)
- [03-wiped-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/03-wiped-contract.png>)
- [04-operation-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/04-operation-contract.png>)

## 未解决问题与边界

本阶段没有未解决的适配器校验错误。当前 limitation 是部分真实编队缺少完整战术角色，因此 viewer 会显示 missing roles；这属于候选演出诊断，不会伪造角色或篡改战报。正式 renderer 尚未消费本契约，属于下一阶段明确预留项。

## 8.2D-B 预留

只预留“真实 report → presentation contract → 35 秒 RTS 演出模板”的消费层：将由契约提供事件时间、演员角色和权威锚点，继续保持演出只读、事件权威、失败可诊断。8.2D-A 不实现该接入，不扩展正式战斗或 35 秒之后内容。

