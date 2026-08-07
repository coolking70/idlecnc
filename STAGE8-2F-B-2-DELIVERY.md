# Stage 8.2F-B.2 交付记录：正式通用 Renderer

## 目标

在 B.1 正式通用旁路的计划、缓存和状态之上，完成可接入正式战斗的通用 Renderer。Renderer 只消费已编译的通用计划和只读权威锚点，不改写正式战报，也不把沙盒资源导入生产路径。

## 已完成

- 新增确定性通用镜头：`overview`、`focus`、`impact`、`result`，支持自动镜头、手动镜头和缩放后的地图边界收口。
- 状态层输出成员编队、朝向、单位状态、场景对象状态、权威锚点效果、活动动作、结局动作和镜头状态。
- Renderer 覆盖地形纹理、战术区、推进/撤退路线、障碍物、普通步兵、反装甲步兵、坦克、侦察车、维修车、敌方单位、残骸、火力/命中/维修/摧毁/目标环效果。
- 任务对象按正式语义绘制：控制节点、补给车队、回收点、回收小组、搜索分区；空间实体保留 `visualKind`，不改变其碰撞/权威类型。
- 五类结果均维持各自结局编舞，胜利/代价取胜、撤离、失守、覆灭不互相伪造；通用 HUD 不暴露 report、seed、authority 等诊断身份。
- Router 的通用模式仍是显式会话旁路，`auto` 仍保持既有契约/旧版选择顺序。

## 验证

- `node tests/stage8-2F-B-2-test.mjs`：8/8。
- `node tests/stage8-2F-B-1-test.mjs`：12/12。
- 连续布局：1123 checks；空间实体：12 plans；残骸避碰：30 plans；性能：120 plans。
- 官方 Playwright Chromium Canvas 烟测：operation salvage 交火帧、wiped 结局帧，页面错误 0、文本状态 errors 为空；已人工检查截图。
- 全量 `npm test` 与抽取后封包回归由 B.2 builder 执行。

## 最终封包

- 文件：`iron-command-stage8-2F-B-2-universal-renderer-final.zip`
- 生成命令：`npm run build:stage8-2F-B-2`
- 覆盖保持：canonical 120、fuzz 1000、规划器截图 12。
- SHA-256：`1209742da99ea0c212c2f9d8921c9e8242eca222282d5247c1572d18531c0f6e`
- 大小：9,306,028 bytes；封包条目：357。
