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

# Stage 8.2G-C.1.1a progress

- [x] Added the unique production `normalizeVisualUnitClass` authority, including `enemy_at -> anti_armor_infantry` and procedural enemy faction-safe fallback.
- [x] Unified Renderer/metrics/evidence around `ActorFinalDrawGeometry` and added actual final geometry fields to browser evidence.
- [x] Cover advance now carries deterministic sampled `presentationRoutes`; environment clearance consumes those route segments. 20 victory + 20 defeat seeds sampled at 50ms with zero visual-center violations.
- [x] Added asset runtime readiness proof, six current-code browser frames, five tamper cases, C.1.1a Node verifier and package-gate scripts.
- [x] Preserved C.1.1 and B.1.1a regression/tamper gates; ordinary `npm test` pretest now logs and runs the C.1.1a tamper test.
- [ ] Remaining handoff: run the default clean-package verifier, inspect the final package hash, commit and push `agent/stage8-2G-C-1-1a-final-hotfix`.
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

# Stage 8.2E-A.2 progress

- [x] 新增可移植 Chromium resolver：环境变量、PATH、macOS/Windows/Linux 候选路径、结构化失败诊断、root `--no-sandbox` 与额外参数解析。
- [x] 新增托管浏览器/验证服务器进程：spawn/error 竞态处理、DevTools 超时、stderr 诊断、进程组终止、SIGKILL 回退、临时 profile 与端口清理、300 秒封包总超时和阶段输出。
- [x] 真实正式页面完成第二场独立 withdraw 战斗：前置占领后以五单位正式编队 dispatch，Manifest 记录 `withdraw`、恰好一个 `retreat`、`capture=false`、空奖励，auto 偏好自动回退 legacy。
- [x] A.2 生成 12 张 PNG；胜利模式切换与真实撤退证据 battle/report ID、结果、指纹、模式和 SHA 完全分离。
- [x] 新增 72 项 A.2 与 37 项 A.2.1 专项测试；更新最终 ZIP 构建/解压后二次验证；因 `package.json` 新增验收命令，边界入口哈希更新为 `c2a87e086e3391eda24ccef3c9a7555f2b624d3f79a2ff01b9c3d3f62ddab733`，正式业务/表现文件未改。
# 阶段 8.2E-A.2.2

- 已完成最终验证器可伸缩调度、统一进程/服务器生命周期、全局超时有界清理和显式测试清单。
- `npm test` 实际通过：A.2 72/72、A.2.1 37/37、A.2.2 62/62。
- 成功浏览器证据仍为 12 张独立截图，Manifest 含 victory/withdraw 双战斗及零页面/控制台错误。
- 交付说明：`STAGE8-2E-A-2-2-DELIVERY.md`；最终包：`iron-command-stage8-2E-A-2-2-verifier-final.zip`。

# 阶段 8.2F-A

- 已新增隔离的通用战斗演出规划器纯数据管线：Intent、Scene Grammar、Force Groups、Dynamic Layout、Routes、Timeline、Presentation Actions 与 Universal Plan Validator。
- 覆盖正式配置的 open / road / fortified、3 个战役/3 个行动任务、3 种策略、victory / pyrrhic / withdraw / defeat / wiped；不接入正式主循环，不修改正式战报字段。
- 已由正式 `simulateBattle()` 生成 72 条 canonical + 500 条 deterministic fuzz，共 572 条合法战报；规划失败 0，演员数 3–18，友军 1–8，现有 6 个 missionId 全覆盖。
- 新增隔离 debug sandbox、浏览器文本接口 `window.selectUniversalScenario()` / `window.seekUniversalPlanTime()` / `window.render_universal_plan_to_text()`，以及 112 项规划器测试和 572 条 corpus 测试。

# 阶段 8.2F-A.1

- [x] 新增确定性位置采样、布局去冲突、障碍校验、维修编舞、结局编舞、接敌分析、权威最终状态与计划 fingerprint；正式 authority anchor/action、最终 HP/alive、result/capture 保持只读一致。
- [x] 修复同侧动态碰撞、撤退仍指向目标点、失败结果错误 secure_objective、维修车死亡后继续移动、convoy 非权威场景物件及 per-actor final state 缺失。
- [x] canonical 扩展至 120，deterministic fuzz 扩展至 1000；友军兵种序列 661 种；覆盖初始损伤、经验、维修、敌装甲、发现/伏击/高威胁正反样本；计划/连续布局/语义失败数组全部为空。
- [x] 新增 input stability、semantics、continuous layout、delivery 四组专项测试；`npm test` 已接入并保持严格失败即停。
- [x] 动态 debug 证据改为 12 个实际不同时间点，Manifest 记录 fingerprint、请求/实际时间、位置哈希、活动动作、结果与 PNG SHA；A.2.4 官方浏览器证据重新执行并完成三方 evidenceRunId 收口。
- [x] 完成 `STAGE8-2F-A-1-DELIVERY.md`、自包含 ZIP 验证器与最终包 `iron-command-stage8-2F-A-1-universal-planner-hardening.zip`。

# Stage 8.2F-B.0 progress

- [x] 修复 coverage dashboard 对真实 coverage schema 的读取；页面显示 terrain/mission/strategy/result/roster 计数，不再出现 `undefined`。
- [x] 写入确定性的 mission×result 矩阵：30 个组合中当前 26 个有样本，明确列出 4 个未观察组合，不过滤失败或伪造覆盖。
- [x] canonical 语料固定保留 `convoy_escort` 的 victory / withdraw / wiped 严格取证样本，并保护这些样本不被后续策略均衡替换。
- [x] 浏览器取证谓词改为任务与结果双重精确匹配；12 张截图 Manifest 语义与文件名一致，pageErrors/consoleErrors 均为空。
- [x] 页面状态明确区分 120 条 canonical reports 与 1000 条 fuzz specs；Playwright 客户端已打开页面并检查截图，无新增控制台错误。
- [x] 专项测试与完整 `npm test` 均通过；1120 条规划语料、1123 条连续布局检查、12 张浏览器证据均完成回归。
- [x] 重建 `iron-command-stage8-2F-A-2-universal-spatial-final.zip` 并通过自包含解压验证；封包含 345 个文件，SHA-256 为 `4c4f80209a2a2e436c69dcb6e4cff9c718e3ae3ba25f76bf8549b5b8f9969030`。
- [x] B.1：通用规划器正式 runtime adapter、render state、缓存和 production renderer 已接入显式 universal 旁路；auto 默认策略保持 A.2 兼容。

# Stage 8.2F-B.1 progress

- [x] 新增正式通用 adapter：只读取 `activeBattle.report`，以 universal plan validation、空间校验和报告 fingerprint 作为准入门槛；不写回战报或结算状态。
- [x] 新增通用 render state：权威事件按时间推进 HP/alive，最终状态与正式报告逐演员一致；返航仅移动友军视觉位置，敌军、残骸和权威状态保持不变。
- [x] 新增 session-only universal plan cache、通用 Canvas renderer、HUD 和 `universal_battle` text state；正式代码不引用 `experiments/` 或 fixture 资源。
- [x] 主路由接入显式 `universal` 旁路；`auto` 保持既有 contract → legacy 行为以避免改变 A.2 正式证据，universal 渲染异常一次性回退 legacy。
- [x] UI 演出选择器支持 `auto / legacy / contract / universal`；主页面调试接口兼容 universal plan/timeline 和 render state。
- [x] 新增 `stage8-2F-B-1-test.mjs`，adapter、四类结果、缓存、返航、路由回退和生产边界共 12 项通过。
- [x] 真实 Chromium Canvas smoke、完整 `npm test`、解压后自包含回归和最终封包验证均通过；B.1 仍不改变正式 `auto` 默认策略。
- [x] 完成 `iron-command-stage8-2F-B-1-universal-sidecar-final.zip`；封包含 353 个文件，120 canonical、1000 fuzz，SHA-256 为 `05847b1f403baff82f5036bccd1bf1b32d19bb30adff9ca9d23f4ba5b61bafd4`。

# Stage 8.2F-B.2 progress

- [x] Added deterministic formal universal camera module with overview, focus, impact and result modes; automatic camera is bounded to the zoomed map viewport.
- [x] Expanded formal universal render state with member formations, facing/status, scene-object visual semantics, authority effects, active actions, outcome choreography and camera state.
- [x] Replaced the B.1 placeholder Renderer with layered terrain, zones, routes, obstacles, infantry, anti-armor infantry, MBT, scout car, repair vehicle, enemy forces, wrecks, mission objects, tracers, impacts, repair welding, destruction and objective-ring visuals.
- [x] Preserved `visualKind` for mission objects so control nodes, salvage sites/teams, search sectors and convoy vehicles render by mission semantics without changing spatial or authority types.
- [x] Implemented explicit camera forwarding through the formal router while preserving the existing `auto` contract/legacy selection boundary.
- [x] Added `tests/stage8-2F-B-2-test.mjs` (8/8), browser smoke page `tests/browser/universal-renderer-b2-smoke.html`, and `build:stage8-2F-B-2`.
- [x] Real Chromium Canvas smoke passed for salvage交火 and wiped结局 frames; page errors 0, text-state errors empty, and the zoom-edge black-band issue was fixed and rechecked.
- [x] Full `npm test` passed; planner/corpus/continuous/spatial/semantic regressions passed: 112/112, 1120/1120, 1123/1123, 12/12, 63/63; delivery builder passed in workspace and extracted package.
- [x] Final package: `iron-command-stage8-2F-B-2-universal-renderer-final.zip`, SHA-256 `1209742da99ea0c212c2f9d8921c9e8242eca222282d5247c1572d18531c0f6e`, 9,306,028 bytes, 357 entries.

# Stage 8.2F-B.3 progress

