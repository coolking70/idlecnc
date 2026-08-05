# Original prompt

继续开发现有《钢铁指令 / IRON COMMAND》项目：以已完成阶段6的 `iron-command-stage6.zip` 为基础，在原项目中完成阶段7；保留阶段3～6功能与测试，完成数据完整性修复、技术实验室、科研系统和离线科研结算；阶段7完成后停止，不实现单位升级、装备、新战区、随机事件或战斗中手动指挥。

# Stage 7 progress

- [x] 统一损伤等级与维修成本防篡改
- [x] 严格战报校验、活动战斗安全恢复、离线结算令牌与静默阈值
- [x] 技术实验室建筑、Canvas 表现与科研分页
- [x] 三分支九项科技、前置/队列/取消/存档容错与效果快照
- [x] 离线科研推进、报告与活动战斗离线暂停
- [x] 阶段3～7测试、Playwright 页面验证与交付压缩包

# Stage 8 original prompt

继续开发已完成阶段7的《钢铁指令 / IRON COMMAND》项目：完成阶段8完整性加固、单位档案与四档老兵等级、呼号、重复任务、离线任务就绪、真实浏览器验收与交付压缩包。保留阶段3～7功能与测试；阶段8完成后停止，Stage9只预留装备系统与新战区接口。

# Stage 8 progress

- [x] `CURRENT_STAGE=8`、`SAVE_VERSION=7`、package `0.8.0`，迁移并规范单位/科研/重复任务数据
- [x] 科研依赖闭包、revision/history（最多64）、生产/维修可信科研绑定与创建时间
- [x] 派遣 `dispatchSnapshot`、战报确定性重建、严格 alive/敌军集合/结果一致性校验
- [x] 单位呼号、经验动态等级（新兵/训练有素/老兵/精锐）、战斗快照等级修正、部队档案页
- [x] `salvage_run` / `convoy_escort` / `outpost_sweep` 三个重复任务、成本/奖励/冷却/结算与离线 `operationsReady`
- [x] 基地 Canvas 集结区老兵标记、战区重复任务卡、操作战报展示、调试接口
- [x] 阶段3～8自动测试共509项通过；Playwright 客户端无页面错误，真实浏览器截图已生成
- [x] 交付文档、Stage9 预留说明与 `iron-command-stage8.zip`

## Stage 8 verification notes

- `npm test`: stage3 63、stage4 76、stage5 99、stage6 116、stage7 65、stage8 90，合计 509 passed。
- Browser manual path: 部队档案 → 编队集结 → 已占领战区的重复任务 → 操作战报；`dispatch=true`、`settle=true`、`close=true`、reports=1，console errors=0。
- Known next-stage scope: equipment system and new theaters remain reserved; random events and manual mid-battle command remain closed.

# Stage 8.1 progress

- [x] `battle-visual-director.js`：确定性1200×700战术世界、多路线、多成员单位、地形道具、权威伤害/摧毁事件与装饰效果分离
- [x] `battle-camera.js`：总览 / 聚焦 / 打击 / 结果镜头与自动镜头模式
- [x] `battle-renderer.js`：RTS战场、目标点、不同地形、步兵/反装甲成员组、侦察车/坦克/维修车与返航状态
- [x] `theater.js`：结算后 `returning`、5秒游戏时间自动返航、跳过返航、旧结算活动战斗迁移与旧API兼容
- [x] 全局结果浮层：查看完整战报、跳过返航动画；战术视图隐藏基地图例并显示Tactical Battle chip
- [x] 阶段8.1自动测试36项；阶段3～8旧测试保持通过，`npm test`已接入 `stage8-1-test.mjs`
- [x] 真实浏览器手测：开阔地、防御阵地、连续火力、结果控件、返航中五张截图；按钮链路与自动返航通过，`console errors=0`

## Stage 8.1 verification notes

- package `0.8.1`；`CURRENT_STAGE=8`；`SAVE_VERSION=7`；不开放装备、新单位、新建筑、新战区、新科技、指挥官或战斗微操。
- `render_game_to_text()` 包含 `battlePresentation.phase / returnElapsed / returnDuration / settled`，可直接验证战斗与返航展示阶段。
- Stage9 仍仅保留装备与新战区接口，本轮未扩展 Stage9 内容。

## Stage 8.2A progress

