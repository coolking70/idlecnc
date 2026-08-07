# Stage 8.2G-C.1.1a Audit Start Here

本交付的需求主体是 Stage 8.2G-C.1.1a 开发提示词。当前代码基线为
`22b4fea85f877217a8f4ab18621f2a982e64a546`（C.1.1 runtime readability），上一轮参考为
`stage8_2g_c11_github_reaudit.json`。该 JSON 仅是外部失败基线和回归样本，不会进入生产代码；失败样本保留，不通过过滤或删除来归零。

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
