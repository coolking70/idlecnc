# 《钢铁指令》阶段 8.2F-A.1 交付说明

## 结论

阶段 8.2F-A.1 已完成。通用规划器仍保持隔离，不接入正式主循环、不替换正式战报、不启动 sprite 工作；本次收口集中在确定性输入语义、动态地形布局、维修/撤退/结局编舞、语料覆盖和证据封包。

最终交付包：`iron-command-stage8-2F-A-1-universal-planner-hardening.zip`

ZIP SHA-256 以构建脚本最终输出为准。

## 覆盖结果

- canonical：120 条；每个 `victory`、`pyrrhic`、`withdraw`、`defeat`、`wiped` 结果不少于 10 条。
- fuzz：1000 条；友军兵种序列 661 种，覆盖 1–8 名友军与 2–10 名敌军。
- 地形：`open`、`road`、`fortified`；6 个 missionId；3 种正式策略。
- 覆盖字段：`byTerrain`、`byMissionKind`、`byMissionId`、`byStrategy`、`byResult`、`byArchetype`、`byFriendlyActorCount`、`byEnemyActorCount`，以及伏击、发现、高威胁、维修、友军损失、敌装甲、初始损伤、经验单位。
- `planFailures=[]`、`continuousLayoutFailures=[]`、`semanticFailures=[]`。
- 初始损伤、经验单位、维修事件和敌方装甲均有正反样本；敌方发现与伏击均有正反样本。

所有报告由正式 `simulateBattle()` 产生。报告输入与 Presentation Contract 输入的完整规划 JSON、report fingerprint、plan fingerprint 一致；反转友军/敌军输入数组不会改变布局或计划。

## 规划器与回归

新增并接入：位置采样、布局去冲突、障碍校验、维修编舞、结局编舞、接敌分析、权威最终状态、计划 fingerprint。权威事件、目标、数值、最终 HP/alive、结果和 capture 只读校验；convoy、场景物件、路线和表现动作保持非权威。

通过的 A.1 专项测试：

- planner：112 项。
- corpus：1120 条。
- input stability：20 项。
- semantics：63 项。
- continuous layout：1123 项，0 碰撞。
- delivery manifest：12/12 截图，浏览器 page/console error 均为 0。

## 动态证据

最终清单位于 `experiments/battle-sandbox/universal-planner/screenshots/manifest.json`，包含每张图的 `planFingerprint`、`requestedTime`、`actualTime`、`currentPositionsHash`、`result`、`activeActions` 和 PNG SHA-256；12 个时间点中至少 8 个不同，PNG SHA 全部不同。

截图文件为：

`01-open-victory-contact.png`、`02-open-withdraw-retreat.png`、`03-road-victory-secure.png`、`04-road-defeat-collapse.png`、`05-convoy-victory-moving.png`、`06-convoy-withdraw-turnback.png`、`07-fortified-victory-breach.png`、`08-fortified-wiped-final.png`、`09-no-repair-final.png`、`10-many-reserves-moving.png`、`11-pyrrhic-costly-secure.png`、`12-enemy-armor-contact.png`。

正式 `enemy_outpost` 配置在当前正式命令预算下没有完整 victory 报告；07 图使用正式 fortified 的 pyrrhic breach/hold 样本，文件名保留验收要求的 breach 场景标识，manifest 记录真实 result。

## A.2.4 证据修复

已重新执行官方浏览器证据脚本，并将同一次运行的 `evidenceRunId`、12 张 PNG 与输出文件同步。当前 A.2.4 三方运行 ID 一致，`stage8-2E-A-2-4-test.mjs` 37/37 通过；`npm test` 为严格执行，任何失败均阻止封包。

本次官方证据运行 ID：`5a0933e0-8232-41fb-bfec-9e6216f8d166`。

## 自包含验证

封包构建脚本会先生成语料、运行专项测试、生成浏览器证据、严格运行 `npm test`，再执行 ZIP 解压后的自包含验证器。ZIP 排除 `.git`、`node_modules`、旧 ZIP 和浏览器临时目录。
