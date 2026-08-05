# 钢铁指令 / IRON COMMAND —— 阶段 4 交付说明

> 版本：`CURRENT_STAGE = 4`，`SAVE_VERSION = 3`
> 交付日期：2026-08-03
> 类型：纯前端原型（零第三方依赖；ES Module；需经本地 HTTP 服务器运行）

---

## 一、本阶段目标

在阶段 1（框架 / 经济 / 渲染）、阶段 2（建设）、阶段 3（单位生产）的基础上，完成**编队系统、指挥容量与基地集结表现**：

- 玩家通过编队下达指令，**不直接操作单个单位**；
- 库存单位不占指挥容量，正式编入编队后才占用；
- 编队可在「编队」分页组建、查看、调整、解散；
- 基地画面出现集结区表现，已编入单位从出口入场、按编队站位、显示名称标签与选中高亮；
- 战区派遣、自动战斗、科研、维修**仍未开放**，但数据结构与接口已全部预留。

---

## 二、增量交付范围（不重写已验收系统）

阶段 4 仅做**增量修改**，未重写 / 重建以下已验收系统：资源经济、固定步长逻辑循环、Canvas 分层渲染、建设系统、生产系统、单位实例、库存、localStorage 存档与迁移自愈。

新增 / 改动文件：

| 文件 | 改动 |
| --- | --- |
| `js/formations.js` | **新增核心模块**：编队创建 / 重命名 / 解散、成员加入 / 移除 / 双向归属、指挥容量动态计算、预设模板原子操作、编队评估、汇总属性、`sanitizeFormations` 容错、调试接口所需全部导出 |
| `js/config.js` | 新增 `FORMATION` / `FORMATION_PRESETS` / `FORMATION_WARNINGS` / `FORMATION_STATUS` / `FORMATION_STATUS_LABEL` / `RALLY` 配置块；`CURRENT_STAGE` 升到 4，`SAVE_VERSION` 升到 3 |
| `js/economy.js` | `recalcDerived` 依据 `formations[].unitIds` 中真实单位 `UNITS[type].command` 计算 `command.used`（不信任存档） |
| `js/main.js` | 编队事件总线接线 + 6 个 handler（创建 / 应用预设 / 解散 / 重命名 / 加单位 / 减单位）+ 选中态单向同步渲染层 + `window.__IRON_COMMAND__` 调试接口 + 阶段 4 开场日志 |
| `js/ui.js` | 「编队」分页构建：编队列表、容量、详情、预设卡片、加 / 减成员、重命名、解散、自动选中首支 |
| `js/renderer.js` | **新增集结区表现**：`_layoutRally` / `_updateRally` / `_drawRallyPads` / `_drawRallyUnit` / `_drawRallyLabels`；复用 `_unitShape` 画法；订阅编队事件播脉冲；渲染层只读 `state`，绝不改单位归属 |
| `js/save.js` | `loadGame` 返回值补充 `formationRepaired` / 编队修复日志；`migrate` 接入 `sanitizeFormations` |
| `tests/stage4-test.mjs` | **新增**阶段 4 自动化测试（76 项） |
| `README.md` | 更新版本标记、测试说明、右侧面板可用分页、阶段 4 编队系统章节、`SAVE_VERSION` |

---

## 三、关键数值与业务规则

### 指挥容量

- 来源：已建成建筑的 `effects.commandCapacity`（指挥中心 = **6**）。
- 占用：`Σ(编入成员 UNITS[type].command)`；库存 / 维修中单位不占用。
- 重算：每次 `recalcDerived` 与每次读档后，按真实成员**重新计算** `command.used`，不信任存档字段。

### 编队规则（`FORMATION`）

- `maxFormations = 6`（达到上限 `canCreateFormation` 返回 `LIMIT_REACHED`）。
- `maxNameLength = 20`（自动名 / 重命名去空格、截断）。
- `editableStatuses = ['idle']`（仅待命可编辑）。
- 同一单位不可同属两编队（`UNIT_ASSIGNED`）；非 `ready` 单位不可编入（`UNIT_NOT_READY` / `UNIT_REPAIRING`）。
- 单位 command 值：`infantry:1`、`at_infantry:1`、`scout_car:1`、`mbt:2`、`repair_vehicle:1`。

