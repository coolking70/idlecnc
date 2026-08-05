# 钢铁指令 IRON COMMAND —— 阶段 3 交付说明

**范围：单位生产、生产队列与库存**
**版本：`SAVE_VERSION = 2`，`CURRENT_STAGE = 3`，`package.json` 版本 `0.3.0`**
**交付物：`iron-command-stage3.zip`（含 `tests/stage3-test.mjs`）**

> 本轮**仅实现阶段 3**，在现有代码基础上增量修改；阶段 1/2 已验收功能一律保留，未进入阶段 4（编队 / 战区 / 自动战斗）。完成后已停止，未自行进入后续阶段。

---

## 一、修改清单（相对阶段 2）

| 文件 | 变更类型 | 阶段 3 改了什么 |
| --- | --- | --- |
| `js/config.js` | 修改 | 新增 `UNITS`（5 种单位，数值唯一声明）、`PRODUCTION`（maxConcurrent/maxQueueSize/返还比例）、`PRODUCTION_UI` 文案；`SAVE_VERSION` 1→2、`CURRENT_STAGE` 3；`BUILDINGS` 兵营 / 装甲工厂补 `unlocks` |
| `js/production.js` | 修改 | 实现全部生产业务接口：`canQueueUnit/queueUnit/tickProduction/completeProduction/startNextProduction/getProductionProgress/cancelCurrentProduction/cancelQueuedProduction/createUnit/availableUnits/inventoryCount/sanitizeProduction` + 别名 `canProduce()/currentProgress()`；资格错误码；立即扣费与防连点；单线+队列；50%/100% 返还与上限钳制；进度百分比浮点吸附（四舍五入，未完成不超 99%、完成才 100%） |
| `js/save.js` | 修改 | `migrate()`：版本 1→2 兼容；`reconcileUnlocksFromBuildings()` 在合并 `unlocks` 之前调用并按建筑重新校准解锁（修复"末尾被 `data.unlocks` 覆盖"的 bug）；`sanitizeProduction()` 10+ 项检查；载入修复提示"检测到异常生产数据，已自动修复" |
| `js/construction.js` | 修改 | `sanitizeConstruction()` 无主施工建筑恢复（单座重建不落成 / 多座只留一座 / 类型不匹配清除后重建 / 未知类型移除，绝不白嫖落成） |
| `js/ui.js` | 修改 | 新增 `_buildProductionPage` / `_renderUnitCard` / `_updateProduction` / `refreshProduction`：当前生产线（空闲态+生产中态含进度条 / 百分比 / 剩余 / 暂停提示 / 取消）、等待队列（最多 4 项）、5 张单位卡片（成本 / 时间 / 属性 / 库存 / 缺料高亮 / 禁用原因）、库存统计区 |
| `js/renderer.js` | 修改 | 订阅 `production:completed`（携带 `unitType/sourceBuildingId/sourceBuildingType`），按真实单位类型绘制不同出厂外形；兵营 / 装甲工厂生产时增强动画（烟雾增强 + 偶发火花） |
| `js/main.js` | 修改 | 生产循环接入固定步长主循环；播放 / 暂停 / 速度联动车间生产；调试接口 `__IRON_COMMAND__` 新增 `canProduce/produce/getProductionProgress/cancelCurrentProduction/cancelQueuedProduction/productionQueue/inventory` |
| `css/style.css` | 修改 | 新增"生产页（阶段 3）"样式段：当前生产线、等待队列、单位卡片（按 `data-type` 区分左边框色）、库存区、窄屏适配 |
| `package.json` | 修改 | 版本 0.2.0→0.3.0；描述改为"需要通过本地 HTTP 服务器运行"；新增 `scripts.start` / `scripts.test` |
| `README.md` | 修改 | 重写为阶段 3：启动方式、建设 / 生产页、5 单位表、生产规则、资格错误码、取消返还、库存、存档迁移、调试接口、目录结构、已知限制、路线 |
| `tests/stage3-test.mjs` | **新增** | 阶段 3 自动化测试（node:assert/strict + 最小 DOM/window 桩），63 项，运行 `node tests/stage3-test.mjs` |
| `iron-command-stage3.zip` | **新增** | 阶段 3 交付压缩包（标准正斜杠路径，含 `tests/`） |

> 未触碰：`economy.js`、`state.js`、`events.js`、`utils.js`、`formations.js`、`battle.js` 的既有逻辑；阶段 2 已验收的建设系统、Canvas 基地、固定步长循环、存档框架均保持不变。