- [x] 新增生产侧静态覆盖矩阵 `universal-coverage-matrix.js`：6 个 mission × 5 个 result，共 30 格；26 格正式可观测、4 格明确保持 unobserved，不导入 sandbox `coverage.json`，不删除或过滤失败样本。
- [x] 收口正式 `auto` 路由：已覆盖且非契约优先的矩阵格默认进入 `universal_battle`；`border_road/victory` 保留既有契约 Renderer 优先；未观测/未知格回退 legacy；显式 `universal` 仍可用于验收与诊断。
- [x] 诊断状态新增覆盖决策、默认通用尝试/成功计数；契约优先格不计入通用默认尝试，避免统计语义误报；通用 Renderer 异常继续一次性、有界回退。
- [x] 正式浏览器取证重新生成 12 张截图：胜利契约优先，withdraw 活动/返航帧为 `auto → universal_battle`，返航结束清理 active battle；pageErrors/consoleErrors 均为 0。
- [x] 新增 B.3 矩阵测试 9/9、默认通用浏览器烟测；官方 Playwright Canvas smoke 已检查 operation 与 withdraw 场景，文本状态 errors 为空、通用 HUD/地图/单位/路线正常显示。
- [x] A.2.4 动态证据输出改为读取当前 run 的 A.2.4 文件，evidenceRunId 与 manifest/浏览器输出三方一致；A.2.4 37/37，B.1 12/12，B.2 8/8。
- [x] 全量 `npm test` 与 B.3 builder/抽取包回归通过：1120 plans、1123 continuous layout、120 obstacle plans、120 performance plans/1742ms、delivery/slim verification 均通过。
- [x] 最终包：`iron-command-stage8-2F-B-3-formal-coverage-default-final.zip`；SHA-256、大小以最终构建 stdout/外部校验值为准，清单哈希与抽取包回归均通过。

# Stage 8.2F-B.4 progress

- [x] 正式通用/契约 Renderer 改为保持 16:9 比例的响应式 viewport：按实际 Canvas CSS 尺寸、DPR、缩放和 letterbox 偏移绘制，避免窗口变化时拉伸或错位。
- [x] 新增正式视野交互：左键/触控拖动、滚轮缩放、双击复位；手动观察会关闭自动镜头跟踪并在 `render_game_to_text`/诊断状态中标记 `manual=true`。
- [x] 手动相机受世界边界和缩放范围约束，覆盖 operation、victory、withdraw、wiped 等不同任务/结果和敌我兵力配置；正式主循环新增 reset/interaction 调试 API。
- [x] 新增 B.4 专项测试 5/5 与响应式浏览器烟测；官方 Playwright 检查通用开阔地、withdraw、wiped 及契约公路胜利，真实鼠标拖动三类配置通过，双击复位通过，console/page errors 均为 0。
- [x] 完成全量 `npm test`：阶段 3～8.2F-B.4、1120 条规划语料、1123 条连续布局、空间/维修/车队/障碍/残骸等回归全部通过；正式浏览器证据重新生成并通过三方 evidenceRunId 校验。
- [ ] 可选增强：在正式 UI 叠加显式“复位镜头”按钮和拖动提示；当前双击复位与 `window.__IRON_COMMAND__.resetPresentationCamera()` 已可用。

# Stage 8.2F-B.5 progress

- [x] 重设计正式通用战术空间：废弃矿区使用三条带掩体、绕行点、友军集结线/火力线/目标接近线；公路和防御阵地保留各自的道路/突破口语义。
- [x] 单位不再从部署点直接沿直线进入攻击：首轮火力前先经过侦察、集结、掩体和火力线；路线与场景障碍通过动态空间校验。
- [x] 自动镜头在开局/接敌阶段保持全战场可见，修复缩小镜头时地图偏移；战术火力线和重掩体采用低干扰标记。
- [x] HUD 收缩为上下边缘窄条；战斗期间隐藏基地视图 chip、FPS、图例和画布提示；返航控件改为右下角窄栏，避免遮挡中央战术区。
- [x] 新增 `stage8-2F-B-5-test.mjs` 8/8，覆盖废弃矿区路线阶段、首轮火力前位移、三种地形、动态碰撞、HUD 和正式战斗壳层。
- [x] 掩体地物明确为 `soft_cover` 可通行语义；单位残骸保留生命周期、位置和渲染证据，但不伪装成硬地形阻挡，返航仍先横向脱离残骸再沿安全边缘撤出。
- [x] 正式布局器按战术 lane 均匀分配大兵力单位并受边界容量约束，修复 8 单位/多维修车配置在地图底边堆叠；1120 corpus、1123 continuous、120 obstacle、30 wreck 与性能回归全部通过。
- [x] 官方 Playwright 复查废弃矿区、公路撤离、防御阵地歼灭三种正式画面：HUD 不遮挡中央战区，文本状态 errors=0；最终 `npm test` 全部通过。
- [ ] TODO：可继续把单位选中/命令面板做成可折叠侧栏；当前本轮只收口正式演出层，不开放中途手动指挥。

# Stage 8.2F-B.6 progress

- [x] 修复首轮远距离互射：`universal-time-mapper` 将首次 FIRE/DAMAGE/DESTROY 等交战锚点延后到演出时长约 40% 之后，侦察/展开占据前段；战报源时间仍单独保留，正式结果与伤害权威不变。
- [x] 接敌点按首次交火目标所属 tactical lane 绑定，取消会把先手单位甩到无关通道的跨 lane 轮换；同通道仅保留受边界约束的小幅横向展开，低兵力样本不再停在部署线超远距离开火。
- [x] 三类地形新增正式 tactical soft-cover bands；每条接敌路线公开 `coverPropId/coverValue`，render state 在 approach/in_cover/fire_from_cover 阶段公开掩体保护状态，Renderer 绘制低干扰掩体标记和单位掩体环。
- [x] 修复 wiped/少兵力样本：存活敌军会沿集结、掩体、火力线继续推进，不再因结果已 wiped 把整条路线冻结在出生点；补齐残骸避障的双向角点回退和修复编舞后的最终路线重算。
- [x] 补齐多兵力/任务对象空间边界：公路南肩上移，为 convoy 留出底边机动走廊；convoy escort 的友军部署线避开车队初始 footprint；残骸明确为可穿越视觉证据，硬碰撞仍严格校验掩体、地形障碍和任务对象。
- [x] 新增 `tests/stage8-2F-B-6-test.mjs`：首轮火力时序、首轮位移与受控距离、掩体绑定/渲染状态、单兵覆灭推进共 5/5 通过。
- [x] 重新生成 120 条 canonical + 1000 条 fuzz 派生语料；1120 规划计划、1123 连续布局检查、120 障碍计划、30 残骸计划、6 车队计划和 120 性能计划均通过。
- [x] 官方 Chrome/CDP 取证重新生成 12 张截图；Manifest 与浏览器 stdout 的 evidenceRunId 一致，pageErrors=0、consoleErrors=0；完整 `npm test` 最终通过。

# Stage 8.2F-C.1 progress

- [x] 修复存档覆盖边界：显式“保存”写入独立手动槽位，静默自动保存只写自动续接槽位；战斗结算、生产完成和关闭页面不再覆盖战前手动存档。
- [x] “读取”按钮优先恢复手动槽位；启动初始化仍默认续接自动槽位；新游戏会同时清理两个槽位，导入存档会成为新的手动恢复点。
- [x] 新增正式 `battle-tactics.js`：根据敌我单位构成和策略确定步坦协同、装甲楔形、步兵展开线、反装甲后置警戒、维修支援等角色与通道。
- [x] 正式战斗求解器消费同一战术意图：坦克/步兵目标优先级、装甲掩护、防护与协同攻击修正均确定性生效；研究树保留九项结构，并由战术数据链、野战维护规程、扩展指挥网络逐级增强协同。
- [x] 通用 RTS 规划器和战区 UI 消费战报战术意图，正式报告显示队形与协同强度；不改变 authority report 的既有完整性字段和重建校验。
- [x] 新增 `tests/stage8-2F-C-1-test.mjs`：战前手动存档在战斗全灭/结算后可恢复、自动槽位与手动槽位隔离、步坦角色/研究增强与混编正式布局共 3/3 通过。
- [x] 修复正式公路模板中维修车接近/撤离路径的连续布局边界；混编步坦战斗在正式 Renderer 中的维修过渡不再穿过友军单位或建筑，并新增混编正式布局回归。
- [x] 重新生成并验证正式交付包 `iron-command-stage8-2F-B-3-formal-coverage-default-final.zip`：369 个条目、9,488,769 bytes，SHA-256 `1797455e8ea56e51c7ae5949f6631c66bbc86b4130a1fce87a5359b371730dcc`；工作区与解压包全量测试均通过。

# Stage 8.2G-A progress

- [x] 新增正式通用视觉场景模型：由正式 plan、时间和空间采样确定性生成 deploy/approach/contact/engagement/end 六阶段，以及 move/aim/fire/reload/hit/destroying/wreck 演员状态。
- [x] 新增视觉武器档案与派生射击计划：步兵小武器、反装甲火箭、侦察车机枪、坦克主炮、维修工具拥有不同节奏和特效参数；火力、弹道、命中、毁伤、残骸、烟雾和贴花由正式 authority anchors 驱动，不改战报。
- [x] 正式 Renderer 完成生产层/调试层拆分：默认隐藏路线、区域、碰撞形状和 Actor ID；调试 overlay 通过显式 API 读取同一 plan/render state 绘制，`render_game_to_text()` 同步暴露正式视觉摘要。
- [x] 完成废弃矿区混编胜利垂直切片：正式页面构建步兵、反装甲班、侦察车、两辆主战坦克和维修车，seed 1 取得 victory；十张阶段/模式/尺寸证据 PNG 哈希唯一，页面与控制台错误均为 0。
- [x] 新增 `tests/stage8-2G-A-test.mjs` 7/7、`tests/browser/stage8-2G-A-evidence.mjs`、`stage8_2g_a_developer_selfcheck.json` 与 `STAGE8-2G-A-DELIVERY.md`；完整 `npm test` 通过，含 1120 条通用规划语料。
- [x] 新增可复验 builder/verifier，封包过滤 node_modules、.git、缓存、临时输出、旧阶段截图和旧 ZIP；最终包名为 `iron-command-stage8-2G-A-production-visual-core.zip`。

