# Stage 9-C 装备获取循环交付

分支：`auto/stage9-c-equipment-acquisition`
基线：`e72eedac27423902b94ebab69b2fa053ca99b112`
范围：装备生产、科研前置、库存多实例、真实 reload 恢复与 DOM 管理路径。

## 范围与权威边界

- 未实现、未预埋战斗掉落。装备只由共享生产队列完成后入库；Reward、Settlement、`save-diff.js`、Formal Solver、Planner、Choreographer 均未接入装备产出。
- 生产完成只增加 `state.equipment.inventory` 和 `stats.equipmentBuilt`；不写 `battleSessions`、账本、战报、编队或战斗状态。
- 现有 9 项科技的定义、数值和数量保持不变。新增装备复用它们作为 `requiresTech`，避免新增科技改变 Stage 7 科技树。
- 装备仍通过 Stage 9-B 已冻结的 `getUnitEffectiveStats()` 接入部署快照；没有战斗中实时叠加。装备不含 `hp`/`maxHp` 修正。

## 实现要点

- 新增 5 件生产装备，总目录 8 件；5 种单位类型各至少 2 件适用装备。生产定义含装甲工厂、资源成本、制造时长和科研前置。
- 装备任务使用 `state.production.current/queue`，共享 `PRODUCTION.maxQueueSize`；入队扣费，当前任务按 `activeCancelRefundRatio` 返还，等待任务按 `queuedCancelRefundRatio` 返还。
- 完成实例 ID 使用 `equipment-production-${equipmentId}-${最小可用序号}`，与 starter ID 空间分离；未完成任务没有库存实例。
- `sanitizeEquipment()` 除库存/绑定外校验生产 acquisition 字段和科技引用；`sanitizeProduction()` 校验生产中的装备任务、来源建筑、科技、成本和时长。
- `SAVE_VERSION` 从 8 升至 9。旧存档缺少 `equipment` 时明确使用 `emptyEquipmentState()`，不会复制 starter 或产生生产记录。

## 结合顺序与舍入

有效属性顺序固定为：`基础属性 → 老兵等级乘数 → 按槽位顺序逐件装备乘数`。基础乘等级后保留 4 位；每次装备乘法后再次保留 4 位；`hp` 直接取单位基础定义。装备乘数仍只允许 `attack / antiArmor / defense / scouting / mobility / repair`。

## 迁移顺序与 fail-closed

迁移顺序为 `construction → research → production → units → equipment → operations → theaters → battles → activeBattle → repairs → formations`。生产任务先清洗，避免非法在途装备任务绕过队列；单位先清洗并去重，随后装备清洗才能同时验证：装备绑定到已删除单位、单位绑定到不存在装备、重复实例、类型不适用和超槽位。两种悬空方向均丢弃，旧存档无装备则为空库存。

## 离线与战斗三态

装备生产属于生产队列，离线期间正常推进并用 `job.done`/共享事件步进保证只完成一次；离线不会推进活动战斗。运行中装备变更被 `battle_locked` 拒绝，回放被只读锁拒绝，历史回放读取部署快照中的装备编成。浏览器证据覆盖生产队列、完成未挂载、运行中和回放四次真实 `Page.reload`。

## 自检问答

1. 最终 commit 只有在推送后声明；交付输出包含 `git ls-remote` 的实际 SHA。
2. `verify:clean-clone` 必须以 `overallPassed: true` 且每个 step 为 true 的完整 JSON 为准。
3. 没有实现或预埋战斗掉落。
4. 结算不修改 equipment；结算允许路径仍不含 equipment。
5. 新装备只使用六个合法乘数键，不影响 hp/maxHp。
6. starter 三件与既有 9 项科技数值未改；生产装备复用既有科技。
7. 两个同定义实例使用独立 deterministic ID；卸载一个实例后另一个仍保留，核心测试和 tamper 均覆盖。
8. 生产中任务尚未进入 inventory，不能挂载。
9. 生产队列和当前任务序列化进 save；浏览器在队列中和完成未挂载时真实 reload 验证。
10. 离线生产正常推进、同令牌不重复完成；活动战斗保持锁定且不推进，二者分别有 isolation 证据。
11. Stage 9-B 的 battle lock、部署/回放历史快照回归通过。
12. `SAVE_VERSION=9`；旧存档迁移为空 equipment、无生产记录。
13. `git diff --name-only` 自检不含 Solver、Planner、Choreographer、`tests/lib/` 或 `save-diff.js`。
14. Stage 9-C 性能测试调用 `awaitFitEnvironment()`；守卫和 16.7ms 语义未改。
15. tamper 共 121 例，121 例拒绝，`passedFlagOnlyCases=0`。
16. `posttest`、`gate:stage8-2G`、GitHub workflow 均追加 Stage 9-C；`.cnb.yml` 保持不变。
17. 性能证据包含 platform、arch、cpuModel、cpuCount、nodeVersion、loadBefore/loadAfter；最终门禁前另行记录 `uptime`。

## 证据文件

核心证据、浏览器帧/截图 hash、独立 verifier、tamper 结果和 developer selfcheck 均使用 `stage9_c_*.json`。外部验收应重新运行当前 source verifier，不采信证据中的 `passed` 字段。