---

## 二、每文件摘要

### js/config.js
- `UNITS`：步兵班 / 反装甲班（`from: barracks`）、侦察车 / 主战坦克 / 维修车（`from: armor_factory`）。每种含 `cost / buildTime / from / stats{hp,attack,antiArmor,defense,scouting,mobility,repair}`。数值只在 `config.js` 声明，禁止重复硬编码。
- `PRODUCTION = { maxConcurrent:1, maxQueueSize:5, activeCancelRefundRatio:0.5, queuedCancelRefundRatio:1 }`。
- `BUILDINGS.barracks.unlocks = ['infantry','at_infantry']`、`BUILDINGS.armor_factory.unlocks = ['scout_car','mbt','repair_vehicle']`。

### js/production.js
- 资格：`canQueueUnit(state, type)` → `{ok, code, reason, reasons[]}`，错误码 `unknown/locked/producer_missing/producer_offline/queue_full/resource`。
- 入队：`queueUnit` 立即扣费（`grant` 钳制上限），多座同名建筑只归属**运行中**那座；重复调用被拒。
- 推进：`tickProduction(state, dt)`、`completeProduction` 生成单位实例并 `stats.unitsBuilt+=1`、`startNextProduction` 自动开下一项；浮点吸附防"卡 99.99%"与防"进度 100% 提前满格"。
- 取消：`cancelCurrentProduction`（返还 50%）、`cancelQueuedProduction(jobId)`（返还 100%），均防重复返还。
- 库存：`inventoryCount(state)` 按类型实时计数；单位实例写入 `state.units`，**不占指挥容量**。
- 容错：`sanitizeProduction(state)` 检查 10+ 项（结构 / 单位类型合法性 / current+queue 总数上限 / sourceBuilding 存在性 / 进度钳制 / costPaid 等）。

### js/save.js
- `migrate(data)`：版本 1→2；先合并 `data.unlocks` 再 `reconcileUnlocksFromBuildings(merged)`（**修复原"末尾覆盖"bug**）；再 `sanitizeProduction`；返回 `report.productionRepaired / report.repaired`。
- `reconcileUnlocksFromBuildings(state)`：遍历 operational 建筑，汇总 `BUILDINGS[type].unlocks`，过滤非法 ID、去重、保留已有合法解锁。
- 载入若发生修复，提示"检测到异常生产数据，已自动修复"。

### js/ui.js
- 生产页：当前生产线（空闲 / 生产中两态）、等待队列、5 张单位卡片（成本 / 时间 / 属性 / 库存 / 缺料高亮 / 禁用原因）、库存统计区（总数 / 待命 / 已编入 / 维修中）。
- `refreshProduction(state)` 由 main 在状态变化时调用，逻辑 / 表现分离。

### js/renderer.js
- 订阅 `production:completed`，按 `unitType` 绘制不同出厂外形；`sourceBuildingType` 决定兵营 / 装甲工厂增强动画。只读状态，不改状态。

### tests/stage3-test.mjs
- 最小 `ClassList / El / document / window` 桩，零第三方依赖。
- 覆盖：阶段标记回归、解锁、资格错误码、入队扣费防连点、队列上限、暂停、完成结算、单位实例、取消返还、库存、进度查询、存档迁移容错、无主施工恢复、生产页构建、语法检查。共 **63 项**。

---

## 三、自测输出

运行：`cd iron-command && node tests/stage3-test.mjs`
结果：**测试总数 63，通过 63，失败 0，全部通过 ✔**

分类汇总（节选关键项）：

```
── 一、阶段标记与阶段1/2 回归 ──  PASS 01~05
── 二、建筑解锁单位 ──           PASS 06~08
── 三、生产资格判断与错误码 ──     PASS 09~15
── 四、入队/扣费/队列上限 ──       PASS 16~21
── 五、推进/暂停/完成结算 ──       PASS 22~29
── 六、单位实例 ──               PASS 30~33
── 七、取消生产与返还 ──          PASS 34~39
── 八、单位库存 ──               PASS 40~42
── 九、进度查询接口 ──            PASS 43~44
── 十、存档与迁移 ──             PASS 45~52（含版本1旧档兼容、解锁重校准）
── 十一、无主施工建筑恢复 ──       PASS 53~58
── 十二、生产页构建 ──           PASS 59~61
── 十三、全部源码语法检查 ──       PASS 62~63
```