# Stage 8.2G-A.1 progress

- [x] 将旧阶段测试中依赖的静态截图/输出迁移为随包 fixtures；保留失败样本和原有断言，不把独立审计 JSON 导入生产代码，也不通过过滤样本归零。
- [x] 收口闭合视觉状态机：`idle/deploy/move/turn/brake/aim/fire/reload/hit/destroying/wreck`；规划器动作不会直接泄漏到 Renderer 状态。
- [x] 新增事件/动作驱动的语义阶段解析：`deploy/approach/first_contact/main_engagement/critical_event/battle_end`，不使用固定百分比切片。
- [x] 射击演出固定开火源点、朝向、瞄准目标点和命中点；统一稳定深度队列，并对不同单位 footprint 做确定性分离。
- [x] 正式 Renderer 默认只显示生产层；debug overlay 通过显式入口叠加在同一时间/状态上，正式层移除原始路线、区域和碰撞调试标记，掩体改为实体化视觉结构。
- [x] 生成 10 张正式证据：7 张生产阶段、1 张同帧 debug 对照、2 张默认/窄窗口尺寸证据；manifest 阶段、语义阶段、锚点和生产/debug 一致性字段齐全，浏览器 page/console errors 为 0。
- [x] `stage8-2G-A-1-test.mjs` 通过；全量 `npm test` 通过，含 1120 plans、1123 continuous layout、120 obstacle、120 performance 等回归；干净解压包重新执行 `npm install && npm test` 与阶段专测均通过。
- [x] 最终包：`iron-command-stage8-2G-A-1-production-visual-core-hardening.zip`；SHA-256 `a8a731884abc72ed0b8bd55c766edebc2dd07b1e25638fb4a8cbc8e3c21dc67d`，26,164,951 bytes，433 entries，10 screenshots。

# Stage 8.2G-A.1.1 progress

- [x] 独立复现基线：上一轮 ZIP 干净解压后 `npm install` 成功；A.2.4 独立运行 37/37，PID 十次循环均 `allClean=true`；完整语料阶段未发现实际挂起，进程树显示为正常运行中的 corpus 子进程。
- [x] 新增全量测试 hard-timeout/evidence runner：每次记录开始/结束时间、Node/npm/OS、测试文件、总数、通过/失败/跳过、最慢测试、退出码、PID 与日志；clean extraction 证据已写入 `tests/evidence/stage8_2g_a11_full_npm_test.{log,json}`。
- [x] 完全迁移 debug 网格：Production Renderer 不再包含网格/路线/区域 debug 绘制，网格统一由 `universal-debug-overlay.js` 按开关构建；Scene Hash、状态签名和同帧 viewport 对照测试通过。
- [x] 新增三份结构不同的阶段 Fixture：`rapid-contact.json`、`long-approach.json`、`prolonged-engagement.json`；阶段边界随真实事件节奏变化，Resolver 不使用固定比例。
- [x] deploy 改为演员级路线/action 语义边界：由 staging route、首个推进/战术动作和 brake/turn 过渡决定；移除固定 2.8 秒判断，支持任意时间跳转与重复采样。
- [x] 收紧 footprint：步兵、反装甲、坦克、侦察车、维修车和残骸使用不同矩形/椭圆近似；普通单位阈值 `.90`、大型单位 `.96`，并对活动残骸做确定性局部分离；软掩体半透明化，保留演员可读轮廓。
- [x] 新增五阶段空间验证：部署、首次接敌、主要交火、关键摧毁、战斗结束，并在每个时刻前后 100ms 检查演员/残骸/障碍/边界/偏移/抖动/确定性，共 18 个结构化 frame。
- [x] 正式证据重生成 10 张：部署结束、首次接敌、主要交火、关键摧毁、战斗结束、debug 网格同帧、默认尺寸、窄窗口、footprint debug、clean-package-result；生产/debug 同 Scene Hash、同时间、同 viewport、同状态签名。
- [x] 完整 `npm test` clean extraction：3128 total / 3128 passed / 0 failed / 0 skipped；clean evidence duration 421318ms；Node `v25.2.1`、npm `11.6.2`、macOS arm64。
- [x] 最终 verifier 重新执行 clean `npm install && npm test`、A.2.4 37/37、A.1.1 专测并检查禁止文件；最终包 `iron-command-stage8-2G-A-1-1-production-visual-core-closure.zip`，SHA-256 `17f7dfe1176798b0d643581a871f4126de181a5618659e7a2e12127f96353b95`，26,261,256 bytes，444 entries，10 screenshots。
- [ ] 已知事项：提示词引用的 `stage8_2g_a1_independent_audit.json` 未在工作区或基线 ZIP 中提供，因此未被导入、替代或用于过滤失败样本。

# Stage 8.2G-B progress

- [x] P0 收口：统一当前阶段标签为 Stage 8.2G-B；射击证据补齐非空 `source/target/impact` 锚点、时间与稳定重复帧；正式状态公开 route/planned/pre-separation/visual 位置；加入真实 ±200ms jitter 与 wall-clock 统计。
- [x] 新增通用预计算 `universal-engagement-choreographer.js`：目标选择/切换、武器 cadence、reload、presentation-only shots、suppression、cover advance、covering fire、retreat 和 bounded limits 均由正式 plan/result/roles/routes 数据驱动，不修改 solver、HP、result、reward 或 save。
- [x] 新增 `universal-camera-director.js`：按 first contact、main engagement、critical hit、destroy、retreat、battle end 生成确定性镜头兴趣点；保留 manual override，Renderer 不承载求解或目标选择。
- [x] 正式视觉状态机与 Renderer 增加 `suppressed/take_cover/cover_fire/retreat/search_target` 表现；debug engagement overlay 显式叠加，生产层不显示调试路线/区域/Actor ID。
- [x] 新增胜利混编、掩护撤退、失败/全灭三份 engagement fixture；胜利切片覆盖 deploy、first contact、suppression、cover advance、target switch、authoritative hit、destruction、battle end；失败切片覆盖 line collapse、covering fire、last resistance、final destruction、wreck field。
- [x] 浏览器证据重新生成 21 张 PNG，manifest pageErrors/consoleErrors 均为 0；同帧 production/debug 的 presentation time、viewport、scene hash 一致，debug 仅增加 overlay。
- [x] 机器证据通过：authority solver/HP/result/event order unchanged；同 seed schedule fingerprint 一致、不同 outcome schedule 可区分；schedule 预计算且 per-frame target scoring/shot generation/retreat ordering 为 false，增长受限。
- [x] 阶段专测 `stage8-2G-B-test.mjs`：1/1 通过，victory shots=180、targetSwitches=30、withdraw retreatOrders=2、wiped friendlyAlive=0。
- [x] 工作区全量 `npm test`：3129/3129 passed，0 failed，0 skipped，exitCode=0，duration 564574ms；A.2.4 中的 FAIL 行是刻意触发的 timeout 分支并由对应 PASS 断言覆盖，不是 npm 失败。
- [x] 最终 ZIP clean extraction：`npm install && npm test` 3129/3129 passed，0 failed，0 skipped，duration 501788ms；A.2.4 与 Stage 8.2G-B 专测均通过，禁止文件检查通过。
- [x] 最终交付包：`iron-command-stage8-2G-B-deterministic-engagement-choreographer.zip`，486 entries，13,556,691 bytes，SHA-256 `2255f9d39adb9c8743af8e2b53de6a0fa0cfe546016022e06624c8e4f67db91f`，21 screenshots。
- [ ] 已知事项：用户提示词引用的 `stage8_2g_a11_independent_audit.json` 未在工作区或基线 ZIP 中提供，因此未导入生产代码、未替代独立审计，也未过滤其中的失败样本；当前结论是开发者证据与 clean verifier 通过，不宣称独立审计批准。

# Stage 8.2G-B.1 progress

- [x] 修复接战编排真实性：不再在 approach 预排满局部射击；按 first contact/main engagement/critical event 分配阶段、阵营、Actor 和武器族预算，胜利样本为 38 发（友军 23、敌军 15、4 个武器族）。
- [x] 新增显式 combat profile：`enemy_at` 使用反装甲火箭，`enemy_light_armor` 使用侦察车机枪族，维修/未知支援 Actor fail-closed，不再静默回退为 `infantry_light` 攻击者。
- [x] 射程、目标类型、存活状态、硬障碍/LOS 都是射击硬合法性条件；每个编排 Shot 带 legality 证据，`sourceFacingAtFire` 由 source→impact 弹道向量计算。
- [x] 压制查询改为 targetIds；source/target 集合分离。Cover Move 公开 fire hold 与 maneuver target station，正式视觉场景对 maneuverGroup 生成实际位移；撤退公开多点 presentation route、退出距离、后卫延迟和敌方朝向。
- [x] 新增事件驱动 `evidence-frame-resolver.js`、B.1 12 项专项测试、10 份机器证据、24 张 B.1 命名截图及语义封包 verifier；命中/摧毁/切换/撤退名称均绑定到真实 schedule/authority predicate。
- [x] Stage 8.2G-B.1 开发包 builder/verifier 已通过工作区与解压包语义门禁；包名 `iron-command-stage8-2G-B-1-engagement-correctness-hardening.zip`。
- [x] 逐文件墙钟 runner：43/43、0 失败、0 跳过，总墙钟 420895ms；原生 `npm test` 命令链与最终 ZIP 解压后的 `npm install && npm test` 均通过，clean 记录写入 `stage8_2g_b1_clean_package_test.json`。
- [x] 用户随后提供 `/Users/coolking70/Downloads/stage8_2g_b1_independent_audit.json`；该 B.1 独立审计基线结论为 `not_passed`，建议进入 B.1.1。文件仅作失败样本与回归参考，未导入生产代码、未过滤失败样本；因此 B.1 仍不宣称独立审计通过。

