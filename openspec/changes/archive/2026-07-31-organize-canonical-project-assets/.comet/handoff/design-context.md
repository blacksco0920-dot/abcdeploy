# Comet Design Handoff

- Change: organize-canonical-project-assets
- Phase: design
- Mode: compact
- Context hash: 54beed963f67e569d237dc4739d4e6cdb521931cea572510883e28179ba0752b

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/organize-canonical-project-assets/proposal.md

- Source: openspec/changes/organize-canonical-project-assets/proposal.md
- Lines: 1-29
- SHA256: 700d9760ae8ecb4057bbb0ce65ac4be7534259248acb905a43002f9dcd160573

```md
## Why

ABCDeploy 的产品结论、实现状态和历史方案目前混杂在多份文档、原型、代码与长会话中，新会话容易把“目标设计”误当成“已经实现”，或重复读取过时资产。现在需要建立一套分层、可验证的项目事实体系，让任何新 AI 会话都能在很短时间内无偏差地恢复产品边界、当前状态、代码入口和下一步工作。

## What Changes

- 建立唯一的 AI 冷启动入口和固定阅读顺序，明确文档、代码、测试、OpenSpec/Comet 与历史资产之间的权威关系。
- 新增当前状态台账，严格区分 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`NEXT`、`TARGET` 和 `OUT_OF_SCOPE`，并为关键结论附上证据来源。
- 收敛根 README、产品契约、架构文档和实现清单的职责，消除“进度事实”和“长期目标”混写造成的矛盾。
- 将历史原型与历史设计降级为非权威参考；保留现有资产，不以破坏性删除或覆盖用户未提交改动的方式治理。
- 使用仓库内 OpenSpec/Comet 记录后续变更，用 CodeGraph 指向实现入口，避免关键决定只存在于聊天上下文。
- 增加冷启动验收标准：新会话只读取入口资产后，必须能够回答已验证能力、未验证实现、下一步、禁止事项及主要代码入口。

## Capabilities

### New Capabilities

- `project-context-recovery`: 定义 ABCDeploy 项目事实的分层、状态分类、权威顺序、变更留痕与新会话冷启动验收要求。

### Modified Capabilities

无。

## Impact

- 受影响资产：`AGENTS.md`、根 `README.md`、`docs/` 当前文档、`docs/internal/` 实现资料、仓库内 `openspec/` 与 Comet 状态资产。
- 不修改产品运行逻辑、用户界面、部署流程、应用版本号、安装包或发布产物。
- 不引入新的生产依赖，不回退、不整理与本次治理无关的未提交代码。
- 后续会话的工作入口将从“遍历全部文档和历史聊天”改为“读取固定入口 → 查看当前状态 → 按 CodeGraph/实现清单定位代码 → 按 OpenSpec/Comet 恢复变更”。

```

## openspec/changes/organize-canonical-project-assets/design.md

- Source: openspec/changes/organize-canonical-project-assets/design.md
- Lines: 1-115
- SHA256: b7160556c15f53c893f13552717e2840444a524f3b1a5c17678a752f171e6e04

[TRUNCATED]

