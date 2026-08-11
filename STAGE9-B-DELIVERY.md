# Stage 9-B Equipment System Delivery

## 范围

本阶段把装备限制为生产侧输入。装备状态只存在于 `state.equipment`；正式战斗开始前，`js/theater.js` 的 `buildDispatchSnapshot()` 通过 `getUnitEffectiveStats(unit, state.equipment)` 固化有效属性和装备编成。Formal Battle、Formal Report、Settlement、Planner、Choreographer、Solver、`js/save-diff.js` 与 `tests/lib/` 没有被改写。

装备只允许影响 `attack / antiArmor / defense / scouting / mobility / repair`。`hp` 与 `maxHp` 始终来自单位基础定义，`sanitizeUnit()` 的生命上限契约保持原样。

## 规则与迁移

有效属性的确定性顺序为：

```text
base → rank multiplier → equipment multipliers in slot order
```

每次乘法后都使用 `Number(value.toFixed(4))`。装备不参与每帧战斗表现路径。`SAVE_VERSION=8`；`migrate()` 在 `sanitizeUnits()` 之后、operations/theaters/battles/formations 清洗之前调用 `sanitizeEquipment()`。此时单位 ID 已完成规范化，库存实例也已形成权威集合，绑定会同时验证两端引用，因此“装备绑定到已删除单位”和“单位绑定到不存在装备”都会被删除。旧存档没有 `equipment` 时使用 `emptyEquipmentState()`，不会继承新游戏 starter inventory。

## 三态隔离

- 运行中和结算结果面板的挂载/卸载请求返回锁定失败，既有 `battleSessionId`、`deploymentHash`、`formalReportHash`、ledger 保持不变。
- 回放是只读状态，装备操作返回 `replay_read_only`；回放使用 session 保存的历史 `deploymentSnapshot`，当前装备变化不能改写旧战报。
- `Page.reload` 后活动战斗、结果和回放均由现有 save/replay binding 恢复；装备状态和历史快照分别保持各自边界。
- 结算计划不读写 `state.equipment`，没有装备损耗或掉落。

## UI

部队档案详情内提供装备管理入口、槽位显示、真实 `data-action="equip-equipment"` / `data-action="unequip-equipment"` 控件。UI 只读取 `canEquipEquipment()`、`getEquipmentDefinition()` 与 `getUnitEffectiveStats()` 的权威结果；装备面板使用 `equipmentSignature` 增量刷新。

## 证据

Stage 9-B 证据文件包括：`stage9_b_equipment_model_check.json`、`stage9_b_effective_stats_check.json`、`stage9_b_snapshot_binding_check.json`、`stage9_b_battle_isolation_check.json`、`stage9_b_replay_historical_check.json`、`stage9_b_migration_check.json`、`stage9_b_save_diff_check.json`、`stage9_b_real_reload_check.json`、`stage9_b_ui_path_check.json`、`stage9_b_authority_check.json`、`stage9_b_regression_check.json`、`stage9_b_performance_check.json`、`stage9_b_tamper_results.json`、`stage9_b_browser_capture_manifest.json`、`stage9_b_strong_evidence_verdict.json`、`stage9_b_developer_selfcheck.json`。

Verifier 从当前 source 独立重建有效属性与快照，并逐字段比对 bundle；`passed` 字段不作为事实来源。真实浏览器清单记录 8 个语义帧、4 个 reload reason、每次 before/after `timeOrigin` 和 loaderId，`dispatchApiUsed` / `replayApiUsed` / `offlineApiUsed` / `equipmentApiUsed` 均为 `false`。性能基准固定为 warmup 20、samples 120、p95、budget `<16.7ms`，并记录运行环境。

## 收口

最终交付以真实 `git rev-parse HEAD`、`git status --porcelain`、`npm run gate:stage8-2G`、`npm run verify:clean-clone` 和 `git ls-remote` 为事实来源；selfcheck/evidence 的 `passed` 不替代这些命令的实际输出。