# Stage 8.2G-B.1.1 progress

- [x] Assignment phase slicing：同一 actor-target hold 可跨 first_contact、main_engagement、critical_event 继续产生 Shot；first_contact 使用较小预算，main/critical/retreat 独立计数并受上限约束。
- [x] Covering Retreat Fire：withdraw 样本生成合法 rear_guard cover-fire Assignment、6 发 retreat Shot、muzzle/projectile/压制链和延迟离场路线；普通主撤退组不抢占后卫预算。
- [x] 权威 Shot 朝向统一为 source→impact projectile vector；victory/withdraw/wiped 权威 Shot 最大角度误差 0°。
- [x] `at_infantry` / `enemy_at` 恢复为 infantry target class，反装甲武器族仍由 attacker profile 表达。
- [x] 新增实时 Chromium 证据脚本，不读取 Stage B/B.1 PNG 或 Manifest fallback；24 张 B.1.1 PNG 均由当前代码实时采集，并记录 resolver/capture 时间、sceneHash、stateSignature、semanticFrameId 和 PNG SHA-256。
- [x] `npm test` 正式纳入 B.1 与 B.1.1；新增 B.1.1 专项测试、机器证据、强绑定 verifier、封包卫生检查和外部 clean package hash 报告。
- [x] 工作区 `npm test` 与最终 ZIP clean extraction `npm install && npm test` 均以 exitCode=0 完成；B.1 `12/12`、B.1.1 `20/20`、浏览器绑定 `24/24`、禁止项 `0`。
- [x] 最终交付包：`iron-command-stage8-2G-B-1-1-phase-continuous-fire-evidence-closure.zip`，SHA-256 `4c21bd2f1030e1fc91244c5d598c3c42445de94a447d02cd063144cbd8bd4c74`，34,516,188 bytes；外部 clean report 写入 `stage8_2g_b11_clean_package_test.json`。
- [x] 已读取并登记 B.1 独立失败基线：审计指出 B1/B2/B3/B4（旧证据复用、跨 Phase 射击中断、撤退后卫无实际射击、移动朝向冒充弹道朝向）以及 AT Infantry、PNG 语义绑定和封包链问题；B.1.1 的实现、专项测试和实时证据覆盖这些回归项。

# Stage 8.2G-B.1.1a progress

- [x] 以 `stage8_2g_b11_independent_audit.json` 与 tamper proof 作为 B.1.1 证据失败基线；不导入生产代码、不删除或过滤失败样本。
- [x] Machine Semantic Evidence 与 Browser Capture Manifest 已拆分为两个独立文件；浏览器只读取 Machine Evidence 的目标帧列表，不能回写或替代 Machine Evidence。
- [x] 新增跨 Node/Browser 共用的 canonical serializer、round(位置4位/角度5位/时间3位) 和同步 SHA-256 State Signature；Scene Hash 由当前 Universal Plan Fingerprint 重算。
- [x] Verifier 逐帧比较 sceneId、seed、timestamp、sceneHash、stateSignature、semanticFrameId、Machine/Browser 状态快照和文件名对应 semantic predicate，并重新读取 PNG SHA-256/尺寸。
- [x] 新增 12 类篡改测试：错误 sceneHash、stateSignature、semanticFrameId、timestamp、事件语义、PNG、重复 PNG、Machine Evidence、Browser Manifest、fallback 标记和浏览器状态快照均被拒绝。
- [x] 当前代码托管 Chromium 实时生成 24 张 B.1.1a 截图；pageErrors/consoleErrors=0，时间误差≤16.7ms，唯一 PNG=24，浏览器失败无旧证据 fallback。
- [x] B.1.1a 专项 20/20；B.1 回归 12/12；B.1.1 回归 20/20；工作区全量 `npm test` exitCode=0，46 个 test files，clean extraction 全量 exitCode=0。
- [x] 最终 ZIP：`iron-command-stage8-2G-B-1-1a-evidence-integrity-hotfix.zip`；最终 SHA-256、大小和 clean verifier 结果以 ZIP 外部的 `iron-command-stage8-2G-B-1-1a-final-package-record.json` 为准，避免在 ZIP 内形成自引用哈希。
- [x] 8.2G-B 系列证据完整性热修已完成；后续可进入 8.2G-C，但独立审计批准仍需由外部验收方按新包重新执行。

# Stage 8.2G-C progress

## Stage 8.2G-C.1 · Production Visual Consumption & Evidence Hardening

- Implemented offline manifest consumption through a browser asset runtime with
  `drawImage`, deterministic procedural fallback, and hybrid tank rendering.
- Added production Draw Specs with minimum screen footprints, asset status, source,
  world size, fallback path and weapon presentation metadata.
- Added full route-polyline segment clearance checks and deterministic decal radius/
  rotation handling.
- Added C.1 machine/browser evidence with expected state recomputation, environment
  and destruction signatures, Draw Specs, semantic predicates, PNG hashes and dual
  tamper rejection.
- Added 20 browser frames across victory, defeat, asset, fallback and narrow-viewport
  cases. Browser capture reports no page or console errors.
- Added 20-seed route tests, profile mutation tests, seek determinism, authority
  isolation and 160 individually measured render samples with true nearest-rank P95.
- Final package build and clean-package verification completed; the external package record contains the final SHA-256 and byte size.

- [x] 以 `stage8_2g_b11a_independent_audit.json` 作为失败基线与回归参考；未导入生产代码、未删除或过滤失败样本。
- [x] 新增生产级 Environment Grammar、矿区语义分区、确定性布局、路线/目标/掩体净空和离线可替换 Asset Manifest；环境层只读正式 plan、routes、objective、cover、bounds 与 seed。
- [x] 新增持久破坏层：事件历史直接求值弹坑、烧痕、碎片、烟柱、尘土、残骸生命周期；支持 seek/rewind，同 seed 与时间可复现，并受粒子、烟柱、碎片和残骸上限约束。
- [x] 新增步兵/轻车/反装甲/坦克炮/侦察/维修等武器视觉档案，以及 Procedural/Sprite/Hybrid/Offline Fallback 资产管线；不调用外部生成 API。
- [x] 正式 Renderer 已接入环境、弹坑、烧痕、碎片、烟尘和残骸；生产默认不显示调试几何/Actor ID，default/narrow viewport 均保留战场可读性，战斗核心与权威结算冻结不变。
- [x] C 专项 `11/11`；机器证据 20 帧、浏览器实时 Chromium 20 张 PNG，scene/state/environment/destruction 签名强绑定，唯一 PNG=20，pageErrors/consoleErrors=0。
- [x] B 系列分段回归已通过：B/B.1/B.1.1/B.1.1a 及 universal presentation/spatial/repair/convoy/obstacle/wreck/slim/performance 测试均通过；工作区与最终 ZIP clean extraction 的完整 `npm test` 均 exitCode=0。
- [x] 最终封包 verifier：20/20 C PNG 哈希一致、唯一 PNG=20、pageErrors/consoleErrors=0、禁止项=0；clean install 后完整回归通过。
- [x] 最终 ZIP：`iron-command-stage8-2G-C-battlefield-environment-art-pipeline.zip`，SHA-256 `c204447ccf57f9f84b2b1d78397ecfc588f10310c5ef3c316594c46788a21671`，38,539,864 bytes，689 entries；包内同时保留 B.1.1a 回归所需 24 张历史截图与 C 当前 20 张截图。
- [ ] 独立审计方仍需按最终 C ZIP 重新验收；当前 `independent-audit.json` 仅为外部基线，不代表本阶段已获得独立批准。
# Stage 8.2G-D-A progress

- [x] Added ten offline self-authored PNG sheets: six formal faction/unit assets, two MBT turret component sheets, and two faction-specific MBT Wreck sheets.
- [x] Upgraded the offline asset manifest to v2 with provenance, eight-direction order, deterministic animation rows, world size, faction palette/mark and weapon muzzle anchors.
- [x] Added production deterministic direction/animation/sourceRect/muzzle resolver; no `Date.now()` or `performance.now()` in production animation.
- [x] Connected the formal Universal Renderer to current presentation state, viewport geometry, spritesheet frames, MBT Hull/Turret components, faction Wrecks, depth sorting and faction-safe fallback.
- [x] Added D-A Node coverage, seek/replay determinism, 12 current-code browser screenshots, runtime/fallback proof, screen-footprint and performance evidence, machine/browser verifier and 8-case tamper regression.
- [x] Refreshed C.1.1a machine/browser evidence after the shared animation clock and screen-metrics contract changes; C.1.1a verifier and tamper regression pass.
- [x] Added default npm/CI gates and clean-package builder/verifier entry points for D-A, with B.1.1a and C.1.1a regression retention.
- [ ] Remaining handoff: run the default clean-package verifier, inspect the final ZIP hash, commit and push `agent/stage8-2G-D-A-production-unit-art`.

# Stage 8.2G-D-A.1 progress

