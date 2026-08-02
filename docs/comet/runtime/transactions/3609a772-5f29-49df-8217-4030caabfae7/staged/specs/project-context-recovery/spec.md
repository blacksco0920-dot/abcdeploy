# project-context-recovery Specification

## Purpose

定义 ABCDeploy 在不依赖历史聊天的前提下恢复当前产品事实、实现入口、变更状态与工作约定的项目资产、事实一致性和验证要求。

## Requirements

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

### Requirement: 目标规则与当前可用性就近区分

面向新贡献者的入口和专题文档在描述尚未接通的目标能力时 MUST 就近标识目标属性并指向当前状态，不得使用容易被理解为当前已可用的无条件陈述。

#### Scenario: README 描述四种 MVP 组合

- **WHEN** 根 README 或专题文档说明代码仓库来源与本机、服务器组合
- **THEN** 文档明确这些组合是稳定 MVP 目标，并链接当前状态确认各组合的实际可用性

### Requirement: 历史资产不参与当前事实裁决

历史原型、旧设计和归档资料 MUST 被标识为非权威参考，并且 MUST 从新会话的默认阅读路径中排除。

#### Scenario: 仓库仍保留历史 HTML 原型

- **WHEN** 新会话发现 `docs/product-prototype/` 等历史资产
- **THEN** 文档地图明确说明这些资产仅用于追溯，当前产品和实现判断以当前状态、产品契约、架构和代码为准

#### Scenario: 当前文档描述历史原型状态

- **WHEN** 历史 HTML 原型仍存在且带有非权威提示
- **THEN** 当前维护文档不得宣称该原型已经删除，并明确区分被禁止的并行权威原型与允许保留的隔离历史资产

### Requirement: 顶层维护文档必须可发现且职责唯一

当前维护的顶层 `docs/*.md` MUST 从文档地图可达并具有唯一职责；与权威合同重复且没有独立职责的孤立文档 MUST 被合并或删除。

#### Scenario: 新增顶层专题文档

- **WHEN** 仓库新增一个当前维护的顶层 Markdown 文档
- **THEN** 文档地图将其归入明确问题域，或项目门禁因该文档不可发现而失败

#### Scenario: 专题文档重复产品合同

- **WHEN** 一个不在文档地图中的专题文档重复定义产品流程和成功规则
- **THEN** 项目删除或合并该重复定义，而不是形成第二套隐含产品合同

### Requirement: 变更计划与代码定位可恢复

项目 MUST 使用仓库内 OpenSpec/Comet 保存进行中和已归档变更，并使用 CodeGraph 或实现清单提供代码入口；关键决定 MUST NOT 只存在于聊天记录。

#### Scenario: 新会话恢复 Native change

- **WHEN** `.comet/current-change.json` 选择 `workflow: native`
- **THEN** 新会话使用 Native 只读状态确认身份，并从 `docs/comet/changes/<change>/` 恢复 brief、规格、阶段和验证证据

#### Scenario: 新会话恢复 Classic change

- **WHEN** selection 或 Classic/OpenSpec 工具状态指向 Classic change
- **THEN** 新会话从 `openspec/changes/<change>/` 和对应 Comet/OpenSpec 状态恢复 proposal、design、specs、tasks 与验证证据

#### Scenario: 静态状态与 Runtime 状态不同

- **WHEN** 静态文档中的带日期审计事实与当前 selection 或 workflow 只读状态不同
- **THEN** 新会话以 selection 和工具状态判断当前 active change，并更新受影响的稳定状态结论，不把聊天摘要或过期静态断言当作 Runtime 事实

### Requirement: 秘密存储文档与实现边界一致

安全与实现文档 MUST 区分秘密正文、秘密引用、配置状态和非秘密元数据，不得把 SQLite 的全部记录笼统描述为单一布尔状态。

#### Scenario: 记录可复用连接或运行配置

- **WHEN** 系统持久化可复用连接、项目配置或运行秘密
- **THEN** 秘密正文只进入系统密钥库，SQLite 只保存受限秘密引用、状态、非秘密配置与元数据，并且面向前端的投影不泄漏秘密引用或正文

### Requirement: 文档事实回归具有机械门禁

项目 MUST 对可机械判断的文档结构和已知事实矛盾提供本地门禁；门禁 MUST NOT 冒充对全部产品语义的证明。

#### Scenario: 保留原型与删除陈述并存

- **WHEN** 历史原型文件存在且当前维护文档重新宣称它已经删除
- **THEN** `pnpm check:project` 失败并指出冲突文档

#### Scenario: 冷启动缺少 workflow 恢复线索

- **WHEN** 冷启动入口无法区分 Native artifact root 与 Classic/OpenSpec change root
- **THEN** `pnpm check:project` 失败并指出缺少的恢复线索

### Requirement: 冷启动审计能够验证上下文完整性

项目 MUST 提供一套不依赖历史聊天的冷启动审计，审计 MUST 能回答已验证能力、未验证实现、最近下一步、禁止事项以及主要代码入口。

#### Scenario: 治理变更准备完成

- **WHEN** 本次项目资产治理进入验证阶段
- **THEN** 审计仅依赖冷启动入口所列资产和当前 workflow 的只读状态即可回答五个必答问题，并能为每个答案指出来源

#### Scenario: 必答问题只能通过猜测回答

- **WHEN** 审计需要读取旧会话、遍历全部仓库或根据文件名猜测才能回答任一必答问题
- **THEN** 项目上下文恢复能力判定为未通过，治理变更不得标记完成
