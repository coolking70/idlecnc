# 《钢铁指令》阶段 8.2D-A.1 交付说明

## 本轮目标

本轮只修复独立 `report-adapter`：Fixture 一致性、生成器模式、Manifest、演员身份/属性校验、严格结果一致性、候选阵容诊断和固定契约 Schema。没有修改正式 `js/`、`css/`、`scripts/`、正式测试、根 `index.html`、`package.json` 或正式战斗页面，也没有进入 8.2D-B。

## 生成器与 Manifest

~~~bash
node experiments/battle-sandbox/report-adapter/fixture-generator.mjs --check
node experiments/battle-sandbox/report-adapter/fixture-generator.mjs --write
~~~

`--check` 只读搜索当前正式 `simulateBattle()` 目标结果，在内存中生成期望 Fixture，再与磁盘 Fixture、`fixtures/index.json` 和 `fixture-manifest.json` 逐项比较；差异输出首个路径并返回 1，不写文件。

`--write` 先生成临时目录并完成重建、Manifest、统计和 hash 验证，再原子替换 Fixture 目录与 Manifest；写入后再次执行等价检查。没有使用文件修改时间、`Date.now()` 或 `Math.random()`。

Manifest 的正式边界文件为：

~~~text
experiments/battle-sandbox/report-adapter/fixture-scenarios.js
js/battle.js
js/config.js
js/integrity.js
js/research.js
js/state.js
js/units.js
~~~

当前 `formalBoundaryHash`：

~~~text
3ae260e19606a20e6b953f37e50328cde0a082c6d0351e9c01f17c36f28c045f
~~~

## 当前 Fixture 统计

以下数据直接来自 `fixture-manifest.json`，不是测试源码硬编码：

| Fixture ID | report.id | seed | result | friendly / enemy | events | damage | repair | destroy | retreat | reportHash | supported | missing requirements |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|
| campaign-victory | `battle_2_fixture-f_border_road_breakthrough` | 2 | victory | 5 / 6 | 151 | 60 | 3 | 6 | 0 | `830a1c8f0f2308779495cabbef02b80fc5aa2d6605c2a0c206bb33c94addde41` | false | none; validation diagnostic: enemy combat actors remain |
| campaign-withdraw | `battle_12_fixture-f_border_road_breakthrough` | 12 | withdraw | 5 / 6 | 147 | 59 | 3 | 6 | 1 | `2a68f89aeb292c28d6d6a3224d2b82e181bbf599b7362dd38fee02bf97edbd07` | true | none |
| campaign-defeat-or-wiped | `battle_1_fixture-f_enemy_outpost_cautious` | 1 | wiped | 1 / 10 | 32 | 12 | 0 | 1 | 0 | `9fc8447a767fc7debb9be2cfba075fe526cc701a536d2ae51093630533efea2a` | false | friendlyInfantryCount, friendlyScoutVehicleCount, friendlyArmorCount |
| operation-result | `battle_1_fixture-f_operation_salvage_run_breakthrough` | 1 | victory | 5 / 2 | 33 | 11 | 0 | 2 | 0 | `a3b1305e4f2699fc06e2fddce1a2cc60d174b1db149e4e07eb8ee76d46504ccf` | true | none |

注意：当前 workspace 的正式 solver 仍生成 campaign-victory seed 2 / 151 events / 60 damage / 3 repair，因此 Fixture 按当前 solver 保留这些值；严格校验同时明确显示其“victory 但敌方仍有可战斗单位”的一致性问题。适配层没有为保留旧 Fixture 而放宽规则或修改正式 solver。

## 测试结果

正式回归：

~~~text
npm test
stage3 63 passed
stage4 76 passed
stage5 99 passed
stage6 116 passed
stage7 65 passed
stage8 90 passed
stage8-1 36 passed
stage8-1-1 43 passed
total 588 passed / 0 failed
~~~

沙盒回归：

~~~text
sandbox-opening-test: 28 passed
sandbox-opening-patch-test: 30 passed
sandbox-damage-repair-test: 40 passed
sandbox-breakthrough-capture-test: 63 passed
sandbox-integration-readiness-test: 53 passed
sandbox-report-adapter-test: 76 passed / 76 total
sandbox-report-adapter-integrity-test: 85 passed / 85 total
~~~

生成器执行顺序：

~~~text
--write: ok
--check: ok
--check: ok
~~~

连续两次 `--write` 的 Fixture、`index.json` 和 Manifest 聚合 SHA-256：

~~~text
write-1 aggregate: e01c92ecd61badfcca7c5db7b80df699a979a92875c58824bd705aaaa04662e9
write-2 aggregate: e01c92ecd61badfcca7c5db7b80df699a979a92875c58824bd705aaaa04662e9
same: true
~~~

## Schema 与完整性规则

- `contractVersion===1`，根级不再有 `templateId`；只使用 `contract.presentation.templateId===null`。
- 重复演员 ID、初始/最终集合缺失、跨阵营 ID、`type/category/shape/realId/maxHp` 变化和六项基础属性变化均进入 normalization errors，并使 validation 失败。
- 非法 seed、时间、HP、maxHp、alive、事件类型和值不会静默变成 0 后通过。
- `isCombatCapableActor` 统一要求 attack > 0、alive===true、hp > 0。
- victory/pyrrhic 要求敌方可战斗单位严格为 0；defeat 要求敌方至少一个；wiped 不允许我方可战斗单位；withdraw 要求 retreat。
- 最低公路模板候选：我方 2 个步兵类、1 个侦察/轻型车辆、1 个真实装甲；敌方 2 个步兵类。维修车、第二辆装甲、敌方装甲是可选项。

## Viewer 验收

URL：<http://127.0.0.1:8000/experiments/battle-sandbox/report-adapter/fixture-viewer.html>

查看器读取最新 `fixture-manifest.json`，`window.selectFixture(id)` 和 `window.render_contract_to_text()` 均保留。四张截图已重新生成：

- [01-victory-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/01-victory-contract.png>)
- [02-withdraw-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/02-withdraw-contract.png>)
- [03-wiped-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/03-wiped-contract.png>)
- [04-operation-contract.png](<experiments/battle-sandbox/report-adapter/screenshots/04-operation-contract.png>)

浏览器检查要求：seed、事件数、damage、repair、report.id 与 Manifest 一致；campaign-victory 显示 DIAGNOSTIC，withdraw 和 operation result 显示 SUPPORTED；console errors 为 0。

## 正式边界与已知问题

正式项目边界仍与阶段 8.2C.1 基线逐文件一致：此前 36 文件聚合 SHA 为 `2024208dcb2dc2411a9ca8361309e8e45f60e587067871b156f158326753d6d2`。本轮新增的正式战斗输入 Manifest hash 仅用于检测未来变化，不代表修改了正式文件。

唯一明确的当前问题是正式 solver 的 campaign-victory 输出：`result=victory` 但最终仍有可战斗敌方单位。8.2D-A.1 已将其显式诊断，不再静默接受；修复正式 solver 属于本轮禁止范围。Fixture 生成一致性本身无隐藏差异。

## 8.2D-B 预留

继续只预留“真实 report → contract → 35 秒演出模板”的消费层；本轮没有坐标映射、renderer 接入、正式页面接线或 35 秒扩展。完成本交付后停止。