> 说明：输出的 `[save] 存档解析失败 …` 是测试 #51 故意喂入损坏 JSON、验证 `loadGame` 不抛异常时的预期日志噪声，该用例本身 **PASS**。

---

## 四、浏览器人工测试结果

本环境无图形浏览器，**Canvas 渲染与动画的视觉效果无法在此自动验证**；阶段 3 的全部逻辑 / 状态 / DOM 构建已由上面的 63 项自动化测试覆盖（含生产页构建不抛异常、进度条百分比与库存数量正确）。

请在本地按以下步骤人工核验（运行 `npm start` 后用 Chrome/Edge 打开本地地址）：

- [ ] 顶部资源栏正常增长；速度切换 暂停 / 1× / 2× / 4× 生效
- [ ] 建设兵营 / 装甲工厂并落成后，"生产"页解锁对应单位卡片，按钮由禁用变可用
- [ ] 点击单位卡片"训练 / 制造"后：立即扣资源；当前生产线出现进度条 + 百分比 + 剩余时间；基地中兵营 / 装甲工厂出现生产增强动画
- [ ] 连续点击同一卡片不会重复扣费、不会重复入队
- [ ] 当前生产进行中再点其他单位：进入等待队列（最多显示 4 项），队满时提示"生产队列已满"且不扣费
- [ ] 生产中点击"取消当前项目"：返还 50% 资源、自动开工下一项
- [ ] 等待队列项点击取消：返还 100% 资源、不影响当前生产
- [ ] 生产完成时：单位"开"出基地（出厂表现），库存统计区数量 +1
- [ ] 暂停时进度冻结；恢复后从原处继续
- [ ] 中途保存（或等自动保存）后刷新：当前生产 / 等待队列 / 库存完整恢复，不重复扣费、不凭空多产单位
- [ ] 控制台 `__IRON_COMMAND__.produce('mbt')` / `.inventory()` / `.productionQueue()` 等接口工作正常

---

## 五、未解决 / 已知限制

- **纯视觉渲染未在本环境验证**：Canvas 出厂表现、兵营 / 装甲工厂增强动画、生产页布局的视觉效果需用户在浏览器中确认（自动化测试已保证逻辑与 DOM 结构正确，见上节）。
- **离线收益**：刷新后仅显示离线时长，不推进生产 / 施工、不发放资源（阶段 6 实装，符合规格）。
- **编队 / 战区 / 自动战斗 / 科技**：尚未开发，对应分页仍为占位（"后续阶段开放"）；阶段 3 产出的库存单位仅用于统计与展示，尚未被消耗。
- **建筑不可升级 / 拆除 / 自由摆放**：阶段 2 限定（每种最多 1 座，系统预设槽位），阶段 3 沿用。

---

## 六、阶段 4 接口说明（预留，未实现）

阶段 4 将实现**编队系统与指挥容量**。阶段 3 已为其预留的数据与接口：

- **库存单位实例结构**（已就绪，阶段 4 直接用）：
  `{ id, type, hp, maxHp, damage:'intact', status:'ready', formationId:null, experience:0, battles:0, createdAt, sourceBuildingId }`
- **库存不占指挥容量**：`state.units` 独立于指挥容量上限，阶段 4 编队时才按 `UNITS[type].stats` 占用 `command`。
- **编队配置已留**（阶段 2 `config.js` 的 `FORMATIONS` 模板：综合战斗群 / 装甲突击群 / 侦察分队），阶段 4 据此实例化编队并写入 `unit.formationId`。
- **`formations.js` 已存在占位**：阶段 4 在其中实现创建 / 解散 / 占用指挥容量 / 战区派遣。
- **`state.formations` / `state.theaters`**：已在 `save.js` 的 `migrate` 中合并保留，存档向前兼容。
- **建议阶段 4 接入点**：`main.js` 主循环增加编队 / 战区 tick；`ui.js` 启用"编队""战区"分页；`renderer.js` 按 `unit.formationId` 在基地画面表现编队编组。

---

## 七、如何运行与测试

```bash
cd iron-command
npm start                 # 启动本地 HTTP 服务（npx --yes serve .），浏览器打开提示地址
npm test                  # 运行阶段 3 自动化测试（node tests/stage3-test.mjs）
```

> 必须用本地 HTTP 服务打开（ES Module + `file://` 会被浏览器 CORS 拦截而白屏）。