- [x] 以 `stage8_2g_da_github_independent_audit.json` 作为上一轮失败基线与回归样本；JSON 未导入生产代码，失败样本未删除或过滤。
- [x] Production Hull/body facing 与 Turret/aim facing 已分离；Tank draw spec、Renderer screen metrics 和 shot evidence 同时公开 Hull/Turret direction、sourceRect 与 `visualMuzzlePoint`。
- [x] 新增 fail-closed Semantic Frame Resolver 与文件级 predicates；12 个合成艺术语义帧和 1 个 `formal-unmodified` 正式矿区语义帧均由真实状态解析，不使用固定比例切片。
- [x] 新增机器证据与当前 Chromium 浏览器证据：13/13 帧、13 个唯一 PNG、pageErrors=0、consoleErrors=0，浏览器逐帧重新计算共享 semantic predicate，时间误差不超过 16.7ms。
- [x] 新增 authority facing/impact/time 不变检查、三类单位最终绘制几何炮口检查、hit/destroy/wreck 朝向和 direct/linear/rewind 确定性检查；正式 `miningVictoryReport()` 与合成艺术场景分离。
- [x] 新增 17 类 evidence tamper regression；错误 asset、方向、Hull/Turret、semantic frame/predicate、matched actor、muzzle visualStart、timestamp、reload 重标开火、PNG hash、重复 PNG 与 source report 均被 verifier 拒绝。
- [x] 新增 D-A.1 npm/CI gate、外部 ZIP builder/verifier 和 `STAGE8-2G-D-A-1-DELIVERY.md`；ZIP 不提交到 Git，最终 package record 放在 ZIP 外。
- [x] D-A.1 external ZIP 已完成 hygiene 与 clean package verifier：`npm install --ignore-scripts --no-audit --no-fund`、完整 `npm test` 均通过；最终包 SHA/字节数以 ZIP 外 `stage8_2g_da1_final_package_record.json` 为准。
- [x] 最终 D-A.1 本地 clean-package verifier、完整 `npm test`、浏览器证据与 17 类 tamper gate 均通过；已提交 `agent/stage8-2G-D-A-1-semantic-turret-closure`，独立验收仍需按最终外部 ZIP 重新执行。

# Stage 8.2G-D-A.1a progress

- [x] 读取 `stage8_2g_da1_final_head_reaudit.json` 作为失败基线；未导入生产代码、未删除或过滤失败样本。上一轮唯一阻断确认是 Infantry/AT 身体仍跟随 movementFacing。
- [x] 新增集中式 `presentation-facing-policy.js`：`turret_weapon`、`body_aims_weapon`、`movement_only`；Infantry/AT/light vehicle 在 aim/fire/reload/cover-fire 时身体与武器指向 aim，MBT 保持 hull/turret 分离，support vehicle 不自动瞄准。
- [x] Production Actor、Animation/Direction Resolver、Final Draw Spec、muzzle anchor、Universal Renderer screen metrics 统一暴露并消费 movement/aim/body/weapon/turret/shot facing；未修改 combat core、planner、choreographer、authority、environment、HUD 或 sprite art。
- [x] 强化 `infantry-fire`、`friendly-at-fire`、`enemy-at-fire` 谓词，逐 Actor 使用 `shot.actorId` 匹配的 active shot，重新计算 body error、Sprite directionIndex 和 muzzle facing；新增 5 类 D-A.1a tamper，全部拒绝。
- [x] D-A.1a Node/Chromium 证据：13/13 帧、13 个唯一 PNG、pageErrors=0、consoleErrors=0；覆盖友军/敌军 Infantry、友军/敌军 AT、友军 MBT hull/turret 分离、default/narrow muzzle 与 footprint。
- [x] D-A.1 原有 13 帧和 17 类 tamper 已按新谓词重生成并通过；官方 `develop-web-game` Playwright 客户端已检查正式页面，`render_game_to_text` 正常、无控制台错误。
- [x] D-A.1a 完整封包 clean verifier 已通过：ZIP SHA-256 `b5bb32b9c9beff297346b065af6953c6d6d2188332b1af29e068ed4cf948b1b8`，56,472,094 bytes，890 entries；clean install 后完整 `npm test` exitCode=0。
- [x] D-A.1a 浏览器证据、13/13 唯一 PNG、5 类新增 tamper、150 发 authority 不变性和 D-A.1/D-A/C.1.1a/B.1.1a 回归均已通过；GitHub Actions Run `31266612353` / Job `93125668996` 为 success，D-A.1a gate 已实际执行。
- [ ] 独立审计方仍需按最终 D-A.1a ZIP 重新验收；audit JSON 仅为失败基线和回归样本，不代表独立批准。

# Stage 8.2G-D-B progress

- [x] 以 `stage8_2g_da1a_independent_audit.json` 作为上一轮失败基线与回归参考；JSON 未导入生产代码，失败样本未删除或过滤。
- [x] 冻结 combat core、planner、choreographer、正式战报/奖励/结算/存档；新增 `body_mounted`、`independent_turret`、`unarmed` 仅作为生产视觉拓扑，不改变战斗逻辑。
- [x] 新增友军/敌方 Scout、友军 Repair、友军/敌方 Support 的离线确定性 PNG、8 方向动画矩阵、阵营色板/标记、维修动画与对应 Scout/Support/Repair 残骸；运行时不调用外部图像生成服务。
- [x] 生产 Renderer 接通选中、悬停、目标十字标记、选中单位 HUD、正式 HP/状态/武器/阶段/目标、Victory/Withdraw 结果和结算来源；默认与窄屏均受安全区约束，素材失败保留显式程序化回退。
- [x] 资产覆盖机器证据 100%；正式维修事件产生 `repair` 动画；报告权威 hash、奖励和结算均保持只读；新增资产、拓扑、残骸、HUD selection/health/objective/result/responsive/performance 证据。
- [x] 当前 Chromium 真实页面生成 16 张 D-B PNG，唯一哈希 16、pageErrors=0、consoleErrors=0；覆盖全阵容、Scout、Repair、Support、掩体推进、撤退后卫、HUD、损伤、Victory/Defeat、窄屏和 fallback。
- [x] 12 类证据篡改回归全部拒绝；官方 `develop-web-game` Playwright 客户端已执行，正式页面 `render_game_to_text` 正常且无控制台错误。
- [x] D-B 测试已接入 npm 与 CI；完整 clean-package gate 已通过（隔离安装与包内 `npm test` 均 exitCode=0），外部 ZIP `iron-command-stage8-2G-D-B-full-unit-art-hud.zip` SHA-256 `5275a6e6cdfd9505ef9cbf65e6a8a4267a1934c4673150c28a96e7e49e476278`，61,147,511 bytes，945 entries；当前 `stage8_2g_db_*` JSON 仍仅为机器证据，未作为正式运行资源。
- [ ] 待完成：提交、推送并等待 GitHub Actions；独立审计方仍需按最终 D-B ZIP 重新验收。

# Stage 8.2G-D-B.1 progress

- [x] 以 `stage8_2g_db_independent_audit.json` 作为 D-B 失败基线与回归样本参考；未导入生产代码、未删除或过滤失败样本。
- [x] 冻结 solver、HP/damage/repair/destroy authority、target assignment/switch、shot schedule/timing/facing/impact/position、planner、routes、choreographer、suppression/cover/retreat/rear-guard、result/reward/settlement/save；本阶段只修改 presentation consumption、evidence、responsive CSS 和验证器。
- [x] 集中式 presentation capability filter 已加入 `presentation-facing-policy.js`，并由 Universal Visual Scene、Animation Resolver、炮口/弹道/特效消费共同使用；unarmed 的 aim/fire/reload/cover_fire 会 fail-closed 到 idle/move/retreat，正式 repair anchor 只绑定对应 repair actor。
- [x] 正式 victory、formal withdraw/defeat、synthetic art 三条完整 50ms 时间轴扫描：2045 个状态样本，禁止状态/动画/武器消费违规 `0`，最大验证扫描 `11.56ms`，报告输入稳定，planner/solver/choreographer 未修改。
- [x] 生产语义解析器支持 scout-move、scout-fire、repair-action、support-unarmed、cover-advance、retreat-rear-guard；6 个机器语义帧全部解析，formal repair/cover/retreat/真实 shot actorId 均有绑定；fail-closed 与浏览器重算启用。
- [x] D-B 原有 16 帧已重生成并修正旧语义文件名/时间：scout-move、scout-fire、repair-action、cover-advance、retreat-rear-guard；旧浏览器证据同步执行 production semantic predicate 校验。
- [x] D-B.1 Chromium 当前代码证据 10/10 帧、10 个唯一 PNG、8 个语义帧；pageErrors/consoleErrors `0`，时间绑定误差≤16.7ms，机器/浏览器 state signature 与 semantic actor binding 一致。
- [x] Responsive 真实几何：480×720 与 390×844 均 battlefield width ratio `1.0`、stage 全宽、panel `display:none`、battle-first layout；窄屏 HUD/result 仍位于战场画布安全区。
- [x] Production DOM leak scan：禁止字符串命中 `0`；内部 stage label 不进入生产可见 DOM，debug render/text 仍保留 `stageLabel` 与 debug overlay 状态。
- [x] D-B.1 tamper matrix `12/12` 拒绝：unarmed fire/authority、semantic relabel/signature/fake repair、missing/duplicate PNG、narrow sidebar/geometry、production leak/debug diagnostics。
- [x] ordinary `npm test` 通过并通过 `posttest` 纳入 D-B.1 浏览器/篡改链；CI 新增 `npm run test:stage8-2G-D-B-1`；clean install + package 内普通 `npm test` verifier 通过。
- [x] 最终 ZIP：`iron-command-stage8-2G-D-B-1-semantic-responsive-closure.zip`，SHA-256 `e87f06a63d8770482501022c51ca6f6c20f27f6eb858bd80dad1192cbd8b9007`，62,690,107 bytes，980 entries；ZIP 不作为 Git 运行资源提交，外部 record 保留 package hash。
- [ ] 独立审计方仍需按最终 D-B.1 ZIP 重新验收；审计 JSON 仍仅是外部失败基线，不代表独立批准。

