# 《钢铁指令》阶段 8.2D-A.2 交付记录

## 交付结论

阶段 8.2D-A.2 已完成。本阶段只处理正式战斗结果语义、严格 Fixture 选择、Manifest 状态和交付包自检；没有进入 8.2D-B，也没有修改正式 renderer、Canvas、单位基础值、敌方配置、奖励配置或存档版本。

正式版本边界保持：`CURRENT_STAGE=8`、`SAVE_VERSION=7`、package version `0.8.1-hotfix.1`。

## 正式结果语义

- `js/battle-outcome.js` 是唯一结果语义入口，导出 `isCombatCapableUnit`、`countCombatCapable`、`sumCombatHp`、`determineBattleOutcome`、`validateOutcomeSnapshot`。
- victory / pyrrhic 必须满足敌方可战斗单位数为 0；operation victory 不占领，campaign victory 才可占领。
- 我方无可战斗单位时，仍有存活支援单位为 defeat，全部无存活单位为 wiped。
- 双方仍有可战斗单位并达到最大回合时统一收束为 withdraw；withdraw 恰好写入一次 retreat，且 result 为最后事件。
- victory / pyrrhic 以外的结果奖励严格为 `{}`；失败、撤退、全灭不占领。

## 严格 Fixture

| Fixture | seed | result | friendly / enemy | events | damage / repair / destroy / retreat | validation | supported |
| --- | ---: | --- | ---: | ---: | --- | --- | --- |
| campaign-victory | 1 | victory | 6 / 6 | 122 | 41 / 7 / 7 / 0 | true | true |
| campaign-withdraw | 12 | withdraw | 5 / 6 | 147 | 59 / 3 / 6 / 1 | true | true |
| campaign-defeat-or-wiped | 1 | wiped | 1 / 10 | 32 | 12 / 0 / 1 / 0 | true | false |
| operation-result | 1 | victory | 5 / 2 | 33 | 11 / 0 / 2 / 0 | true | true |

`campaign-victory` 使用严格支持阵容：`infantry + at_infantry + scout_car + mbt + mbt + repair_vehicle`。`campaign-withdraw` 和 `operation-result` 也通过角色支持契约；wiped Fixture 保留为合法但不支持的失败样本。

Manifest 的正式边界聚合 SHA-256：

`87774844087771d10a1324c673154804af75ef5dca1f97d7c3ebe02d01ef8909`

## 自动验证

- `npm test`：608 passed / 0 failed，其中阶段 8.2D-A.2 正式测试 20 / 20。
- 五组既有 Canvas 沙盒测试：28 + 30 + 40 + 63 + 53 全部通过。
- report adapter：76 / 76。
- report adapter integrity：85 / 85。
- `fixture-generator.mjs --check`：通过；连续 `--write` 字节一致，写后检查通过。
- 正式结果扫描：四种场景各扫描 seed 1..2000，无非法 outcome；敌方仍有可战斗单位时没有 victory / pyrrhic。
- 真实浏览器查看器：四张截图重新生成，Manifest matched，`consoleErrors=[]`；截图文件为 `screenshots/01`～`04`。

## 交付包

文件：`iron-command-stage8-2D-A-2-outcome-fixture-hotfix.zip`

交付包通过 `experiments/battle-sandbox/report-adapter/verify-delivery-package.mjs`：解压到临时目录后重新运行正式 npm 测试、五组沙盒测试、Fixture generator check、76 项 adapter、85 项 integrity、20 项 A.2 正式测试，并检查 Manifest、四份 Fixture、四张契约截图和本交付文档。压缩包不包含旧 ZIP、backup、临时输出或 `.tmp` 条目。

## 后续边界

8.2D-B 不在本次交付范围内。正式 renderer、35 秒 Canvas 演出接入、正式战报视觉化和新的存档版本均保持未实现。
