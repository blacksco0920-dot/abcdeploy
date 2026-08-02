## ADDED Requirements

### Requirement: 桌面部署调用遵循单向分层
当前部署主线 MUST 从 React Feature 经类型化 API、Tauri command、应用服务进入仓储与 Provider，并且下层 MUST NOT 反向依赖 React 或由 command 直接混合 SQL、Provider 请求和用户页面决策。

#### Scenario: Feature 发起部署用例
- **WHEN** 部署编辑器解析来源、准备环境、开始部署或验证结果
- **THEN** Feature 通过领域化类型 API 调用稳定 Tauri command，由应用服务编排仓储和 Provider

#### Scenario: 注册桌面命令
- **WHEN** 应用装配注册生产 Tauri command
- **THEN** command 只执行边界校验、状态获取、应用服务委派和稳定错误映射

### Requirement: 结构迁移保持公开契约与部署事实
模块迁移期间，系统 MUST 保持现有生产命令名、序列化参数、返回结构、稳定错误代码、数据库 schema 和当前部署事实兼容。

#### Scenario: 客户端升级后恢复已有部署
- **WHEN** 用户在重构后的客户端打开由迁移前版本保存的部署记录
- **THEN** 系统仍能恢复项目、线路、当前在线版本、失败尝试和验证证据，不要求重新创建部署

#### Scenario: 更新或恢复失败
- **WHEN** 重构后的更新或版本恢复在验证完成前失败
- **THEN** 系统追加失败事实且不移动当前在线版本指针，与迁移前行为一致

### Requirement: 主线按产品用例具有稳定代码入口
项目 MUST 为来源、本机运行、服务器上线、部署查询与证据、更新和恢复提供可从实现资产定位的 command、application、workspace 与 Provider 起点。

#### Scenario: 新会话定位服务器上线链
- **WHEN** 一个没有历史聊天上下文的新会话按实现证据索引查询服务器上线
- **THEN** 它能定位类型化前端入口、Tauri command、应用服务、仓储和 Provider，而不需要遍历超大入口文件猜测主线

#### Scenario: 入口发生移动
- **WHEN** 一个部署用例迁入新模块
- **THEN** 同一变更更新实现证据索引、文件预算和 CodeGraph，并移除旧位置的重复实现

### Requirement: 超限迁移文件只能持续缩小
`lib.rs`、`api.ts`、`workspace.rs` 等现有超限迁移文件 MUST 在本变更中净缩小，且新增职责 MUST 进入与产品用例对应的模块。

#### Scenario: 迁移一个用例切片
- **WHEN** command、应用服务或仓储实现从超限文件迁出
- **THEN** 原文件删除对应实现，新模块符合默认预算或具有更小且有依据的棘轮预算

#### Scenario: 实现需要共享逻辑
- **WHEN** 多个用例复用同一仓储或 Provider 行为
- **THEN** 共享逻辑位于下层窄接口而不是复制回 `lib.rs`、`api.ts` 或 Feature 控制器

### Requirement: 每个迁移切片必须证明行为等价
项目 MUST 通过命令契约、应用服务、Workspace 数据不变量和 React 用户行为测试验证每个迁移切片，MUST NOT 仅以编译通过或文件移动宣称完成。

#### Scenario: 完成一个垂直切片迁移
- **WHEN** 一个部署用例的实现迁入新边界
- **THEN** 该用例的参数、错误、持久化、失败恢复和用户可见回归测试全部通过后才删除旧实现
