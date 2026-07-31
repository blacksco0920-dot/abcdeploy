## ADDED Requirements

### Requirement: 固定的新会话冷启动入口
项目 MUST 为新 AI 会话提供唯一且精简的冷启动入口，入口 MUST 给出必读顺序、每份资产的职责以及继续定位实现的方法。

#### Scenario: 新会话进入仓库
- **WHEN** 一个不具备历史聊天上下文的新会话开始处理 ABCDeploy
- **THEN** 会话能够从 `AGENTS.md` 和文档地图获得有限、确定的阅读顺序，而不需要遍历全部文档或历史原型

### Requirement: 当前能力使用互斥状态
项目 MUST 使用 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`NEXT`、`TARGET` 和 `OUT_OF_SCOPE` 对关键能力进行互斥分类，且每项当前结论 MUST 包含可定位的依据或明确的决策来源。

#### Scenario: 代码已实现但用户尚未验收
- **WHEN** 代码中存在更新部署、版本历史或回退能力，但没有用户真实验收证据
- **THEN** 当前状态将其标记为 `IMPLEMENTED_UNVERIFIED`，而不是 `VERIFIED` 或笼统的“已支持”

#### Scenario: 仅存在长期产品目标
- **WHEN** 产品契约描述了仓库地址来源等方向，但当前代码明确未接通
- **THEN** 当前状态将其标记为 `TARGET`，并指向对应实现缺口

### Requirement: 不同问题域具有明确权威来源
项目 MUST 为产品目标、当前状态、可执行行为、技术边界、实现定位和进行中变更分别指定权威来源；发生冲突时 MUST 按问题域裁决并记录偏差。

#### Scenario: 产品契约与当前代码不一致
- **WHEN** 稳定产品契约要求某项行为而当前代码尚未实现
- **THEN** 项目保留产品契约并在当前状态或实现清单记录实现偏差，不得用现状反向删除产品目标，也不得把目标宣称为当前能力

### Requirement: 历史资产不参与当前事实裁决
历史原型、旧设计和归档资料 MUST 被标识为非权威参考，并且 MUST 从新会话的默认阅读路径中排除。

#### Scenario: 仓库仍保留历史 HTML 原型
- **WHEN** 新会话发现 `docs/product-prototype/` 等历史资产
- **THEN** 文档地图明确说明这些资产仅用于追溯，当前产品和实现判断以当前状态、产品契约、架构和代码为准

### Requirement: 变更计划与代码定位可恢复
项目 MUST 使用仓库内 OpenSpec/Comet 保存进行中和已归档变更，并使用 CodeGraph 或实现清单提供代码入口；关键决定 MUST NOT 只存在于聊天记录。

#### Scenario: 新会话恢复未完成工作
- **WHEN** 仓库存在 active Comet/OpenSpec change
- **THEN** 新会话能够从当前状态或工具状态定位该 change，并从其 proposal、design、specs 和 tasks 恢复工作范围与进度

### Requirement: 冷启动审计能够验证上下文完整性
项目 MUST 提供一套不依赖历史聊天的冷启动审计，审计 MUST 能回答已验证能力、未验证实现、最近下一步、禁止事项以及主要代码入口。

#### Scenario: 治理变更准备完成
- **WHEN** 本次项目资产治理进入验证阶段
- **THEN** 审计仅依赖冷启动入口所列资产即可回答五个必答问题，并能为每个答案指出来源

#### Scenario: 必答问题只能通过猜测回答
- **WHEN** 审计需要读取旧会话、遍历全部仓库或根据文件名猜测才能回答任一必答问题
- **THEN** 项目上下文恢复能力判定为未通过，治理变更不得标记完成
