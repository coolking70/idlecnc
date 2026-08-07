# 《钢铁指令》阶段 8.2F-A 交付说明

## 交付结论

阶段 8.2F-A 已完成。新增内容是隔离的通用战斗演出规划器与 debug sandbox，不接入正式游戏主循环、不替换正式战报、不启动 sprite 美术工作。

数据管线为：

`formal report → Presentation Contract → Battle Intent → Scene Grammar → Force Groups → Dynamic Layout → Presentation Actions → Universal Presentation Plan`

交付包：`iron-command-stage8-2F-A-universal-planner.zip`


## 覆盖与确定性

- canonical：72 条。
- deterministic fuzz：500 条。
- 总 corpus：572 条，全部由正式 `simulateBattle()` 生成。
- `planFailures`：0。
- 地形：`open`、`road`、`fortified`。
- missionId：`scrap_mine`、`border_road`、`enemy_outpost`、`salvage_run`、`convoy_escort`、`outpost_sweep`。
- 策略：正式配置 `cautious`、`breakthrough`、`recon_by_fire`，并在通用注册表提供语义别名。
- 结果：`victory=57`、`pyrrhic=1`、`withdraw=35`、`defeat=89`、`wiped=390`。
- 友军规模：1–8；敌军规模：2–10；总演员规模：3–18。
- 规划器检查：112 项通过；corpus 检查：572 条通过。

语料与覆盖报告位于 `experiments/battle-sandbox/universal-planner/scenarios/`。

## 浏览器证据

调试页：`experiments/battle-sandbox/universal-planner/index.html`。

已生成 12 张实际浏览器截图：

`01-open-victory.png`、`02-open-withdraw.png`、`03-road-victory.png`、`04-road-defeat.png`、`05-convoy-victory.png`、`06-convoy-withdraw.png`、`07-fortified-victory.png`、`08-fortified-wiped.png`、`09-no-repair.png`、`10-many-reserves.png`、`11-pyrrhic.png`、`12-enemy-armor.png`。

Manifest 记录了每个场景的 `scenarioId`、`reportId`、terrain、mission、strategy、result、actorCount、planHash 与 PNG SHA-256；12 个 SHA 全部不同；`pageErrors=[]`、`consoleErrors=[]`。

页面接口：

- `window.selectUniversalScenario(id)`
- `window.seekUniversalPlanTime(seconds)`
- `window.render_universal_plan_to_text()`

## 正式边界与权威性

正式战报的 actorId、targetId、events、HP、alive、destroy、repair、retreat、result、capture、rewards、duration 均只读校验。权威事件按原始顺序一一映射到 authority anchor/action；表现动作中的 convoy、cover、screen、route 等仅为非权威场景数据。

本阶段未修改正式游戏与旧旁路文件。当前工作区已有的阶段 8.2E-A.2.4 用户修改保持原样：声明的 formal boundary hash 为 `c2a87e086e3391eda24ccef3c9a7555f2b624d3f79a2ff01b9c3d3f62ddab733`；本次交付另记录当前正式业务聚合 hash `c9cc2057db78970c481d3d7641958ec91b291497b1624b056d63a781c27aee84`、正式旁路聚合 hash `1466ed730558b81d355f62769f6e4c1a7676964d40822d74f53336669737e25d`。

## 测试与已知基线

- `universal-presentation-planner-test.mjs`：112 项通过。
- `universal-presentation-corpus-test.mjs`：572 条通过。
- 浏览器 evidence：12/12，SHA unique，浏览器错误 0。
- `npm test` 已执行；既有 A.2.4 静态浏览器证据三方 `evidenceRunId` 一致性检查失败。该失败发生在本阶段新增文件之外，且本阶段未修改 formal game / old sidecar / A.2.4 证据文件，因此保留并明确记录，不以改动旧边界规避。

## 8.2F-B 接口备注

8.2F-B 可直接消费 `buildUniversalPlan(contractOrReport)` 的纯数据结果；正式接入前应另行定义 runtime adapter、版本协商、渲染时钟桥接和失败回退策略。本阶段不允许把 universal planner 直接导入正式主循环。
