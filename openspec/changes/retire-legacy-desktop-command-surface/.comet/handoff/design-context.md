# Comet Design Handoff

- Change: retire-legacy-desktop-command-surface
- Phase: design
- Mode: compact
- Context hash: 87aa779ceb665770639b4fc4d473e9b104bb5558542368d2a84a4e954cf7f6c5

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/retire-legacy-desktop-command-surface/proposal.md

- Source: openspec/changes/retire-legacy-desktop-command-surface/proposal.md
- Lines: 1-29
- SHA256: 1a3f7194729ce48b478515a3230897cbee777902b9ed5162a87242f805e920ca

```md
## Why

当前桌面运行时同时暴露新部署主线和已经没有生产前端入口的旧命令面：Tauri 注册的 111 个命令中，静态核对只有 56 个被当前生产前端调用。继续保留不可达入口、旧 API 再导出和无用途依赖，会让后续迭代误接旧工作流，也使 `lib.rs`、`api.ts` 的真实主线难以辨认，因此需要先以可达性证据完成一次受控退役。

## What Changes

- 建立生产前端调用、Tauri 注册、命令实现、内部调用与兼容职责之间的可审计清单。
- 删除确认没有生产入口、内部调用或必要兼容职责的 Tauri 命令适配层及其专属实现。
- 删除只服务已退役入口的前端 API 门面、测试与无生产用途依赖。
- 保留数据库迁移、旧记录读取、重启恢复和当前主线仍依赖的内部仓储及 Provider 能力。
- 增加门禁，防止注册命令与生产客户端调用关系再次无说明地扩张。
- 同步当前实现证据索引、架构债务记录和 CodeGraph，使文档只指向实际生产主线。

## Capabilities

### New Capabilities

- `desktop-command-surface-governance`: 定义桌面命令注册、生产调用可达性、兼容保留依据和退役验证要求。

### Modified Capabilities

无。

## Impact

- 主要影响 `apps/desktop/src/api.ts`、`apps/desktop/src/api/`、`apps/desktop/src-tauri/src/lib.rs` 及仅被退役入口使用的相邻实现和测试。
- 可能移除 `apps/desktop/package.json` 与 Tauri 配置中的无用依赖或权限，但不改变当前用户可见部署行为。
- `WorkspaceState` 的迁移、兼容读取和当前部署聚合不因“legacy”命名被删除；只有具备调用与数据证据的代码才会退役。
- 完成后更新 `docs/internal/implementation-inventory.md`、相关质量门禁与 CodeGraph 索引。

```

## openspec/changes/retire-legacy-desktop-command-surface/design.md

- Source: openspec/changes/retire-legacy-desktop-command-surface/design.md
- Lines: 1-63
- SHA256: d9cab7b8786dbd4768b3a0c99ba5adcc3b0a1200ee9e9e2e91a9d35af8685b82

```md
## Context

当前生产前端通过 `api.ts` 与 `api/` 调用 Tauri。审计基线中，`generate_handler!` 注册 111 个命令，而生产 TypeScript 只包含 56 个对应调用字符串；另有若干 API 再导出只由旧测试使用。Rust 的严格 clippy 和 TypeScript 未使用检查仍通过，是因为公开命令、导出函数和被测试的兼容实现不会被常规 dead-code 检查识别。

与此同时，`workspace.rs` 的迁移与兼容读取仍在恢复旧部署记录，`mvp_environment.rs` 也通过显式桥接把当前编辑器输入转换为既有部署执行数据。文件或符号名称中的 `legacy` 不能作为删除依据。本变更必须用“生产可达性 + 内部依赖 + 持久化兼容职责 + 测试事实”共同裁决。

## Goals / Non-Goals

**Goals:**

- 让动态注册的桌面命令与当前生产客户端调用面一致，例外均有明确兼容依据。
- 删除已退役入口的专属实现、前端门面、权限和依赖，而不是只从注册列表隐藏。
- 保留当前部署主线、数据迁移、旧记录恢复及其回归测试。
- 用自动门禁防止无消费者命令和测试专用门面重新累积。

**Non-Goals:**

- 不改变产品交互、部署状态机或 Provider 选择。
- 不删除仅因名称含 `legacy` 而被怀疑的迁移、桥接或恢复代码。
- 不在本变更中进行大规模目录重构；主线边界迁移由后续 change 负责。
- 不实现仓库 URL 来源。

## Decisions

### 1. 使用证据矩阵裁决每个候选入口

每个注册命令至少记录生产调用者、Rust 内部调用者、持久化/迁移职责、测试覆盖和处置结论。只有生产调用、内部调用及必要兼容职责均为空时，才可以删除命令与专属实现。

备选方案是按名称或注册与调用集合差集直接删除。该方案速度快，但会误删由当前主线间接复用的 `*_inner`、仓储方法或旧数据恢复逻辑，因此不采用。

### 2. 从边界向内删除，保留共享内核

先删除不可达的前端门面与 Tauri 命令适配器，再由编译器、调用图和测试识别其专属类型、辅助函数及依赖。仍被当前命令、迁移或内部服务使用的仓储和 Provider 方法保留，即便它们曾服务旧界面。

备选方案是整段删除“旧本机运行”“旧 staging/production”等历史模块。由于当前服务器主线仍复用部分既有执行内核，整段删除风险不可控，因此不采用。

### 3. 动态边界采用显式可达性门禁

新增项目检查，提取生产 TypeScript 的静态 Tauri 命令名与 Rust `generate_handler!` 注册名。生产调用必须全部已注册；注册但没有生产调用的命令必须被删除，或进入小型、带原因的显式允许清单。允许清单只适用于确有非前端动态消费者或迁移需求的边界入口，不能用来批量掩盖旧命令。

### 4. 兼容代码以数据场景而非历史标签保留

旧数据库升级、项目迁移、重启恢复和当前在线版本保留通过现有临时 SQLite 测试继续验证。删除前后均以行为测试证明兼容性，不把注释或文件名当作保留证据。

## Risks / Trade-offs

- [动态构造命令名未被静态提取] → 先确认生产代码不存在动态拼接，门禁同时拒绝不可解析的直接 `invoke` 用法。
- [测试依赖旧入口导致删除面过大] → 区分“测试当前行为”和“仅为旧公开入口存在的测试”，先保留领域/仓储断言，再删除旧命令级断言。
- [共享辅助函数被误判为专属实现] → 每次删除后运行 Rust/TypeScript 编译、受影响测试和完整门禁，并使用 CodeGraph 与 `rg` 复核调用者。
- [允许清单演变成新的垃圾场] → 每项必须包含命令、消费者/兼容原因和审查说明，项目质量检查限制无说明新增。

## Migration Plan

1. 固化 111/56 审计基线并建立候选命令证据矩阵。
2. 先删除无生产消费者的前端再导出和无用依赖。
3. 按相互依赖的命令簇逐批删除 Tauri 适配器及专属实现，每批运行受影响测试。
4. 增加动态命令面一致性门禁，更新文档和 CodeGraph。
5. 运行完整项目门禁。若出现无法证明安全的兼容缺口，回退对应命令簇，而不是恢复所有旧入口。

## Open Questions

- 哪些无前端调用的注册命令存在非 React 消费者，需要在实施时通过仓库搜索与运行入口逐项确认。
- 旧配置 profile 的仓储能力被本机基础设施内部使用，但其公开 CRUD 命令可能已退役；实施时需要把共享仓储与公开命令分开裁决。

```