```md
## Context

ABCDeploy 已经过多轮产品重构和真实上线验证。仓库中同时存在稳定产品原则、当前实现、尚未验证的功能、长期目标、历史原型以及长会话交接信息。现有文档虽已开始收敛，但仍存在三类风险：目标能力被写成当前能力、代码已变化而进度文档未同步、历史原型被新会话误当成实现依据。

本次治理面向项目维护者和后续 AI 会话。约束包括：保留当前脏工作区中的用户资产；不修改运行逻辑；不依赖聊天历史作为唯一事实来源；所有结论必须能定位到用户验收、代码、测试、CodeGraph 或明确的产品决策。

## Goals / Non-Goals

**Goals:**

- 让新会话通过固定入口在短时间内恢复产品目标、当前事实、工作边界和代码入口。
- 将稳定规则、当前状态、技术架构、实现证据、变更计划和历史参考分层管理。
- 用统一状态枚举阻止“目标”“实现”“验证”相互冒充。
- 为文档冲突、过期检测和变更留痕建立明确规则。
- 让 CodeGraph 服务于代码定位，让 OpenSpec/Comet 服务于变更恢复，两者不替代产品事实文档。

**Non-Goals:**

- 不调整用户界面、部署业务、Provider 行为或数据模型。
- 不删除历史原型、历史分支或用户未提交改动。
- 不把全部代码细节复制进文档，也不要求新会话读取全部仓库后才能开始工作。
- 不把尚未完成或尚未验证的能力包装成推广状态。

## Decisions

### 1. 采用分层事实体系

项目资产按职责分为六层：

| 层级 | 主要资产 | 只回答的问题 |
| --- | --- | --- |
| 会话入口 | `AGENTS.md`、根 `README.md` | 先读什么、必须遵守什么、如何开始 |
| 当前事实 | `docs/current-state.md` | 现在已验证什么、实现了什么、下一步是什么 |
| 稳定契约 | `docs/product-contract.md` | 产品为什么存在、哪些规则长期稳定 |
| 技术边界 | `docs/architecture.md` | 系统如何分层、能力和数据由谁负责 |
| 实现证据 | `docs/internal/implementation-inventory.md`、CodeGraph | 代码入口、调用关系、实现缺口在哪里 |
| 变更历史 | OpenSpec/Comet、Git | 当前正在改变什么、为什么改变、如何验收 |

选择分层而不是单一“大总览文档”，因为不同事实的变化频率不同。单一文档短期易读，但会迅速混入目标、进度和实现细节；分层后每份资产的更新责任明确，冷启动仍由入口文档控制阅读量。

### 2. 当前能力必须使用显式状态枚举

`docs/current-state.md` 对每项关键能力只能标记为以下状态之一：

- `VERIFIED`：用户已在真实流程中确认，且有可定位证据。
- `IMPLEMENTED_UNVERIFIED`：代码存在，但用户尚未完成真实验收。
- `NEXT`：已经确认进入最近实施范围，但尚未完成。
- `TARGET`：产品方向或长期目标，不承诺当前可用。
- `OUT_OF_SCOPE`：当前明确不做或禁止引入的范围。

不使用“基本完成”“应该可用”“支持”等模糊表达替代状态。选择显式枚举，是为了让新会话无法仅凭自然语言乐观推断完成度。

### 3. 采用问题域优先的权威顺序，而不是一条全局优先级

发生冲突时按问题类型判断：

- 产品目标与交互原则：以 `docs/product-contract.md` 为准。
- 当前完成度与验收状态：以 `docs/current-state.md` 为准。
- 可执行行为：以当前代码和有效测试为准；若与产品契约冲突，记录为实现偏差，不反向改写产品契约。
- 技术归属与边界：以 `docs/architecture.md` 为准。
- 代码入口和调用关系：以同步后的 CodeGraph 与实现清单为准。
- 正在进行的改动：以 active OpenSpec/Comet change 为准。
- 历史原型和归档材料：仅作背景，不参与当前裁决。

这比“代码永远最高”更准确，因为代码能证明当前行为，却不能决定产品应当是什么。

### 4. 历史资产保留但退出当前导航

现有 `docs/product-prototype/index.html` 等历史资产不做破坏性删除；当前文档地图必须明确标记其为非权威参考，并且 AI 冷启动路径不得要求读取。文档中“原型已删除”等与实际文件不一致的表述改为“原型不再作为当前实现依据”。

保留资产便于追溯，也避免覆盖用户未提交工作；退出导航则降低新会话误用风险。

### 5. OpenSpec/Comet 与 CodeGraph 各司其职

- OpenSpec/Comet 记录一个变更的动机、规范、设计、任务和验证证据。
- CodeGraph 只负责从符号和调用关系定位当前实现，不承载产品状态。
- `docs/current-state.md` 只保留对 active change 和关键代码入口的链接，不复制变更全文或代码图谱。

这样可以避免文档再次膨胀，同时保证新会话能从事实跳到计划、再跳到代码。


```

Full source: openspec/changes/organize-canonical-project-assets/design.md

## openspec/changes/organize-canonical-project-assets/tasks.md

- Source: openspec/changes/organize-canonical-project-assets/tasks.md
- Lines: 1-26
- SHA256: 4f5cf83a166a701cf6a912f2cce85d0a41146f58ee1cc5514117f5aaf4c7dad3

```md
## 1. 建立唯一的当前事实入口

- [ ] 1.1 新增 `docs/current-state.md`，用 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`NEXT`、`TARGET`、`OUT_OF_SCOPE` 记录能力状态、证据和更新时间
- [ ] 1.2 更新 `AGENTS.md`，加入一分钟冷启动协议、固定阅读顺序和事实冲突处理规则
- [ ] 1.3 更新根目录 `README.md` 与 `docs/README.md`，明确文档职责、权威层级和当前文档导航

## 2. 消除文档资产中的事实冲突

- [ ] 2.1 调整 `docs/product-contract.md`，只保留稳定产品契约，并将实现进度统一指向 `docs/current-state.md`
- [ ] 2.2 调整 `docs/architecture.md`，保留技术边界和代码入口，不再用目标设计冒充已验证能力
- [ ] 2.3 更新 `docs/internal/implementation-inventory.md`，按代码证据列出已实现能力、未接通入口和主要模块
- [ ] 2.4 修正“代码仓库地址已支持”和“产品原型已删除”等已发现的矛盾表述
- [ ] 2.5 将 `docs/product-prototype/` 明确标记为历史讨论资产，并从当前文档主导航中移除其权威地位

## 3. 建立可持续的变更与代码导航机制

- [ ] 3.1 在文档中明确 OpenSpec/Comet 负责需求与决策历史，CodeGraph 负责代码定义、调用关系和影响范围
- [ ] 3.2 更新 CodeGraph 说明与当前代码入口索引，使后续会话能从业务能力快速定位到 Feature、应用服务、仓储和 Provider
- [ ] 3.3 记录本次治理的变更依据和维护规则，禁止后续文档重新混写目标、实现和验收状态

## 4. 验证新会话冷启动质量

- [ ] 4.1 模拟无历史上下文的新会话，验证其能准确回答已验证能力、未验证实现、下一步、禁止事项和代码入口五个问题
- [ ] 4.2 校验所有当前文档链接、状态枚举、权威引用和 OpenSpec 变更资产的一致性
- [ ] 4.3 运行 `pnpm check:project`、`pnpm check:secrets` 与受影响的文档检查，并同步 CodeGraph
- [ ] 4.4 将验证证据写回 `docs/current-state.md` 和本变更任务清单，确保结论可追溯

```

## openspec/changes/organize-canonical-project-assets/specs/project-context-recovery/spec.md

- Source: openspec/changes/organize-canonical-project-assets/specs/project-context-recovery/spec.md
- Lines: 1-51
- SHA256: 5fd27edc52f1497574690667c285ffcf80ef3d2670396076d8ada8a5741ca688

```md
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

```
