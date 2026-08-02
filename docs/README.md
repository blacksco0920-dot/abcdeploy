# ABCDeploy 文档地图

`docs/` 的默认导航只包含当前有效定义。新会话默认只读 [当前状态](current-state.md)，再按任务的问题域选择权威材料；仍被保留的历史原型和 archived changes 不进入默认导航，也不参与当前事实裁决。

## 问题域权威

| 问题域 | 权威文档 | 何时读取 |
| --- | --- | --- |
| 已验收事实、未验证实现、下一步与禁区 | [当前状态](current-state.md) | 新会话默认入口。 |
| 用户最终应经历的规则 | [产品合同](product-contract.md) | 产品行为或用户体验发生冲突时。 |
| 代码怎样承载产品模型 | [工程架构](architecture.md) | 设计边界、分层、状态机或依赖方向时。 |
| 当前实现入口、调用链、测试起点、明确缺口与迁移债务 | [实现证据索引](internal/implementation-inventory.md) | 修改代码、迁移或定位影响范围时。 |
| 页面表达、验收与工程维护 | [前端规范](frontend-design-guidelines.md)、[实施验收](implementation-acceptance.md)、[工程质量规范](engineering-quality.md) | 任务直接涉及相应问题域时。 |

产品规则冲突以产品合同为准；实现边界冲突以工程架构为准；当前可用性与验收事实以当前状态为准。当前代码、自动测试、历史页面和原型不得反向改写产品合同。

## 有限阅读顺序

1. 先阅读 [当前状态](current-state.md)，确定当前事实和禁区。
2. 只按任务需要阅读上表对应的产品、架构或实现材料。
3. 修改代码时，再进入 [内部实施资料](internal/README.md) 查询 CodeGraph 和迁移细节；它不属于产品定义。
4. 读取 `.comet/current-change.json` 并用对应 workflow 的只读状态确认 active change：Native 从 `docs/comet/changes/` 恢复，Classic/OpenSpec 从 `openspec/changes/` 恢复；不默认遍历其他变更或历史资产。

稳定产品规则只在 [产品合同](product-contract.md) 维护；本页只负责导航，不复述产品模型、对象或成功判定。

## 历史追溯

以下资产是历史讨论记录，非当前产品、实现或完成状态的依据，仅用于追溯：

- [历史产品原型](product-prototype/index.html)

新会话冷启动和当前任务不得要求读取该页面。历史内容与当前权威文档冲突时，直接忽略历史内容；是否继续保留或删除由对应 change 明确决定。

## 导航维护

- 新结论直接更新上表对应的权威文档，不在本页增加第二套产品、状态、架构或实现定义。
- 新增当前维护的顶层 `docs/*.md` 时必须加入上表；没有独立问题域的重复文档应合并或删除。
- 历史资产只能从“历史追溯”区进入；默认阅读顺序不得要求读取它们。
- 文档入口或职责变化时同步 `AGENTS.md`、根 `README.md` 和本页；其余维护要求见 [工程质量规范](engineering-quality.md)。
