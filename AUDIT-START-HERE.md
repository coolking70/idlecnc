# Stage 8.2G-D-A.1 Audit Start Here

当前最高阶段为 Stage 8.2G-D-A.1：Production Semantic Animation Evidence & Turret Independence Closure。
需求主体是 D-A.1 开发提示词；`stage8_2g_da_github_independent_audit.json` 仅作为上一轮失败基线和回归样本，未导入生产代码，也未删除/过滤失败样本。

## D-A.1 entry points

```bash
npm run test:stage8-2G-D-A-1
npm run browser:stage8-2G-D-A-1
npm run build:stage8-2G-D-A-1
npm run verify:stage8-2G-D-A-1 -- --skip-full
npm run verify:stage8-2G-D-A-1
```

D-A.1 的 12 张合成覆盖截图和 1 张正式未改写矿区截图位于
`screenshots/stage8-2G-D-A-1/`；机器证据、浏览器证据与篡改记录分别为：

- `stage8_2g_da1_machine_semantic_evidence.json`
- `stage8_2g_da1_browser_capture_manifest.json`
- `stage8_2g_da1_tamper_results.json`

外部 ZIP 为 `iron-command-stage8-2G-D-A-1-semantic-turret-closure.zip`，不提交到 Git；最终记录为 `stage8_2g_da1_final_package_record.json`。

## D-A.1 closure claims

- 生产坦克 Hull/body 朝向与 Turret/aim 朝向独立；权威 Shot 的 sourceFacing、impact 和时间字段保持不变。
- Semantic Frame Resolver 以文件级 predicate 解析并 fail-closed；浏览器使用当前页面 Renderer 状态和当前屏幕几何重新计算 predicate。
- 炮口 `visualMuzzlePoint` 来自最终 draw geometry，并区分 authoritative projectile start 与视觉 tracer start；命中、摧毁、残骸朝向和 seek/replay 均有确定性测试。
- 正式 `miningVictoryReport()` 作为未修改 fixture 单独采集；合成艺术覆盖不会替代正式战报。

以下仍需独立验收方按新外部 ZIP 重新执行审计；本地开发者验证通过不等同于独立审计批准。


本交付的需求主体是 Stage 8.2G-D-A 开发提示词。当前工作基线为
`dcbab21` 之后的 D-A 分支，上一轮参考为
`stage8_2g_c11a_github_independent_audit.json`。该 JSON 仅是外部失败基线和回归样本，不会进入生产代码；失败样本保留，不通过过滤或删除来归零。

## D-A entry points

```bash
npm run test:stage8-2G-D-A
npm run browser:stage8-2G-D-A
npm run build:stage8-2G-D-A
npm run verify:stage8-2G-D-A -- --skip-full
npm run verify:stage8-2G-D-A
```

D-A 生产截图位于 `screenshots/stage8-2G-D-A/`，Manifest v2 位于 `assets/battle/asset-manifest.json`。

## C.1.1a entry points

```bash
npm install
npm run test:stage8-2G-C-1-1a
npm run browser:stage8-2G-C-1-1a
npm run build:stage8-2G-C-1-1a
npm run verify:stage8-2G-C-1-1a -- --skip-full
npm run verify:stage8-2G-C-1-1a
```

默认封包验证器会在干净解压目录执行 hygiene、C.1.1a 证据/Node/篡改、C.1.1、C、B.1.1a 回归，然后执行 `npm install --ignore-scripts --no-audit --no-fund` 和完整 `npm test`。`--skip-full` 只用于快速静态/证据门禁。

## Required current records

- `stage8_2g_c11a_visual_unit_class_check.json`
- `stage8_2g_c11a_final_draw_geometry.json`
- `stage8_2g_c11a_screen_footprint_check.json`
- `stage8_2g_c11a_cover_path_check.json`
- `stage8_2g_c11a_asset_runtime_check.json`
- `stage8_2g_c11a_authority_check.json`
- `stage8_2g_c11a_tamper_results.json`
- `stage8_2g_c11a_clean_package_test.json`
- `stage8_2g_c11a_developer_selfcheck.json`

浏览器证据为 `stage8_2g_c11a_machine_semantic_evidence.json`、
`stage8_2g_c11a_browser_capture_manifest.json`，截图目录为
`screenshots/stage8-2G-C-1-1a/`。生产调试覆盖层默认关闭。

## Scope and authority

本轮只收口视觉运行时契约：唯一 Visual Unit Class Normalizer、共享
`ActorFinalDrawGeometry`、共享 `presentationRoute`、真实资产就绪状态和浏览器/机器证据绑定。
不修改 solver、HP、damage、destroy、result、reward、save 或正式战斗权威事件顺序。

`stage8_2g_c11a_final_package_record.json` 是封包外最终记录；ZIP 内保留 clean-package test 记录和 delivery manifest。