- [x] 新增完全隔离的 `experiments/battle-sandbox/` 固定 Canvas RTS 沙盒，不引用正式战斗、存档、经济、科研和编队模块
- [x] 固定 1280×720 公路遭遇战地图、7+7 逻辑单位、班组成员、车辆轮廓、掩体/建筑/目标点与确定性粒子
- [x] 严格实现 0～10 秒侦察、两路展开、坦克推进、敌军掩体、同步交火、镜头时间轴和 10 秒自动暂停
- [x] 沙盒控制：播放/暂停、重新开始、0.5×/1×/2×、HUD 开关；提供 `advanceTime` 与 `render_game_to_text`
- [x] 沙盒自动测试 28 项通过；正式项目 `npm test` 当前 588 项通过；真实浏览器控制台无新增错误
- [x] 采集并归档 6 张实际沙盒截图，完成 `STAGE8-2A-DELIVERY.md`

### Stage 8.2A verification notes

- URL: `http://127.0.0.1:8000/experiments/battle-sandbox/`
- 截图：`experiments/battle-sandbox/screenshots/01-scout-advance.png` 至 `06-overlapping-fire-10s.png`
- 未实现 10 秒后的维修、摧毁、撤退、占领、正式战报接入或存档接入；下一段沿用 director 的时间边界与计划表接口。

## Stage 8.2A.1 progress

- [x] 修复 `f_inf_2` 状态语义为主动 `suppressing`，并保持掩体后稳定开火
- [x] 新增固定种子 `sandbox-pulse-scheduler.js`：北路步枪、南路压制、坦克同轴多子脉冲与短生命周期弹道
- [x] 增加敌军逐单位 `revealStart/revealEnd`、短暂侦察标记和分批显现
- [x] 统一维修车 9.9 秒 moving、10 秒 holding 的状态边界
- [x] 新增四组 COVER_SLOTS、平滑 formation-to-cover 过渡、掩体 back/front 分层绘制
- [x] 补丁测试 30 项通过；真实浏览器截图 07～12 已生成并检查，无 console error
- [x] 完成 `STAGE8-2A-1-DELIVERY.md`；阶段8.2B仅预留接口，不进入10～20秒实现

# Stage 8.1.1 hotfix progress

- [x] `battle.js`：正式求解器在 `WITHDRAW` 的 `RESULT` 前补写权威 `RETREAT` 事件，保持时间轴单调且不改变数值。
- [x] `theater.js`：新增结算尝试/阻断/错误字段，永久错误一次性记录并停止 tick 重试；新增 `abortInvalidBattle()` 安全关闭流程。
- [x] `theater.js` / `save.js`：旧撤退战报按 `dispatchSnapshot + seed` 确定性重建；无法重建时保留活动战斗并阻断，不重复扣费、奖励或日志。
- [x] `main.js`：接入 `__IRON_COMMAND__.abortInvalidBattle()`；保留 `render_game_to_text` 的活动战斗阻断状态。
- [x] package 版本更新为 `0.8.1-hotfix.1`；CURRENT_STAGE=8、SAVE_VERSION=7 保持不变。
- [x] 新增 `tests/stage8-1-1-test.mjs`，43项全部通过；阶段3～8.1历史测试保持通过，累计588项通过。
- [x] 官方 Playwright 客户端浏览器验收通过：截图生成、文本状态正常、无新增页面/控制台错误；已用 `view_image` 检查最新截图。
- [ ] 交付前生成 `iron-command-stage8-1-1-hotfix.zip` 并确认压缩包包含源码、测试、文档且排除旧压缩包/临时输出。

# Stage 8.2B progress

- [x] 将独立 Canvas 沙盒由 0～10 秒延展至 0～20 秒，保留原侦察、展开、掩体和交火时间轴；20 秒自动暂停并支持重新开始清空视觉状态。
- [x] 新增 `sandbox-damage-model.js`：受击、受损、维修中、稳定和 disabled 的纯视觉状态，以及烟尘、机动性和炮塔工作状态。
- [x] 新增 `sandbox-repair-director.js`：12～16.2 秒维修车后撤跟进路线、16.2～19 秒维修窗口、焊接脉冲、机械臂姿态和工作灯。
- [x] 增加敌方 AT 曲线火箭命中友方坦克、受损后撤与履带尘；增加步兵受压、两组错峰换位至第二掩体；增加友方 AT 命中敌方轻装甲及其后撤/disabled 表现。
- [x] 增加 10～20 秒背景多源脉冲、短生命周期弹道、持续烟尘、焊接火花、破片与受损车辆绘制；无 `Math.random`/`Date.now`。
- [x] 沙盒测试 40 项、新旧 8.2A/8.2A.1 测试 28+30 项通过；真实浏览器连续推进至 20.000 秒，`ended=true` 且无 console error。
- [x] 新增 13～20 号后段截图、`STAGE8-2B-DELIVERY.md` 与 `iron-command-stage8-2B-sandbox.zip`。

