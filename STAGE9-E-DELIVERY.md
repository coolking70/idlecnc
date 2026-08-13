# Stage 9-E · Integrated Campaign & Equipment Milestone

基线：`5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6`
分支：`auto/stage9-e-stage9-milestone-closure`
阶段：`CURRENT_STAGE=9` · `Stage 9 · Expanded Campaign & Equipment`
版本：`0.9.0` · `SAVE_VERSION=10`

## 范围

本阶段只整合已有生产、装备、战区、正式战斗、战后回收、存档与回放链路，不新增单位、战区或战斗公式。战斗掉落没有实现，也没有预埋；装备来源仍由生产与 Stage 9-D 的结算后确定性回收组成。

真实闭环为：生产装备 → DOM 挂载 → `river_ferry` 重复任务 → Formal Battle / Settlement → 结算后 DOM 领取 → DOM 挂载回收实例 → reload → 历史只读回放。

## 关键边界

- 装备属性继续只通过 `getUnitEffectiveStats()` 进入 `buildDispatchSnapshot()`；Formal Solver 只消费部署快照。
- 有效属性顺序固定为：基础属性 → 老兵乘数并保留 4 位 → 按槽位顺序逐个乘装备修正，并在每次乘法后保留 4 位。`hp/maxHp` 没有装备通道。
- 正式结算不修改 equipment；领取回收只修改 `equipment.*`，save diff 不触及 `battleSessions`、ledger、battles、formations 或无关生产状态。
- 回放读取历史部署快照；当前装备变化不会改写旧战报或回放表现。
- 生产离线推进与战斗离线隔离：生产队列可正常推进且完成一次，战斗不会因离线被推进。
- `migrate()` 先清洗 units，再清洗 equipment，再进入 theaters/battles/session/salvage claims；这样单位删除会先使装备绑定悬空，装备删除会使单位绑定悬空，两端均 fail-closed。旧存档缺失 equipment 显式补为空库存，不使用 starter inventory，因此不会凭空生成装备。

## 证据与门禁

- Core：23/23。
- Browser：14/14 帧、14 个唯一截图 hash、5 次真实 reload、无页面/控制台错误；生产、取消、完成、挂载、重复任务、battle lock、领取、回收挂载、报告、回放均有真实 DOM provenance。
- Strong verifier：从当前 source 独立重建 production state 并重算；通过。
- Tamper：92/92 拒绝；`coupledRejected=92`；`passedFlagOnlyCases=0`。
- 性能契约未放宽：16.7ms、20 warmup、120 samples、p95 与既有 `perf-environment` 守卫保持不变。

## 自检问答

1. 装备加成通过 `getUnitEffectiveStats()` 进入快照；没有在结算或表现层叠加。
2. 装备不影响 `hp/maxHp`。
3. 既有 9 项科技、starter 三件装备、Stage 9-A 六战区六任务数值未改。
4. 本阶段没有战斗掉落实现或预埋。
5. 生产中实例不在 inventory，不能挂载；完成后实例 ID 为确定性的 `equipment-production-{equipmentId}-{serial}`。
6. 真实 browser 闭环验证了生产队列、结算待领取、运行中锁定、历史回放的 reload 恢复。
7. Formal Battle / Formal Report / Settlement authority、Solver、Planner、Choreographer、`js/save-diff.js` 语义、`tests/lib/` 均保持冻结。
8. 变更的 production runtime 文件只有 `js/config.js` 的 Stage metadata；其余新增内容为测试、证据、workflow 与文档。

最终 SHA、远端 SHA、Stage Gate / Release Gate run ID 与 clean-clone 完整 JSON 以最终交付消息中的真实命令输出为准；最终提交后不再产生提交。
