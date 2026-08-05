# 《钢铁指令》阶段 8.2D-B.2.2 交付回执

本阶段只处理独立 contract-demo 的战术空间连续碰撞、路线去冲突，以及交付验证器的进程树收尾；正式 js/、正式测试、战斗语义、HP、奖励、存档、Fixture/schema 未修改。

## 交付范围

- experiments/battle-sandbox/contract-demo/route-deconflictor.js：为每个演出计划生成自有的固定/动态去冲突路线注册表。
- experiments/battle-sandbox/contract-demo/continuous-layout-validator.js：按 0.05 秒步长覆盖 [0,35] 共 701 个采样点，检查演员、建筑、目标旗帜和残骸的真实视觉包围盒。
- experiments/battle-sandbox/contract-demo/slot-layout-validator.js、repair-choreography.js：使用实际视觉包围盒与维修接近/撤离折线路径。
- experiments/battle-sandbox/tests/contract-route-deconfliction-test.mjs：32 项路线、连续采样和权威状态回归。
- experiments/battle-sandbox/report-adapter/process-tree-manager.mjs：POSIX 进程组 / Windows taskkill /T 清理，带有限等待和强制升级。
- experiments/battle-sandbox/tests/delivery-verifier-process-test.mjs：15 项进程树、端口释放和验证器源码契约回归。
- experiments/battle-sandbox/report-adapter/build-b2-2-delivery-package.mjs、verify-b2-2-delivery-package.mjs：唯一发布入口与脱离工作区自包含验证器。

## 连续空间证据

| 来源 | 去冲突前关键采样相交 | 去冲突后相交 | 去冲突前最小中心距 | 去冲突后最小中心距 | 调整路线数 | 连续采样 |
|---|---:|---:|---:|---:|---:|---|
| scenario-d | 20 | 0 | 7.0349 px | 31.7194 px | 13 | 701 / 0 intersection |
| scenario-e | 22 | 0 | 7.0349 px | 31.7194 px | 14 | 701 / 0 intersection |
| scenario-f | 20 | 0 | 7.0349 px | 31.7194 px | 12 | 701 / 0 intersection |

连续验证还确认：跨阵营短暂交叉只允许不超过 0.20 秒；本阶段 D/E/F 无建筑、目标旗帜或残骸相交；路线调整不改变 actor/target/value、HP、alive、victory/capture、required anchor exactly-once 语义。

## 浏览器取证

正式本地服务使用 Playwright 精确跳转取帧，页面与 console 无错误。新增并写入 screenshots/capture-manifest.json 的证据为：

- scenario-d：01-three-infantry-lanes.png、02-contact.png、03-victory.png、04-enemy-cover-separated.png；
- scenario-e：01-reserve-deployment.png、02-reserve-in-combat.png、03-victory.png；
- scenario-f：01-no-repair-roster.png、02-no-repair-battle.png、03-victory.png。

Manifest 保留每张 PNG 的实际时间、来源、authority anchor 计数、活动弹道计数和 SHA-256；sha256Unique=true、browserErrors=[]。

## 回归与边界

构建器按既定顺序执行正式 npm、五组沙盒、适配器、完整性、Fixture check、跨进程、契约演示、B.2/B.2.1/B.2.2 新增测试、Manifest、正式边界哈希和自包含验证器。阶段新增测试当前真实输出为：

    contract-route-deconfliction-test: 32 passed / 32 total
    delivery-verifier-process-test: 15 passed / 15 total

正式边界 SHA-256 必须保持：

    2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab

最终 ZIP：iron-command-stage8-2D-B-2-2-complete.zip。发布器最后一步会在临时目录解压后重新执行全部验证；ZIP SHA-256 以构建器末行输出为准，避免把自身摘要写入封包造成循环依赖。最近一次真实自包含验证输出为：

    PASS npm start and HTTP routes
    PASS process tree cleanup pid=72966 durationMs=2.740750000000844
    PASS formal boundary hash 2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab
    PASS screenshot manifest (31 unique SHA)
    verify-b2-2-delivery-package: ok elapsedMs=25136

## 未解决项与下一阶段

本阶段未接入正式 renderer，也未改变正式战斗求解器。下一阶段如需继续，应先明确新的演出范围，再决定是否将连续布局 validator 接入更广的场景矩阵；不得把本阶段的演出路线数据回写为正式战斗语义。