# Stage 8.2C progress

- [x] 将独立 Canvas 沙盒由 0～20 秒延展至 0～35 秒，保留前段侦察、展开、受损、换位和战地维修时间轴；35 秒自动暂停。
- [x] 修复 8.2B 三项视觉问题：曳光弹改为受限短段、焊接火花落在维修接触点且保持合理间距、disabled 轻装甲使用倾斜/下沉/熄火炮塔/持续烟尘表达失效。
- [x] 新增突破与重新集结：主炮曲线射击、敌方装甲摧毁与残骸/灼痕、敌方 AT/步兵分批撤退、友方步兵占领目标后的站位、受损坦克回归西侧支援线。
- [x] 新增 `sandbox-objective-director.js`、`sandbox-retreat-director.js`、`sandbox-wrecks.js`，目标点 28 秒 contested、31.5 秒 captured；所有计划保持固定时间轴，无 `Math.random`/`Date.now`。
- [x] 沙盒测试 28+30+40+63 项通过；正式项目 `npm test` 保持 588 passed / 0 failed。
- [x] 官方 Playwright 客户端推进并检查 21.484 秒采样与 35.000 秒终帧：`ended=true`、目标 `captured`、残骸/灼痕可见、无 console error，终帧 HUD 为 `00:35 / 00:35`。
- [x] 新增 21～32 号实际截图、`STAGE8-2C-DELIVERY.md` 与 `iron-command-stage8-2C-sandbox.zip`；Stage 8.2D 仅预留更长战斗/多目标/正式接入边界，不在本阶段实现。

# Stage 8.2C.1 progress

- [x] 新增 `sandbox-capture-tools.js` 与 `window.seekSandboxTime(seconds)`，从固定种子、固定步长、精确剩余步绝对跳转，默认暂停且不继承旧粒子/残骸。
- [x] 步兵与反装甲班同步 `visualCenter`，成员中心用于弹道目标、尘土、标签和文本状态；锚点路径保持独立，不发生累计漂移。
- [x] 摧毁过渡结束后停止绘制 `e_armor_1` 原车体，只保留唯一 `wreck_e_armor_1`；坦克二号最终位置调整为 `(815,350)` 并通过包围盒不相交检查。
- [x] 增加 `TIME_EPSILON=1e-6`，31.5 秒稳定返回 captured，35 秒稳定返回 ended/time=35。
- [x] 使用 `window.seekSandboxTime()` 重新生成 14、15、21～32 号截图；21～32 为 12 个不同 SHA，清单时间误差为 0，浏览器无错误。
- [x] 五组沙盒测试 28+30+40+63+53 全部通过；正式项目保持 588 passed / 0 failed；完成 `STAGE8-2C-1-DELIVERY.md` 与 `iron-command-stage8-2C-1-integration-readiness.zip`。

# Stage 8.2D-A progress

- [x] 新增隔离的 `report-adapter/`：正式战报归一化、字段别名冲突拒绝、演员初末快照、事件引用和结果一致性校验。
- [x] 新增确定性战术角色绑定与权威锚点：保留真实 `actor/target/value`、一事件一来源、damage/suppress/repair/destroy/retreat/result 全覆盖；不生成坐标、不接入正式 renderer。
- [x] 由正式 `simulateBattle()` 生成四份真实 fixture：campaign victory、campaign withdraw、campaign wiped、operation result；重复求解 `compareBattleReports()` 一致。
- [x] 新增只读契约查看器与 `window.selectFixture(id)`、`window.render_contract_to_text()`；四张 viewer 截图已生成，浏览器 console errors=0。
- [x] 新增 `sandbox-report-adapter-test.mjs`，74 项通过；正式 `npm test` 为 588 passed / 0 failed；五组既有沙盒回归 28+30+40+63+53 全部通过。
- [x] 正式边界 36 个文件与 `iron-command-stage8-2C-1-integration-readiness.zip` SHA-256 聚合摘要一致：`2024208dcb2dc2411a9ca8361309e8e45f60e587067871b156f158326753d6d2`。
- [x] 完成 `STAGE8-2D-A-DELIVERY.md` 与 `iron-command-stage8-2D-A-report-contract.zip`；8.2D-B 仅保留“契约接入 35 秒模板”范围。

