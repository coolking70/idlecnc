# IRON COMMAND 阶段 8 交付说明

版本：`0.8.0`  
阶段：`8`  
存档版本：`7`

## 本阶段完成内容

- 科研依赖闭包、可信 `revision/history`（最多 64 条）、科研任务创建时间绑定。
- 生产与维修任务绑定科研版本；旧 Stage7 快照受控迁移，不能通过篡改展示快照缩短任务。
- 派遣快照、战报重建比较、严格 `alive` 布尔值、敌军初始/最终集合和结果一致性校验。
- 单位呼号、经验动态等级：新兵、训练有素、老兵、精锐；等级修正只进入战斗快照。
- 「部队」页面：筛选、排序、档案详情、呼号编辑、等级进度和有效战斗属性。
- 三个重复任务：`salvage_run`、`convoy_escort`、`outpost_sweep`；包含占领门槛、固定成本、确定性奖励、冷却、任务战报和离线就绪提示。
- 基地 Canvas 集结区老兵标记、战区重复任务卡、操作战报与调试接口。

## 主要修改文件

- 配置/状态：`js/config.js`、`js/state.js`、`js/utils.js`。
- 完整性与科研：`js/integrity.js`、`js/research.js`、`js/production.js`、`js/repairs.js`、`js/save.js`。
- 单位与行动：`js/units.js`、`js/operations.js`、`js/battle.js`、`js/theater.js`、`js/offline.js`。
- 表现与接线：`js/renderer.js`、`js/ui.js`、`js/main.js`、`js/events.js`、`css/style.css`。
- 测试与文档：`tests/stage8-test.mjs`、`README.md`、`progress.md`。

## 自动测试

执行命令：

```bash
npm test
```

实际结果：

| 测试 | 结果 |
| --- | ---: |
| Stage3 | 63 / 63 |
| Stage4 | 76 / 76 |
| Stage5 | 99 / 99 |
| Stage6 | 116 / 116 |
| Stage7 | 65 / 65 |
| Stage8 | 90 / 90 |
| 合计 | **509 / 509** |

## 浏览器验收

本地服务：`http://127.0.0.1:8000/`  
验收路径：部队档案 → 编队集结 → 已占领战区 → 选择废料回收重复任务 → 派遣 → 结算 → 返回基地 → 战报。

实际结果：

- `dispatch=true`
- `settle=true`
- `close=true`
- 历史战报：`1` 份
- `window.render_game_to_text()`：阶段 8、基地视图、活动战斗 `false`
- Playwright 页面错误：`0`

截图已作为真实 PNG 文件包含在 `screenshots/`：

- `stage8-units.png`
- `stage8-veteran-rally.png`
- `stage8-operations.png`
- `stage8-operation-report.png`

## 未解决问题

没有发现阻塞 Stage8 交付的功能问题。当前明确保留的范围是：装备系统、新战区、随机事件和战斗中手动指挥未实现。

## Stage9 预留接口

- 单位属性快照保留 `base` / `rankModifiers` 分层，可在其上叠加装备修正。
- `OPERATIONS` 使用独立任务配置和 `missionKind`，可扩展新战区与新任务而不改变战役结算路径。
- 战报比较器按任务元数据和快照字段比较，可继续承载新战区规则。