## openspec/changes/retire-legacy-desktop-command-surface/tasks.md

- Source: openspec/changes/retire-legacy-desktop-command-surface/tasks.md
- Lines: 1-27
- SHA256: b225ec4339866c1aa88b28067c4b7854d17eed26fd7eaf538452306b5926060e

```md
## 1. 固化可达性证据

- [ ] 1.1 增加可重复的审计脚本，提取生产 TypeScript `invoke` 命令与 Rust `generate_handler!` 注册命令，并先用测试覆盖未注册调用和无说明注册入口
- [ ] 1.2 为所有候选旧命令建立生产调用、内部调用、迁移职责、测试依据和处置结论矩阵
- [ ] 1.3 通过 CodeGraph、`rg` 和动态注册源码复核命令簇影响范围，标出必须保留的 Workspace、Provider 与恢复逻辑

## 2. 收缩前端边界

- [ ] 2.1 删除无生产消费者的 `api.ts` 再导出和仅服务退役入口的 API 模块代码，并调整对应测试
- [ ] 2.2 删除确认无生产用途的前端依赖、Tauri 权限或配置，并验证当前剪贴板、对话框和打开链接能力不受影响
- [ ] 2.3 运行 TypeScript 严格未使用检查、前端测试和生产构建，确认类型化客户端调用集合稳定

## 3. 退役旧 Tauri 命令簇

- [ ] 3.1 删除无当前消费者的旧预检、Manifest 与项目步骤命令簇，同时保留当前源码快照和项目恢复入口
- [ ] 3.2 删除无当前消费者的旧本机准备/服务控制命令簇，同时保留受管运行工作区、当前启动与连续验证主线
- [ ] 3.3 删除无当前消费者的旧 staging/production、路由修复和外部同步命令簇，同时保留当前 deployment-path 执行、更新和恢复内核
- [ ] 3.4 删除无当前消费者的旧配置、运行时秘密和 Provider 管理命令簇，同时保留当前授权、仓储迁移和部署准备所需共享能力
- [ ] 3.5 根据编译器和调用图继续删除只服务退役命令的类型、辅助函数与测试，不删除仍覆盖当前数据兼容行为的断言

## 4. 治理与验证

- [ ] 4.1 把桌面命令面一致性检查接入 `pnpm check:project`，并要求所有保留例外具有逐项原因
- [ ] 4.2 更新 `docs/internal/implementation-inventory.md`、相关架构债务和当前状态证据，不把自动测试升级为用户验收
- [ ] 4.3 重建并同步 CodeGraph，确认文档中的稳定入口和调用关系指向清理后的主线
- [ ] 4.4 运行 `pnpm check:project`、`pnpm check:secrets`、受影响测试与完整 `pnpm check`，记录命令数量、删除规模和验证结果
- [ ] 4.5 运行 `pnpm tauri:build:app` 生成签名的 macOS Apple Silicon `.app`，完成启动与当前主线基本烟测且不触发正式发布

```

## openspec/changes/retire-legacy-desktop-command-surface/specs/desktop-command-surface-governance/spec.md

- Source: openspec/changes/retire-legacy-desktop-command-surface/specs/desktop-command-surface-governance/spec.md
- Lines: 1-45
- SHA256: d61a5edff721c417448aba33df32a3baf9ec2f97c957ad52d6c986ee4d8cc396

```md
## ADDED Requirements

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

```