# Stage 8.2D-A.1 progress

- [x] 新增 `fixture-manifest.json`、`fixture-integrity.js` 和 `schema.js`；Manifest 保存 scenario/report/file hash、统计摘要和正式战斗输入边界 hash。
- [x] `fixture-generator.mjs` 支持只读 `--check` 与临时目录原子替换 `--write`；连续写入、写后检查均确定性通过。
- [x] 修复演员重复 ID 静默覆盖；新增 initial/final 集合一一对应、身份字段、基础属性、非法数值和元数据错误诊断。
- [x] 统一 `isCombatCapableActor`；victory/pyrrhic 要求敌方可战斗单位为 0；候选支持条件改为 2 步兵类 + 1 侦察/轻型车辆 + 1 真实装甲 + 2 敌步兵类。
- [x] 固定契约 Schema 为整数 `contractVersion=1`，`presentation.templateId=null`，删除根级重复 templateId。
- [x] 新增完整性测试 85 项，原适配器测试更新为 76 项；viewer 使用最新 Manifest 统计；正式模块与既有五组沙盒测试范围未改。
- [x] 交付 `STAGE8-2D-A-1-DELIVERY.md` 和 `iron-command-stage8-2D-A-1-contract-hotfix.zip`；8.2D-B 继续仅作接口预留。

# Stage 8.2D-A.2 progress

- [x] 新增 `js/battle-outcome.js`，统一正式求解器、完整性校验与 report adapter 的可战斗单位判定和正式胜负语义。
- [x] victory / pyrrhic 严格要求敌方可战斗单位为 0；campaign / operation capture、失败奖励、withdraw retreat 与 result 尾事件全部统一校验。
- [x] campaign-victory 使用 `infantry + at_infantry + scout_car + mbt + mbt + repair_vehicle` 严格支持阵容；四份 Fixture 均由正式求解器确定性生成。
- [x] Manifest 增加 validation、supported、missingRequirements；generator 对 requireValidation / requireSupportedContract 场景严格筛选。
- [x] 新增 A.2 正式测试 20 项，四种场景各扫描 seed 1..2000；`npm test` 为 608 passed / 0 failed。
- [x] 新增交付包自检器并重新生成四张契约查看器截图；adapter 76 / 76、integrity 85 / 85、五组旧沙盒测试全部通过。
- [x] 完成 `STAGE8-2D-A-2-DELIVERY.md` 与 `iron-command-stage8-2D-A-2-outcome-fixture-hotfix.zip`；8.2D-B 未启动。

# Stage 8.2D-A.3 progress

- [x] 新增 `js/battle-targeting.js`，把目标平局随机性改为排序前预计算 tie salt；排序比较器不调用 RNG、不修改对象、不读取时间。
- [x] 正式求解器支持 native / insertion / merge 排序注入；四个 Fixture seed 1..200 完整战报跨排序实现一致。
- [x] 新增 A.3 正式测试 19 项：比较器纯度、反对称/传递性、固定 RNG 消费、1000 组排序矩阵、正式战报矩阵和源码扫描全部通过。
- [x] 新增 `cross-process-determinism.mjs`，8 个独立 Node 进程的四份 Fixture SHA-256 全部一致。
- [x] Manifest 边界补入 `js/battle-targeting.js`、`js/utils.js`；四张截图写入 `viewerScreenshot.file/sha256/fixtureReportHash` 绑定。
- [x] 新增自包含 `verify-delivery-package.mjs` 与唯一发布入口 `build-delivery-package.mjs`，验证器/发布器均使用临时端口服务器，不依赖 8000。
- [x] package version 更新为 `0.8.1-hotfix.3`；完成 `STAGE8-2D-A-3-DELIVERY.md` 与 `iron-command-stage8-2D-A-3-cross-engine-determinism.zip`；8.2D-B 未启动。

# Stage 8.2D-B progress

