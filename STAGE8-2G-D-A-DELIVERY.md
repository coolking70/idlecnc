# Stage 8.2G-D-A 交付说明

本轮以 Stage 8.2G-D-A 开发提示词为需求主体，以 `stage8_2g_c11a_github_independent_audit.json` 作为上一轮回归参考。该 JSON 仅用于审计参考，不进入生产代码，也没有删除或过滤其中的失败样本。

## 交付范围

- 离线自研 PNG spritesheet：友方/敌方步兵、反装甲步兵、主战坦克 Hull/Turret，共 6 个正式单位类；友方/敌方 MBT Wreck，共 2 个正式残骸。
- `assets/battle/asset-manifest.json` 升级为 Manifest v2：8 方向顺序、Idle/Move/Aim/Fire/Hit/Destroy、来源与授权、世界尺寸、炮口锚点和 MBT 组件关系均显式记录。
- `animation-resolver.js` 提供确定性方向量化、动画状态、spritesheet sourceRect 与炮口锚点解析；生产动画只使用 presentation seconds，不读取墙钟。
- 正式 Universal Renderer 绘制真实 PNG 帧；MBT 分离绘制 Hull/Turret；资产缺失或被禁用时使用阵营安全的 procedural fallback；Wreck 使用阵营专属资源；深度排序和屏幕 footprint 仍由正式 Renderer 负责。
- 不修改 solver、HP、damage、destroy、result、reward、save 或正式战斗权威事件顺序。艺术 showcase 只复用正式战报生成的 presentation 输入，额外演员仅用于视觉覆盖证据，不进入战斗求解。

## 验证入口

```bash
npm run test:stage8-2G-D-A
npm run browser:stage8-2G-D-A
npm run build:stage8-2G-D-A
npm run verify:stage8-2G-D-A -- --skip-full
npm run verify:stage8-2G-D-A
```

默认封包验证器会在干净解压目录验证 D-A 机器/浏览器证据、PNG 哈希、fallback、篡改拒绝、C.1.1a/C.1.1/B.1.1a 回归，随后执行 `npm install --ignore-scripts --no-audit --no-fund` 与完整 `npm test`。`--skip-full` 只跳过干净安装和完整 npm 回归。

## 浏览器证据

截图目录：`screenshots/stage8-2G-D-A/`，共 12 张：lineup、move、infantry/AT fire、tank direction/turret、mixed battle、双阵营 Wreck、narrow readability、asset fallback。机器证据与浏览器清单通过 SHA-256、scene/state/environment/destruction signature、当前 Renderer 屏幕指标和资产运行时状态绑定。

## 封包

目标文件：`iron-command-stage8-2G-D-A-production-unit-art.zip`。最终包哈希写入 `stage8_2g_da_final_package_record.json`；干净包门禁完成后写入 `stage8_2g_da_clean_package_test.json`。ZIP 不包含 Git 元数据、`node_modules`、浏览器 profile 或旧 ZIP。