# Stage 8.2G-D-B.1a progress

- [x] 以 D-B.1 commit `758e921df6360e1636a6f65e1be108b769d38559` 为基线；继续冻结 Formal Repair Authority、solver、planner、choreographer、routes、combat core、HUD art 与 responsive CSS。
- [x] 新增 Presentation-only `presentation-action-attribution.js`：`actorId` 精确归属、`actorIds` 列表归属、`scope:'global'` 显式全局归属；缺少 actor id 不再默认广播。
- [x] Formal Repair Event 只让合法 Repair Vehicle Source 进入 `repair` / `repairing` / `animation=repair`；Target 暴露 `being_repaired` / `repairTargeted`，保持自身 `idle` 等单位动画，不再被误判为 Source。
- [x] Render State 的 `formalRepairEvents` 完整暴露 `id/t/actorId/targetId/sourceActorId/targetActorId/amount/sourceType/targetType`；Repair Predicate 同时绑定 Source、Target 与 Formal Event，并加入缺 Source/Target/错误 Source 负向测试。
- [x] Retreat-Rear-Guard Predicate 现在必须同时存在独立 `retreat_route` Actor 与 `rear_guard_hold` Actor；只保留任一角色的篡改样本均失败。
- [x] 新增 D-B.1a 时间轴扫描：Formal Victory、Formal Withdraw、Synthetic 三场景共 13 个 Repair Event，50ms 扫描异常 Repair 动画 `0`。
- [x] 当前 Chromium 证据 7/7、唯一 PNG 7、pageErrors/consoleErrors `0`；Repair 截图四层绑定 `Screenshot = Browser Selection = HUD = Repair Source`，Formal Target 绑定一致；480/390 responsive 与 production leak 回归通过。
- [x] 新增 action attribution、Repair attribution、Repair semantic binding、Retreat binding、Authority hash、12 类 D-B.1a tamper 与 developer selfcheck；D-B.1a tamper `12/12` 拒绝。
- [x] `npm test`（含 posttest D-B.1a）、D-B.1/D-B/D-A.1a/D-A.1/D-A/C.1.1a/B.1.1a 回归及默认 clean package verifier 均通过。
- [x] 最终 ZIP：`iron-command-stage8-2G-D-B-1a-repair-semantic-final.zip`，SHA-256 `b878936c0736869871219ebd000730717e86ceec1ecd6a714b03c77f2129fc86`，63,893,388 bytes，1010 entries；ZIP 内无 stale final package record，最终记录位于 ZIP 外。
- [x] 已提交并推送 `agent/stage8-2G-D-B-1a-repair-semantic-final`，commit `8f8557239be3f3e7566dbd8179cf9c38fe176620`；Draft PR #5 以 `agent/stage8-2G-D-B-1-semantic-responsive-closure` 为 base。
- [x] GitHub Actions Run `31276414890` / Job `93150552033` 成功，D-B.1a gate 实际执行；最终 clean-package verifier 的 clean install、包内普通 `npm test`、posttest、证据/封包卫生均通过。
- [ ] 独立审计方仍需按最终 D-B.1a ZIP 重新验收；audit JSON 仍仅是失败基线和回归样本，不代表独立批准。

# Stage 8.2G-D-C progress

- [x] 以 D-B.1a commit `971d3280bc8df688f24ec1489c31c68550d92d76` 为基线；本地未发现 `stage8_2g_db1a_independent_audit.json`，未导入任何 audit JSON，也未删除或过滤失败样本。
- [x] 新增 Presentation-only `presentation-effects-runtime.js`：muzzle flash、rocket trail、small-arms/rocket/tank impact、damage smoke、destroy sequence、wreck fire/smoke、repair beam/spark、deterministic camera feedback、battle intro/outro 和 audio cue hooks。
- [x] 所有 transient 由 formal shot、impact/damage/destroy/repair anchor 或明确 phase 归因；没有 `Math.random`、`Date.now`、`performance.now` 的效果决策，seek/rewind/replay 使用相同 presentation seconds 可重现。
- [x] Universal Render State 暴露 effect inventory、camera feedback、transitions、audio cues、determinism metadata；Renderer 增加 rocket/impact/smoke/fire/repair 绘制与 screen-space transition，不改变 Formal Solver、HP/damage/repair/destroy authority 或 Formal Repair Authority。
- [x] 生产语义谓词新增 infantry muzzle、AT launch、MBT cannon、三类 impact、damaged smoke、destroy/wreck、repair effect、battle intro/victory/withdraw outro；Repair 仍严格保持 sourceActorId/targetActorId 绑定。
- [x] D-C machine evidence 14 帧、Chromium browser evidence 14 张唯一 PNG，覆盖 infantry/rocket/MBT muzzle、三类 impact、damaged vehicle、destroy、burning wreck、repair、heavy battle、intro/victory/withdraw outro；pageErrors/consoleErrors `0`，浏览器逐帧重算 semantic predicate 与 state signature。
- [x] 新增 18 项 tamper regression：shot/position/family、fake destroy/wreck、Repair source/target、camera event/amplitude、audio event、transition label、duplicate/hash/signature、authority/performance 篡改均被拒绝。
- [x] 性能预算与边界通过：max effects `96`、smoke particles `32`、camera translation `5`；三场景平均 render samples 约 `3.56–4.98ms`，D-C deterministic/authority/performance checks 均通过。
- [x] 官方 `develop-web-game` Playwright client 已执行；`render_game_to_text` 正常写出 state，未产生 console/page error；D-C 真实浏览器截图已用图像检查。
- [x] D-C npm/CI gate、clean package builder/verifier 已接入；CI 在 D-B.1a 后执行 `npm run test:stage8-2G-D-C`，完整 extracted `npm test` exitCode `0`。
- [x] 最终 ZIP：`iron-command-stage8-2G-D-C-battle-polish.zip`，SHA-256 `25500d32d82b89a582c6cf5c225cfa5631a4cc2202fe788f1aa063a5d8878c86`，`66,325,942` bytes，`1058` entries；ZIP 无 ZIP、`.git`、`node_modules`、browser profile 或 stale final record，clean install 与包内 `npm test` 均通过。
- [ ] 独立审计方仍需按最终 D-C ZIP 重新验收；本地缺失的 D-B.1a audit JSON 仅记录为未导入基线，不代表独立批准。

# Stage 8.2G-D-C.1 progress

- [x] 以 D-C commit `5071428a479c6d095e377ddb8f73c5c84017f73c` 和上一轮 ZIP SHA `25500d32d82b89a582c6cf5c225cfa5631a4cc2202fe788f1aa063a5d8878c86` 为失败基线；audit JSON 未导入生产代码，失败样本未删除或过滤。
- [x] `normalizeEffectWeaponFamily` 改为 exact allow-list：Scout `scout_machine_gun/scout_autocannon -> scout_autocannon`，MBT `tank_main_gun/tank_cannon -> tank_cannon`，未知输入 fail-closed 为 `generic`；正式 shot/report 只读且未被修改。
- [x] 修正真实回归样本：`choreographed_shot_102` 为 `unit_fixture-u-3` Scout，效果族为 `scout_autocannon`；真实 MBT 帧为 `unit_fixture-u-5 / choreographed_shot_113 / tank_main_gun / tank_cannon`；D-C-11 改为显式 `d-c-11-scout-fire.png`，D-C-03 保持真实 MBT。
- [x] 强化 Production-State verifier：从每个 scene 的正式 `sourceReport` 和当前 presentation code 重算 predicate、actor/shot/effect/wreck 归属、effect family、镜头、音频、transition、终局 cue、PNG SHA-256 与唯一性；浏览器新增终端检查和 wreck faction/orientation 绑定。
- [x] 新增 24 个 true-value tamper cases；所有用例 `declaredPassedPreserved=true`，均被 verifier 拒绝；旧 D-C 18 项 tamper gate 兼容回归通过。
- [x] 性能闭环使用 20 次 warmup、每场景 120 次完整 `renderState.atTime()` 样本，覆盖 victory/withdraw/synthetic art；最终封包实测 p95 为 `3.869/3.305/4.709ms`，最坏 `4.709ms < 16.7ms`，effect/smoke/projectile/environment 统计已落盘。
- [x] Reduced Motion 运行态验证通过：相同 effect/audio/result 保留，camera amplitude/offset/zoom 归零，`reducedMotionApplied=true`；确定性和 authority 不变检查通过。
- [x] D-C.1 npm gate、官方 Playwright client、Chromium 证据、强重算和解包级 package verifier 已接入；14/14 浏览器 PNG 唯一，pageErrors/consoleErrors `0`，package clean install 与完整 clean `npm test` 均通过。
- [x] 最终交付包：`iron-command-stage8-2G-D-C-1-strong-evidence-performance.zip`，SHA-256 `cfaa506764486963569499ccf9b99175f113a4417519dcd22bedabfea0f132e6`，`66,551,107` bytes，`1097` entries；ZIP 无自身 ZIP、`.git`、`node_modules`、browser profile 或 D-C.1 stale record。
- [x] 最终 head `d2afd98113c5410022df5ccc5bfd28c41977a4d7` 的 `core-regression` Run `31291989024` / Job `93190637568` 成功，D-C→D-C.1 均成功；PR #7 仍为 Draft、base/head 正确且 mergeable。

# Stage 8.2G-D-C.1 final delivery closure