- [x] 新增隔离 `contract-demo/`：严格加载真实 `campaign-victory` Fixture，经 `buildPresentationContract(fixture.report)` 生成 `road_assault_v1_infantry_defense` 演出计划；契约启动检查失败时明确停止，不降级为固定演出。
- [x] 真实 6 友军 + 6 敌军一一绑定视觉槽位；南路由真实反装甲班承担；没有第二普通步兵、敌装甲演员或额外逻辑演员；步兵子成员保留父演员 ID。
- [x] 新增固定分段时间映射、权威状态、效果导演、确定性移动、镜头、Canvas renderer、绝对取帧和文本状态接口；120 anchors 全调度、71 required 恰好一次、35 秒最终状态严格等于 Fixture。
- [x] 新增 `contract-driven-victory-demo-test.mjs`，85 项通过；覆盖契约/Fixture 只读、槽位、锚点、FIRE/DAMAGE/REPAIR/DESTROY 语义、最终 HP、确定性和本地页面入口。
- [x] 真实浏览器完整取帧并检查：10 张截图 SHA 全部不同，0 秒 12 演员、35 秒 victory/captured/5 个友军存活/1 辆我方坦克残骸，无 console/page error；Manifest 记录实际时间与状态。
- [x] 按规定顺序回归：正式 npm 627、五组沙盒 214、适配器 76、完整性 85、Fixture check、跨进程 8/8、契约演示 85 全部通过。
- [x] 完成 `STAGE8-2D-B-DELIVERY.md`；生成 `iron-command-stage8-2D-B-contract-victory-demo.zip`；保持正式项目与现有 8.2D-A.3 交付成果边界不变。

# Stage 8.2D-B.1 progress

- [x] 新增 `repair-choreography.js` 与 `visual-bounds.js`：5 个真实维修锚点按维修车/目标分组，按目标朝向计算接触位置；维修车中心距目标 55～82 px、包围盒不相交、机械臂端点 ≤6 px、火花 ≤8 px。
- [x] 新增 `projectile-geometry.js`：rifle/light tracer/coax/cannon/rocket 全部使用 ≤40 px 的短弹道段，保留火箭曲线头部和短生命周期；renderer 移除 source→target 全长亮线。
- [x] 新增 `presentation-status-resolver.js`：authority 只保存事实，表现状态独立解析；35 秒普通步兵/反装甲班 holding_objective、侦察车 scanning、领头坦克 destroyed、支援坦克 damaged_overwatch、维修车 damaged_support_holding，临时状态全部收束。
- [x] 在 13.867445、19.408322、24.1、28.199851、32.991304、35 秒完成精确取帧检查；新增 11～15 号截图，更新 15 张图 Manifest，浏览器 console/page errors=0。
- [x] 新增 `contract-demo-visual-integrity-test.mjs`，135 项通过；B 原有契约演示测试保持 85 项通过。
- [x] 保持正式边界哈希 `2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab` 不变；完成 `STAGE8-2D-B-1-DELIVERY.md` 和 `iron-command-stage8-2D-B-1-visual-integrity-patch.zip`。

# Stage 8.2D-B.2 progress

- [x] 将 contract-demo 从单一 Fixture 改为参数化胜利模板，支持 `fixture`、`scenario-b`、`scenario-c` 三份真实合法胜利战报；默认仍为 Fixture，查询参数切换来源，不使用 localStorage。
- [x] 新增语义时间映射、胜利模板校验、角色表现策略、动态战报加载、动态场景生成和冻结弹道端点解析；结果映射固定为 35 秒，末个敌军展示时间不晚于 32.5 秒。
- [x] 最终角色状态按 alive/role/HP ratio 收束；维修组按真实锚点动态分组；FIRE/DAMAGE 使用冻结 launch/impact position，避免演员移动造成弹道漂移。
- [x] 完成主来源 15 张取证图及 B/C 各 3 张取证图；11 号图存在活动短弹道，10/15 同为 35 秒但 viewMode 与 SHA 不同；Manifest 记录来源、时间、锚点、活动弹道和 PNG SHA。
- [x] 新增 `contract-victory-template-parameterization-test.mjs`，186 项通过；B 原有测试 85 项、B.1 视觉完整性测试 135 项通过；五组既有沙盒回归 28+30+40+63+53 全部通过。
- [x] 保持正式边界哈希 `2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab`；交付包附带未修改的适配器/正式边界只读依赖以支持脱离工作区自检；完成 `STAGE8-2D-B-2-DELIVERY.md` 与 `iron-command-stage8-2D-B-2-parameterized-victory-template.zip`。

