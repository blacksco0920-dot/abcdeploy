# desktop-command-surface-governance Specification

## Purpose
TBD - created by archiving change retire-legacy-desktop-command-surface. Update Purpose after archive.
## Requirements
### Requirement: 注册命令必须具有可验证的运行时消费者
项目 MUST 使每个桌面生产调用都对应一个已注册 Tauri 命令，并且每个注册命令 MUST 具有当前生产消费者或记录明确的非前端运行时职责。

#### Scenario: 生产客户端调用桌面命令
- **WHEN** 生产 TypeScript 新增一个静态 Tauri `invoke` 命令名
- **THEN** 项目门禁确认该命令已在当前 Tauri handler 中注册

#### Scenario: 注册命令没有生产消费者
- **WHEN** Tauri handler 中的命令无法对应生产前端调用或明确的非前端运行时职责
- **THEN** 该命令及其专属适配实现必须被删除，或以逐项说明的受控例外阻止门禁失败

#### Scenario: 源码包装没有进入 Tauri 生产路径
- **WHEN** 一个 `invoke` 包装被最终生产 bundle 的 tree-shaking 移除，或只存在于非 Tauri 回退分支
- **THEN** 该包装不能单独证明命令具有生产消费者，系统必须继续删除该 endpoint 或提供其他可验证运行时职责

### Requirement: 退役判断必须保护数据兼容职责
项目 MUST 根据生产调用、内部调用、持久化迁移和恢复职责共同判断代码是否冗余，MUST NOT 仅凭 `legacy` 名称、旧测试存在或文件体积删除兼容代码。

#### Scenario: 旧记录仍需要兼容读取
- **WHEN** 一个没有当前公开 UI 入口的仓储方法仍参与数据库迁移、旧记录恢复或当前聚合投影
- **THEN** 系统保留该内部能力及覆盖其数据场景的测试，同时允许删除已经无消费者的公开命令适配器

#### Scenario: 代码只服务已退役入口
- **WHEN** 一个命令、类型或辅助函数没有生产调用、内部调用、迁移职责或当前行为测试依据
- **THEN** 该代码与仅为它存在的测试和依赖必须被删除

### Requirement: 清理不得改变当前部署行为
命令面退役后，项目 MUST 保持本地文件夹来源、本机运行、Linux 服务器上线、更新、恢复、失败保留在线版本和重启恢复的当前可观察行为。

#### Scenario: 当前主线经过清理
- **WHEN** 用户通过当前部署编辑器执行任一已实现的部署路径
- **THEN** 前端仍能通过类型化 API 调用已注册命令，并获得与清理前等价的状态、结果和错误信息

#### Scenario: 运行完整回归
- **WHEN** 命令面清理完成
- **THEN** Rust、TypeScript、Workspace、构建、项目治理和密钥检查门禁全部通过

### Requirement: 实现资产必须反映实际命令主线
项目 MUST 在命令注册、调用入口变化后同步实现证据索引与 CodeGraph，使新会话不会从文档恢复到已退役入口。

#### Scenario: 命令或入口被删除
- **WHEN** 本变更移除或迁移一个文档记录的命令入口
- **THEN** 实现证据索引、架构债务描述和 CodeGraph 在同一变更中更新并通过项目质量检查