- [x] focused `npm run test:stage8-2G-D-C-1`、普通 `npm test`、clean install 与无 `--skip-full` 的完整 package verifier 均通过；D-C.1 证据为 14/14 帧、14/14 唯一 PNG、24/24 tamper rejection，正式报告/Repair Authority 保持只读。
- [x] 首轮真实 `core-regression` 已完成：Run `31291451206` / Job `93189235124`，head `6a15193dabe2eac398e69dee61eba0efef416977`，D-C 与其后的 D-C.1 步骤均 `success`。
- [x] CI workflow 已固定为 D-C 后执行 D-C.1；selfcheck generator 会保留最终交付元数据中的真实 CI 记录与 `readyToCloseStage8_2G_D_C` 标志。
- [x] 最终元数据提交后的 head CI、最终 ZIP 与无 `--skip-full` 解包 verifier 均收口；`readyToCloseStage8_2G_D_C: true`、D-C closed、ready for next stage；无 D-C.2，独立审计 JSON 仍只作回归参考，未导入生产代码。

# Stage 8.2G-E-A progress

- [x] 以 D-C.1 baseline commit `d2afd98113c5410022df5ccc5bfd28c41977a4d7` 为实现基线；本阶段没有用户提供的 independent-audit JSON，未导入或伪造独立审计结论。
- [x] 正式战区派遣创建稳定 `ProductionBattleSession`：`battleSessionId`、`missionId`、`deploymentSnapshotId`、`sourceSaveRevision`、`formalReportId`、`formalReportHash/sourceReportHash`、`presentationState`、`settlementState`、`returnState` 均进入可迁移状态；身份只由 save revision、mission、部署快照哈希和序列号组成。
- [x] 部署快照使用浏览器同步 SHA-256 canonical hash；正式 presentation 继续消费同一份 formal report，session/activeBattle 的重复嵌入副本不能覆盖 `state.battleSessions` 的存档权威。
- [x] formal result/reward/loss/settlement writeback 保持原计算路径；新增带 hash 的 exactly-once settlement ledger，与战报、资源、单位、编队、战区、统计在同一内存事务中提交并支持回滚。
- [x] save revision 与 additive migration 已接入；旧存档无 session 时正常加载，历史活动战斗可补齐 session；运行中、正式完成、结算结果可见、结算后和返回基地阶段均可读档续接，损坏 session/report fail-closed。
- [x] 正式战报页增加只读回放入口；Replay 复用同一 session/report/ledger，不重新求解、不扣资源、不应用奖励/损失、不重复结算；debug/fixture origin 无法进入正式 settlement。
- [x] 新增 `tests/stage8-2G-E-A-test.mjs` 13/13；覆盖 session、deployment、formal report、settlement、save/reload/resume、replay、authority 与 9 类 tamper rejection，包含 settlement ID、部署 hash、source revision、session swap、debug origin、reward ledger 等回归。
- [x] 当前 Chromium 正式入口证据完成 11/11 唯一 PNG：建造兵营→训练单位→正式组建编队→战区派遣→手动保存/读取→正式结算→战报→只读回放→返回基地；`fixtureLoaderUsed=false`、`debugOverlayUsed=false`、pageErrors/consoleErrors 为 `0`。官方 `develop-web-game` Playwright 客户端亦已执行并检查真实页面 canvas。
- [x] 新增 E-A 强 verifier、机器证据、tamper 结果、developer selfcheck、delivery builder/verifier；`npm run test:stage8-2G-E-A` 与 stage5 99/99、D-C.1 focused gate 已通过；CI 已在 D-C.1 后追加 E-A focused gate。
- [x] 完整 `npm test` 通过（包含 posttest 的 D-C、D-C.1 与 E-A gate）；E-A focused integration `13/13`，D-C.1 strong evidence `24/24` tamper rejection，历史阶段回归全部通过。
- [x] 无 `--skip-full` 的 clean-package verifier 通过：隔离安装、包内完整 `npm test`、E-A focused/strong evidence、包卫生均通过；`cleanNpmTest=passed`，无 forbidden entries 或 stale final record。
- [x] 最终 ZIP：`iron-command-stage8-2G-E-A-production-loop-integration.zip`，SHA-256 `6aa48ffb8b0f599e749bae16b5fdc20ed35c414d602fc7e88d517831263cf2d8`，`69,151,145` bytes，`1136` entries，11/11 浏览器截图唯一且无 page/console errors。
- [x] 已提交并推送 `agent/stage8-2G-E-A-production-loop-integration`，commit `1360697`；Draft PR #8 以 `agent/stage8-2G-D-C-1-strong-evidence-performance` 为 base，head/base 正确且 mergeable。
- [x] GitHub Actions `core-regression` 推送运行 `31296262436` 与 PR 运行 `31296272892` 均 SUCCESS；后者完整执行 D-C、D-C.1 与 E-A，耗时 `13m42s`。
- [ ] 独立审计方后续仍需按 E-A 最终 ZIP 重新验收；本轮没有独立审计 JSON，E-A evidence JSON 只作运行证据，不作为生产资源。

# Stage 8.2G-E-A.1 progress

- [x] 以 E-A commit `58cb6c97fd2000fd6c7c7bb11a8e54e053c0ebac` 为基线；上一轮 independent-audit JSON 未在本地发现，未导入生产代码，失败样本未删除或过滤。
- [x] Replay 改为独立 read-only context：保留 source session/report/settlement binding，`activeBattleSessionId=null`，不复用或写入 canonical `ProductionBattleSession`。
- [x] Replay reload 迁移恢复后保持 canonical session hash、formal report hash、ledger hash 不变；formation 回到 idle，参与单位保持结算后的正式状态，Replay 不可 settlement。
- [x] 报告详情 render signature 增加 active battle/settlement 状态；正式返航后同一战报的“只读回放”按钮会真实重绘并启用，修复实际 UI 路径 stale disabled 问题。
- [x] 新增递归 save-diff：覆盖 object/array/identified-array/order/primitive，显式 ignored path 只有 `savedAt`；allowed paths 动态来自 Formal Settlement Plan，unexpected paths 不得硬编码归零。
- [x] 独立 strong verifier 重跑生产战斗、正式结算、Replay、真实 save diff 与 unrelated building/unit/research/theater preservation；不信任 evidence `passed` 字段。
- [x] 扩展 tamper：模型 24/24 拒绝，伪造 UI provenance、fake reload method/timeOrigin、fake production entry、dispatch/replay API shortcut、PNG hash 后总计 31/31 拒绝。
- [x] 真实生产 UI 浏览器证据：11/11 唯一 PNG；launch double-click session delta=1；dispatch/replay debug API 均未用于核心动作；running 与 replay 各完成一次真实 `Page.reload`，loaderId 与 `performance.timeOrigin` 均记录，page/console errors 为 0。
- [x] E-A.1 package scripts、CI workflow（E-A 后 focused/browser）、machine evidence、browser manifest、save-diff/replay/formation/reload/UI/authority/tamper/selfcheck 与 70 项 final report 已加入交付流程。
- [x] 原 E-A 13/13、E-A.1 focused 5/5、D-C.1 回归、完整 clean `npm test`、clean install、clean package browser rerun、strong/tamper verifier 均通过。
- [x] 最终 ZIP：`iron-command-stage8-2G-E-A-1-replay-persistence-closure.zip`；最终 SHA、bytes、entries、clean gate 见 ZIP 外 `stage8_2g_ea1_final_package_record.json`，ZIP 不作为 Git 运行资源提交。
- [ ] 独立审计方仍需按 E-A.1 最终 ZIP 重新验收；本阶段未进入 E-B。

# Stage 8.2G-E-B progress

- [x] 以 E-A.1 HEAD `17a965df9772ef0beb65b0e1d48c88c4671ae311` 为基线；Authority Freeze 保持，未导入或修改任何独立审计 JSON。
- [x] 新增 Mission / Deployment UI：战役与重复任务类型、资格/失败原因、权威成本与冷却、部署确认面板，以及真实 `buildDispatchSnapshot` 单位 HP/状态清单。
- [x] 确认派遣仍由核心层重新校验；新增同步 busy lock，双击只产生一个 battle session；冷却、资格、资源和 solver 失败路径保持零副作用。
- [x] E-A.1 verifier 加固为独立重算正向 `timeOrigin`、reason 覆盖、loader 唯一性；E-B verifier 额外校验部署快照语义、任务冷却、会话/战报/结算身份和 authority hash。
- [x] 真实浏览器证据覆盖 18 帧、4 次 `Page.reload`（deployment review / running battle / result / replay），真实 DOM click provenance、pageErrors/consoleErrors 均通过；部署确认与重复任务确认截图已用图像检查。
- [x] E-B focused Node 12/12；性能门禁 warmup 20、samples 120、p95 严格 `<16.7ms`；D-C.1 victory p95 继续作为回归检查。
- [x] true-value tamper `48/48` 拒绝，`passedFlagOnlyCases=0`，包含 fake reload 数值倒退/相等、reason 缺失、loader 复用、冷却、快照、会话交换、回放写入和 authority hash 篡改。
- [x] E-B 实现、E-A.1 review-flow 浏览器回归适配、机器/浏览器/strong/tamper/performance 证据均完成；最终 ZIP、无 `--skip-full` clean verifier 与 final-head CI 由本轮交付记录收口，独立审计仍待按最终 ZIP 复核。

# Stage 8.2G-E-C progress

