# Stage 8.2G-C · Battlefield Environment, Persistent Destruction & Art Pipeline

本阶段以 `8.2G-B.1.1a` 为基线，新增生产级环境层、持久破坏层和可替换资产管线。环境与效果只读正式 plan、路线、事件和 seed，不修改 solver、HP、damage、destroy、result、reward、save 或 authoritative event order。

## 代码结构

- `js/battle-presentation/environment/`：Environment Grammar、确定性布局、环境状态/Renderer、弹坑/烧痕/碎片、烟尘、资产 Provider 和 Sprite/Procedural/Hybrid 单位视觉规格。
- `assets/battle/asset-manifest.json`：离线 manifest；`assets/battle/sample-assets/` 为自制 SVG sample assets。
- `js/battle-presentation/universal/universal-render-state.js`：以时间直接求值环境与破坏状态；`universal-battle-renderer.js` 仅消费状态并继续使用统一 World Render Queue。

## 验收入口

```bash
npm run test:stage8-2G-C
npm run browser:stage8-2G-C
npm run verify:stage8-2G-C
npm test
npm run build:stage8-2G-C
```

Stage C 专项为 11/11；当前浏览器证据为 20 张 PNG，Machine/Browser scene hash、state signature、Environment/Destruction signature 强绑定，页面与控制台错误均为 0。完整 `npm test` 和 clean package 结果记录在 `stage8_2g_c_clean_package_test.json`。

## 证据

机器证据：`stage8_2g_c_machine_evidence.json`、`stage8_2g_c_environment_manifest.json`、`stage8_2g_c_persistent_destruction.json`、`stage8_2g_c_weapon_visual_profiles.json`、`stage8_2g_c_asset_manifest_check.json`、`stage8_2g_c_seek_determinism.json`、`stage8_2g_c_authority_check.json`、`stage8_2g_c_performance_check.json`。

浏览器证据：`stage8_2g_c_browser_capture_manifest.json` 与 `screenshots/stage8-2G-C/`。C 证据只由当前代码实时生成，不读取 B 阶段 PNG/Manifest fallback。

## 已知事项

独立审计 JSON 仍是外部验收基线，不导入生产代码、不删除或过滤失败样本。sample assets 是自制 SVG fixture；正式 Sprite pack 可通过 manifest 离线替换，运行时不会调用外部生成 API。