# Stage 8.2D-B.2.1 progress
# Stage 8.2D-B.2.2 progress
- continuous layout validator: D/E/F each sampled 701 points at 0.05s increments with zero same-side, building, flag, or wreck intersections.
- route deconfliction: key-sample intersections 20/22/20 before, 0 after; route adjustments 13/14/12; authority actor/target/value, HP, alive and victory/capture unchanged.
- process-tree verifier: controlled process groups, bounded close wait, SIGKILL/taskkill /T escalation, and port release checks.
- browser evidence: regenerated 10 D/E/F screenshots; Manifest has actual time, source, anchor/projectile counts and PNG SHA; browserErrors=[] and sha256Unique=true.
- new regressions: contract-route-deconfliction-test 32/32 and delivery-verifier-process-test 15/15.
- formal boundary SHA-256 remains 2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab; final package and self-contained output are produced by the B.2.2 builder.

- [x] 新增 `dynamic-route-registry.js`、`reserve-slot-policy.js`、`slot-layout-validator.js`；补齐 `friendly_south_infantry_assault`，未知槽位显式报告 `unknown_template_slot`，计划不再使用 `(640,400)` 静默回退。
- [x] route registry 改为每个演出计划自有，固定路线与动态 reserve 路线均带 side/category/source/finalPosition；位置、维修和弹道解析使用计划路线。
- [x] 生成 D/E/F 三份原始正式胜利报告：D 双普通步兵、E 三普通步兵含 `friendly_reserve_1`、F 无维修车；保存 `sourceKind=formal_solver_raw`、完整 scenario、`rebuildHash`。C 明确标记为 `transformed_identity_fuzz`。
- [x] 新增 `contract-victory-layout-generalization-test.mjs`，覆盖南路步兵、动态 reserve、无维修、未知槽位、路线完整性与最终权威状态。
- [x] 完成完整项目封包 `iron-command-stage8-2D-B-2-1-complete.zip`、构建脚本、自包含验证器、D/E/F 浏览器截图与最终回归；布局泛化 38/38，最终 ZIP SHA-256 以交付构建输出为准。

# Stage 8.2E-A progress

- [x] 新增 `js/battle-presentation/` 正式侧车：report adapter、参数化计划缓存、权威时间桥、render state、Canvas renderer、路由和诊断。
- [x] 正式页面旁路只读取 `activeBattle.report`；准入严格限制为 `border_road` + `victory` + 合约/计划/模板全部通过；不读取 `experiments/`，不改正式业务结算语义。
- [x] 接入 `main.js` 生命周期：派遣、逐帧播放、结算、返航、跳过返航、读档和回到基地均清理/复用同一演出缓存；保留旧 BattleRenderer 兼容路径。
- [x] 增加 session-only 模式选择器：auto / legacy / contract；实际模式仅 `contract_road_victory` / `legacy`；失败只记录一次并安全回退。
- [x] 新增正式动态测试 100 项与正式页面集成测试；旧全量回归保持通过。
- [x] 完成正式页面浏览器取证：9 张截图、battle/report ID、模式、elapsed、result、SHA-256 Manifest，动态计划首次构建 1 次且后续取帧命中缓存，浏览器错误为 0。
- [x] 新增自包含构建/验证脚本与 `STAGE8-2E-A-DELIVERY.md`；正式边界哈希记录在 `tests/stage8-2E-A-boundary.json`。
- [ ] 下一阶段：根据正式页面验收反馈决定是否继续扩展非胜利战报的专用表现模板；本阶段不扩大契约模板准入范围。

# Stage 8.2E-A.1 progress

- [x] 正式HUD改为游戏内文案，默认隐藏实验标题、report ID、seed 和 authority 诊断。
- [x] 新增报告指纹与完整缓存键；读档、新游戏、battle:closed、活动战斗对象/指纹替换均显式清理或重建旁路状态。
- [x] renderState 改为显式 runtime 输入；返航同步移动友军车辆、步兵中心和全部步兵成员，敌军/残骸/权威HP保持不变。
- [x] 新增会话级持久回退与统一 renderedMode/frameId 状态；渲染异常不再逐帧重复尝试。
- [x] 新增零依赖 Chromium/CDP 正式取证，真实正式 dispatch 生成包含维修锚点的活动战斗，自动生成11张截图和增强Manifest。
- [x] 新增阶段8.2E-A.1测试、沙盒加固测试、边界哈希和最终ZIP自包含验证脚本。