- [x] 以 E-B final HEAD `b41ad940d8fab78038f1b1dedf5a404841b81401` 为基线；未导入任何 independent-audit JSON，失败样本未删除或过滤。
- [x] 完成离线窗口 fail-closed：非法、未来和回拨 `savedAt` 均为零秒；raw seconds、cap、consumed/remaining 与 `MAX_STEPS=4096` 截断元数据保持真实，部分窗口会保留未消费时间。
- [x] 完成 Exactly-once 离线结算、待阅报告迁移与 reload 保留；报告查看/关闭进入真实 UI 路径；活动正式战斗不推进 session/elapsed/report/ledger，正式结果不二次结算，Replay 保持 canonical session、编队、单位与 ledger 只读隔离。
- [x] E-B verifier 加入 `confirm-dispatch` 等关键 action coverage；E-C strong verifier 独立重算窗口、战斗/回放边界、recursive save diff、reload timeOrigin/loaderId、PNG、机器证据、性能与 Authority hash，并拒绝 saveDiff 自洽性伪造。
- [x] 真实生产浏览器证据覆盖 17 帧、5 次 `Page.reload`、55 条 production UI provenance；离线时间通过 savedAt/localStorage beforeunload 路径注入，`dispatchApiUsed=false`、`replayApiUsed=false`、`offlineApiUsed=false`，page/console errors 均为 0。
- [x] E-C focused 12/12；性能 warmup 20、sample 120、idle/construction/battle/replay p95 全部 `<16.7ms`；true-value tamper 80/80 拒绝，`passedFlagOnlyCases=0`，包含 same-timeOrigin、flag mismatch、same-loader。
- [x] 官方 `develop-web-game` Playwright client 已在生产入口执行并检查截图/`render_game_to_text`；离线报告卡片截图已人工图像检查。
- [x] E-C npm scripts、CI workflow（E-B 后追加 E-C focused/browser）、机器/浏览器/strong/tamper/selfcheck、builder/verifier 已接入；本地完整 `npm test` 通过，无 `--skip-full` 隔离包 verifier 第二次稳定重跑通过。
- [x] 当前交付包：`iron-command-stage8-2G-E-C-offline-progression-closure.zip`；最终 SHA-256、bytes、entries、final HEAD 与 clean package gate 以仓库外的 `stage8_2g_ec_final_package_record.json` 为准，避免在源码文档中复制会随最终封包变化的哈希。
- [ ] 独立审计方仍需按 E-C 最终 ZIP 重新验收；audit JSON 仅作为回归参考，不代表独立批准。

# Stage 8.2G-E-C 收口修复：npm test 纳入 E-B / E-C

- [x] `package.json` 的 `posttest` 补齐 `test:stage8-2G-E-B` 与 `test:stage8-2G-E-C`（只加不减，D-C / D-C.1 / E-A / E-A.1 全部保留）；CI workflow 既有 step 保持不变，两者互不替代。
- [x] 本地完整 `npm test` exit=0，日志含 `Stage 8.2G-E-B result: 12 passed / 0 failed / 12 total` 与 `Stage 8.2G-E-C result: 12 passed / 0 failed / 12 total`，`ordinaryNpmTest` 现真实覆盖 E-B / E-C。
- [x] 重建最终交付包并做无 `--skip-full` 干净目录全量验证：install / focusedEC / regressionEBBrowser / cleanPackageBrowserRerun / strongEvidence / tamper / ordinaryNpmTest 全部 `passed`。
- [x] 新 ZIP 的 SHA-256 / bytes / 非目录 entries 已写入 `stage8_2g_ec_final_package_record.json` 与 `stage8_2g_ec_clean_package_test.json`；`cleanPackageGate = passed`。
- [x] 交付自检逐条通过：未改动 `js/` 下任何文件，未删除/放宽任何 CI step、测试断言或 tamper 用例；ZIP 内无 `.git` / `node_modules` / 嵌套 zip / `__MACOSX` / `.DS_Store`。
- [x] 收口提交已推送，`finalHead` 与最终远端 HEAD 一致；该提交的 CI（GitHub Actions `core-regression`）全绿。

# Stage 8.2G-E-C.1 final acceptance and mainline closure

- [x] 已修正 README 与进度文档的当前阶段标识，并将封包数字统一收敛到 final package record，未改动生产规则或历史证据样本。
- [x] 已完成开发方独立复核：E-C focused 12/12、true-value tamper 80/80、clean package verifier、完整 `npm test` 与 final-head CI 均通过。
- [x] 已复核最终 ZIP 的 SHA-256、字节数、entries、clean package gate 与 final HEAD 绑定关系；E-C 证据 JSON 仍是验证输出，不是生产资源。
- [ ] 外部独立审计仍需由独立验收方按最终 ZIP 执行；本节的独立复核不冒充第三方批准。
- [ ] 主线整合将在本收口提交和最终封包验证通过后完成；Stage 9 尚未开始。

# 验收基线切换：干净克隆 + 全门禁实跑（取代 ZIP 与 GitHub CI 依赖）

- [x] 已删除 E-C 两个 ZIP record 的 `packageSha256`（`stage8_2g_ec_final_package_record.json` 同时移除 `finalHead`），并加入 `deprecated: true` / `supersededBy: clean-clone verification`，不再作为验收依据；历史阶段（A/B/C/D）record 原样不动。
- [x] 已新增 `tests/verify-clean-clone.mjs`（`verify:clean-clone`）：从 `git clone --depth 1 file://<repo>` 克隆当前 HEAD（非复制工作目录），`npm install --ignore-scripts`，跑完整门禁链，输出 JSON 并清理临时目录。
- [x] 已新增 `gate:stage8-2G = npm test && browser:stage8-2G-E-A-1 && browser:stage8-2G-E-B && browser:stage8-2G-E-C`，只加不减，作为验收单一入口。
- [x] 性能生成器（C-1 / D-A.1）输出新增 `environment` 字段（platform/arch/cpuModel/cpuCount/nodeVersion），未调整任何性能阈值（16.7ms 红线不变）。
- [x] 已新增 `.cnb.yml` + `.cnb/Dockerfile`（Node + Chromium）执行 `npm run gate:stage8-2G`，提供独立于 GitHub 的 cnb 原生自动验证；`.github/workflows/core-regression.yml` 保留不删。
- [x] 未改动 `js/` 下任何运行时源码，未删除/放宽任何 step、断言、tamper 用例或性能阈值；Authority Freeze 约束不变。
- [x] 新验收基线（`git rev-parse HEAD` / `git status --porcelain` / `npm run gate:stage8-2G` / `npm run verify:clean-clone` / 验收方独立探测与 tamper 复核）已在本文档与 `STAGE8-2G-E-C-DELIVERY.md` 中写明。

# 干净克隆可复现性修复：screenshots/manifest.json 纳入版本控制

- [x] **根因**：`.gitignore` 顶层 `screenshots/` 规则把 `experiments/battle-sandbox/universal-planner/screenshots/` 整目录忽略（git 跟踪 = 0），而 `experiments/battle-sandbox/tests/universal-presentation-delivery-test.mjs` 在模块顶层无条件 `readFileSync` 该目录下的 `manifest.json`（且该测试在 `npm test` 链内）。导致任何干净克隆跑 `npm test`（→ `gate:stage8-2G` → `verify:clean-clone`）必然 ENOENT，仓库此前只在开发者脏工作区能通过。
- [x] **修复方案（方案 A，`git add -f` 强制纳入）**：该 manifest 是浏览器捕获产出的**交付契约的一部分**——包含 `pngSha256` 哈希、`actualTime`、`planFingerprint`、`currentPositionsHash` 等需要被审查的固定内容，且由 `capture-universal-planner-evidence.mjs` 运行时捕获生成、无法从源码确定性重建，故不采用方案 B。仅把测试真正依赖的最小输入 `screenshots/manifest.json` 纳入版本控制（约 16KB，1 个文件），12 个截图 PNG 仍保持 ignored 不入库。
- [x] 已逐条核查 `dist` / `output` / `artifacts` / `tests/evidence` / `tests/outputs` 五个目录：仅 `build/verify-*-delivery-package.mjs`（不在 `gate:stage8-2G` 链内）会读取其中内容；`gate:stage8-2G` 链条读取的未跟踪路径**只有** `screenshots/manifest.json` 一处，已修复。其余 `stage8_2g_*.json` 均由门禁链内前置步骤生成后才被读取，干净克隆可自给自足。
- [x] 未改动 `js/` 下任何运行时源码，未改动 `tests/lib/` 下任何 verifier 判定逻辑，未删除/放宽任何测试断言、tamper 用例或性能阈值（16.7ms 红线不变），未重新引入任何自指 `finalHead`。
- [x] 本地完整 `npm run gate:stage8-2G` 与 `npm run verify:clean-clone` 实跑均为绿，真实输出见本 Issue 评论与 `STAGE8-2G-E-C-DELIVERY.md`。
- [x] `.cnb.yml` 流水线在容器内 git checkout 后跑相同门禁链，现可复现通过（本环境已用 Chromium 实跑验证）。

# Stage 9-A progress

- [x] 新增 `river_crossing`、`relay_station`、`mountain_pass` 三个无环战区，以及 `river_ferry`、`relay_intercept`、`pass_patrol` 三个重复任务；旧战区与旧任务 ID 保持不变。
- [x] 新增战区使用既有敌军类型，难度/补给倍率/首占奖励单调递增；正式模拟为三个新战区各找到可捕获 seed。
- [x] 新增 21 项 Stage9 逻辑检查：资格、DAG、迁移、失败零副作用、双 dispatch、正式结算、save/reload、离线暂停、只读回放、篡改任务绑定和 Authority Freeze 全部通过。
- [x] scenario corpus 重新生成：canonical 120 + fuzz 1000，12 mission IDs，12×5=60 cells，44 covered / 16 unobserved；coverage report 与生产 coverage matrix 已同步。
- [x] 性能/回归和浏览器证据脚本接入 package、CI 与完整 gate；浏览器完成 18/18 唯一截图、4 次真实重载，新增战区和重复任务关键动作由生产 DOM 完成。
- [x] Stage9 强证据与篡改审计通过：80/80 拒绝、`passedFlagOnlyCases=0`；完成 `STAGE9-A-DELIVERY.md` 和全部 `stage9_a_*` 证据文件。
- [x] 最终完整 `npm test` 与 `npm run gate:stage8-2G` 已通过；新 HEAD 连续两次 clean-clone、提交及远端推送为交付收口步骤。