### 预设模板（原子）

| 预设 | 组成 | 指挥消耗 |
| --- | --- | --- |
| `combined` 综合战斗群 | 步兵班×2、反装甲班×1、侦察车×1 | 4 |
| `armor` 装甲突击群 | 主战坦克×2、步兵班×1、维修车×1 | 6 |
| `recon` 侦察分队 | 侦察车×2、步兵班×1 | 3 |

`canApplyPreset` 预检顺序：模板存在 → 编队数量 → 库存充足 → 指挥容量；全部通过 `applyPreset` 才建编队并编入，任一项不满足**不产生任何副作用**。

### 编队评估提示（`getFormationWarnings`，只读）

可叠加返回：编队为空、侦察不足（scouting<8）、装甲缺步兵掩护、装甲缺维修车、反装甲不足（antiArmor<25）。

### 集结区表现（只读）

- 单位从 `RALLY.gate`（基地出口）入场、按编队分站位区，动画走真实时间（暂停也反馈）；
- 编队名标签「名·数量」、选中编队高亮 + 脉冲；
- 渲染层**只读取** `state.formations` / `state.units`，绝不修改单位归属、状态或任何数值。

### 存档容错（`sanitizeFormations`，6 类）

引用不存在的单位、同一单位多编队、非待命状态复位 idle（清空 strategy / theaterId）、编队数量超限、指挥容量超限（确定性移出末支编队尾部成员回库存）、名称非法 / 过长；`command` 按真实成员重算。

---

## 四、如何运行与验证

### 启动（任选其一）

```bash
npm start                 # node scripts/serve.mjs  → http://127.0.0.1:8000
# 或
node scripts/serve.mjs 8080
# 或
python -m http.server 8000
```

部署后浏览器打开 `http://127.0.0.1:8000`，进入「编队」分页即可组建部队（**暂不能派遣**，战区作战为后续阶段）。

### 自动化测试

```bash
npm test
# 等价于
node tests/stage3-test.mjs   # 63 项（阶段 1/2/3 回归）
node tests/stage4-test.mjs   # 76 项（阶段 4 全量）
```

阶段 4 测试覆盖：阶段 1/2/3 兼容回归、编队创建 / 命名 / 上限、重命名 / 解散、成员加入 / 移除 / 双向归属、指挥容量动态计算与超限、预设模板原子性、评估 5 类提示、汇总属性、存档迁移与 `sanitizeFormations` 容错、UI 编队页构建、渲染器集结区只读表现、调试接口契约、本地服务器（`scripts/serve.mjs` 防 `../` 穿越 403 / content-type / 真实请求）、源码语法检查。**当前结果：阶段 3 = 63/63，阶段 4 = 76/76，全绿。**

---

## 五、明确不在本阶段范围（已预留，后续阶段开放）

- 战区派遣（`FORMATION_STATUS` 的 rallying / marching / fighting / returning 已定义但阶段 4 不进入）；
- 自动战斗推演（`js/battle.js` 占位）；
- 科研 / 科技树（右侧面板「科技」页显示"后续阶段开放"）；
- 单位维修与损伤状态（接口预留）；
- 离线收益结算（数据结构先生效，阶段 6 接入）。

---

## 六、交付物清单

- 源码：`index.html`、`css/style.css`、`js/*.js`（含 `formations.js`、`config.js`、`economy.js`、`main.js`、`ui.js`、`renderer.js`、`save.js` 等）
- 本地服务器：`scripts/serve.mjs`（零依赖）
- 测试：`tests/stage3-test.mjs`、`tests/stage4-test.mjs`
- 文档：`README.md`、`STAGE2_DELIVERY.md`、`STAGE3_DELIVERY.md`、`STAGE4_DELIVERY.md`（本文件）
- 构建元数据：`package.json`（含 `start` / `test` 脚本）
- 打包：`iron-command-stage4.zip`（正斜杠路径，含 tests + scripts + 交付说明）
