# ABCDeploy 当前实现证据索引

> 更新于 2026-08-02。本文只记录当前工作树中的代码、测试和明确缺口，不定义产品，也不把自动测试写成用户验收。产品行为以 [产品合同](../product-contract.md) 为准；所有完成度与用户验收状态只看 [当前状态](../current-state.md)。

## 1. 证据职责与查询边界

- OpenSpec/Comet 保存一次变更的 why、what、任务、验证证据和可恢复状态；先以 `.comet/current-change.json` 和对应 workflow 的只读状态确认 active 身份，再从 Native 的 `docs/comet/changes/` 或 Classic/OpenSpec 的 `openspec/changes/` 恢复，不从聊天摘要重建。
- CodeGraph 只用于定位当前定义、调用者、被调用者和影响范围；它不决定产品目标、完成度或用户验收。
- 本清单把用户能力映射到稳定符号和测试起点。图谱未返回某一层、动态 Tauri 注册无法形成静态边或索引过期时，才使用 `rg` 与对应源码/测试复核，并把缺口写在表中。
- [当前状态](../current-state.md) 只保留状态和上述资产的链接，不复制 change 内容或调用图全文。

## 2. 八类用户能力证据索引

| 用户能力 | 前端入口 | Tauri/应用入口 | 仓储/Provider | 测试 | 技术接通事实与缺口 | CodeGraph 查询词 |
| --- | --- | --- | --- | --- | --- | --- |
| 本地文件夹 | `DeploymentEditorController.resolveLocalPath` → `DeploymentEditorServices.resolveLocalFolder` | `resolve_local_folder_source` → `snapshot_local_source` → `inspect_project` | `source_snapshots.rs` 将内容复制到受管快照目录；`deploy-core::scanner` 识别服务 | `DeploymentEditorController.test.tsx`；`session.test.ts`；`source_snapshots.rs` 单元测试 | 来源解析链已接通：生成不可变快照并拒绝没有 HTTP 服务的来源；图谱没有为 `snapshot_local_source` 标出覆盖测试，测试入口由同文件 `#[cfg(test)]` 回退确认。 | `DeploymentEditorController resolveLocalPath resolve_local_folder_source snapshot_local_source inspect_project` |
| 代码仓库地址 | `DeploymentEditorController.chooseRepository` / `changeRepositoryUrl`；`DeploymentEditorSession` 校验 URL | `defaultDeploymentEditorServices.resolveRepository` 明确抛出“尚未接入当前客户端” | **无当前来源解析仓储或 Provider 链。** 既有 `CnbClient` 和 `sync_project_to_cnb` 服务于本地源码同步，不能算作仓库地址读取 | `session.test.ts`；`DeploymentEditorController.test.tsx` 的未接通回归 | 来源解析链未接通：只有候选值、格式校验和如实失败，不能进入本机或服务器运行；图谱也未返回 Tauri、仓储或 Provider 入口。 | `chooseRepository changeRepositoryUrl resolveRepository DeploymentEditorSession repository source` |
| 本机运行 | `DeploymentEditorController.startLocal` → `useLocalRunVerification` | `create_managed_local_run_workspace`、`start_local_preview`、`verify_managed_local_run` | `source_snapshots.rs` 创建受管运行副本；`lib.rs` 仍集中持有本机进程/容器启动与取消状态 | `DeploymentEditorController.test.tsx`；`source_snapshots.rs`；`deployment-evidence/model.test.ts` | 快照、启动和连续验证链已接通；本机运行应用服务仍集中在 `lib.rs`，且图谱未完整返回前端测试链，已用源码与测试复核。 | `startLocal useLocalRunVerification create_managed_local_run_workspace start_local_preview verify_managed_local_run` |
| Linux 服务器上线 | `DeploymentEditorController.startServer`；`useSourceReadiness`；`server-deployment-setup-service` | `prepare_managed_server_deployment` → `sync_project_to_cnb` → `refresh_deployment` / `start_deployment_path_inner` | `WorkspaceState` 保存线路、任务、尝试、制品和当前指针；`providers/cnb.rs`、`registry.rs`、`ssh.rs`、`caddy.rs` 承担构建、版本仓库、远程执行与路由 | `DeploymentEditorController.test.tsx`；`server-deployment-setup*.test.ts`；`apps/desktop/src-tauri/src/tests.rs` | 本地文件夹的服务器部署技术链已接通；仓库来源仍被上游解析缺口阻断，Tauri 编排仍集中在 `lib.rs`。图谱返回 Provider 和前端设置入口，但未完整串出动态命令注册、仓储与测试，已回退复核。 | `startServer prepare_managed_server_deployment sync_project_to_cnb start_deployment_path_inner WorkspaceState ssh execute` |
| 完整待办 | `useSourceReadiness.evaluateReadiness`；`deploymentReadinessChecklist`；`projectDeploymentEditorAction` | 服务器检查调用 `resolve_managed_server_environment`、`prepare_managed_server_environment`；纯规则位于 `deploy-core::mvp::checklist` / `projection` | 线路与连接由 `WorkspaceState` 提供；服务器、版本仓库写权限等检查通过相应 Provider 执行 | `action-checklist/model.test.ts`；`session.test.ts`；`server-deployment-setup*.test.ts`；`deploy-core::mvp::{checklist,projection}` | revision、`scanning/blocked/ready/check_failed` 与主操作门禁链已有测试入口；当前聚合主要在前端 session 与服务中，尚无统一的持久化 Tauri `evaluateActions` 用例。 | `useSourceReadiness deploymentReadinessChecklist projectDeploymentEditorAction ActionChecklist project_primary_action` |
| 成功证据 | `useLocalRunVerification`；`serverEvidenceView`；`deployment-evidence.projectDeploymentEvidence` | `verify_managed_local_run`、`project_managed_deployment_evidence`、`verify_deployment_path` | 本机检查读取受管运行元数据；服务器运行记录保存制品摘要和逐地址结果，远端/路由检查经 SSH、Caddy 与 `deployment_route_verification.rs` | `deployment-evidence/model.test.ts`；`deploy-core::mvp::evidence`；`server-evidence.test.ts`；`source_snapshots.rs`；`apps/desktop/src-tauri/src/tests.rs` | 证据投影与验证链已接通至本机和服务器入口；仓库来源仍被来源解析缺口阻断，并缺客户端端到端测试。图谱未返回完整的仓储持久化链，已用运行记录源码与测试复核。 | `useLocalRunVerification serverEvidenceView project_evidence project_managed_deployment_evidence verify_deployment_path` |
| 更新部署 | `App.onUpdate` 进入 `DeploymentEditorController` 的 `mode="update"`，随后复用 `startServer` | 复用 `prepare_managed_server_deployment`、`sync_project_to_cnb` 和 `refresh_deployment` | 复用 `WorkspaceState` 的追加任务/制品事实和 `DeploymentPath.current_run_id`；Provider 与服务器上线相同 | `DeploymentEditorController.update.test.tsx`；`deployment-detail/model.test.ts`；`ProjectGallery.test.tsx` | 更新链通过服务器部署链复用接通；新尝试失败不会覆盖当前指针。当前没有独立 Rust `UpdateDeployment` 应用服务，图谱也未返回独立更新仓储链。 | `App onUpdate mode update refreshLocalSourceBeforeRun prepare_managed_server_deployment refresh_deployment` |
| 版本恢复 | `DeploymentDetailController.restoreVersion` → `DeploymentDetailServices.restoreVersion` | `redeployDeploymentPathVersion` → Tauri `redeploy_deployment_path_version` → `deploy_deployment_path_to_server` / `verify_deployment_path` | `WorkspaceState.list_deployment_path_runs` 校验同线路成功记录，创建新 run、绑定线路并只在验证成功后更新当前事实；复用服务器部署 Provider | `deployment-detail/model.test.ts`；`ProjectGallery.test.tsx`；相关 Workspace/Tauri 测试 | 恢复链已接通至前端服务、Tauri 命令、仓储与服务器 Provider；命令拒绝非成功或缺制品/Commit 的记录并创建新任务。缺控制器和 Tauri 命令级恢复测试。 | `restoreVersion redeployDeploymentPathVersion redeploy_deployment_path_version WorkspaceState list_deployment_path_runs` |

## 3. 稳定跨层起点

| 边界 | 稳定符号 | 当前职责 |
| --- | --- | --- |
| 应用装配 | `App` | 在“我的部署”、部署编辑器和详情之间切换，不承载部署规则。 |
| 部署列表 | `useDeploymentDashboard`、`ProjectGallery` | 从持久化任务与当前指针投影首页。 |
| 部署编辑器 | `DeploymentEditorController`、`DeploymentEditorPage` | 编排来源、环境、待办、运行与证据的单页流程。 |
| 部署详情 | `DeploymentDetailController`、`projectDeploymentDetail` | 投影当前在线、失败尝试、更新入口和可恢复版本。 |
| 类型化 Tauri 边界 | `api.ts`、`api/` | 参数、返回值、兼容反序列化和错误归一化；当前生产调用集合由命令面门禁从这两个边界提取。 |
| Tauri 应用入口 | `mvp_environment.rs`、`source_snapshots.rs`、`lib.rs` | 来源快照、环境准备和任务执行；`lib.rs` 的 `tauri::generate_handler!` 是当前 45 个生产 handler 的唯一注册面。 |
| 仓储 | `WorkspaceState`、`workspace/` | SQLite 聚合、任务、线路、当前指针与兼容读取。 |
| Provider | `deploy-core::providers` | CNB、版本仓库、Docker、SSH、Caddy 等具体适配。 |

首页和详情必须读取同一部署聚合。秘密正文只进入系统密钥库；普通 SQLite 记录只保存秘密引用。Provider 和兼容 Manifest 只属于适配层，不进入用户产品模型。

## 4. 桌面生产命令面与保留边界

2026-08-02 的最终自动审计从 `apps/desktop/src-tauri/src/lib.rs` 的 `tauri::generate_handler!`、`apps/desktop/src/api.ts` 与 `apps/desktop/src/api/` 的生产静态调用，以及 Vite 产物中实际保留的调用得到 `registered=45`、`source=45`、`bundled=45`。`dynamicInvocations`、`unsupportedInvocations`、`missingRegistrations`、`registeredOnly`、`bundleOnly` 和 `sourceNotBundled` 均为 0。该结论是静态与构建证据，不是用户验收。

命令提取器由 `scripts/lib/desktop-command-surface.mjs` 与 `scripts/lib/typescript-invoke-bindings.mjs` 共同实现：后者建立 TypeScript Program/TypeChecker 并按编译器符号区分导入绑定、遮蔽值与普通同名属性；前者只接受从 `@tauri-apps/api/core` 具名导入的 `invoke` 运行时绑定（包含具名导入别名）作为非可选直接调用，且命令参数必须是字符串字面量。命名空间导入、core 的值再导出，以及把绑定保存、转发、重赋值、传给回调、放入条件调用或其他非直接值用途都会产生带位置和原因的 `unsupportedInvocations`；type-only 导入/导出与纯类型位置会被忽略，不制造命令或失败。这个保守策略防止门禁把无法静态证明的值流误写成生产消费者。

| 门禁 | 稳定入口 | 保护事实 |
| --- | --- | --- |
| 独立 source 审计 | 根脚本 `pnpm check:desktop-command-surface`；共享实现 `scripts/lib/desktop-command-surface.mjs` + `scripts/lib/typescript-invoke-bindings.mjs` | 通过 TypeScript 编译器符号直接校验生产具名 `invoke` 非可选直接调用、字符串字面量命令、Rust 注册集合，并拒绝所有无法证明的运行时值用法。 |
| 项目治理 | `pnpm check:project` 内的 `auditDesktopCommandSurface({ mode: "source" })` | 复用同一解析器和诊断适配器，与项目文档、前端边界和恢复路径检查在同一 Node 进程内失败收口。 |
| 生产 bundle 审计 | `apps/desktop/package.json` 的 `build` 在 `tsc --noEmit && vite build` 之后运行 `--mode bundle` | 拒绝只存在源码回退分支、但被 tree-shaking 移出实际桌面产物的包装作为生产消费证据。 |

命令数量、逐项去留和实施期回归证据保存在 [桌面命令面证据矩阵](../../openspec/changes/archive/2026-08-02-retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md)；本稳定索引不复制逐命令矩阵。公开 IPC 收缩后仍保留的内部边界为：

- `WorkspaceState::open`、`workspace.rs` 与 `workspace/` 保留 schema 升级、旧记录恢复、任务/尝试/版本追加和 `current_run_id` 指针不变量；部分 Profile、绑定和版本验证方法只作为精确 `#[cfg(test)]` 兼容接缝，不是仍支持的 CRUD 命令。
- `prepare_deployment_path_retry_inner`、`start_deployment_path_inner`、`take_over_deployment_path_routes_inner` 和 `take_over_caddy_routes` 保留当前 pilot 的服务器部署、制品复用和只续路由验证能力；它们不恢复已退役的手工 staging/production 控制面。
- `source_snapshots.rs` 的受管快照/运行工作区与 `start_local_preview` 的进程、端口和连续验证内核保留；已退役的单服务启停和用户项目 `.env` 写入不再是稳定入口。
- `deploy-core::providers::{cnb,registry}` 以及当前授权、同步和部署流程仍负责 CNB 与不可变版本存储；已退役的通用 Provider/secret 管理 endpoint 不得从这些内核存在倒推为可用功能。

## 5. 已知迁移债务与棘轮预算

以下文件仍是显式收缩目标，不接受新的横向职责：

| 文件 | 当前原因 |
| --- | --- |
| `apps/desktop/src/api.ts` | 仍承担较多兼容命令封装，后续按领域迁入 `api/`。 |
| `apps/desktop/src-tauri/src/lib.rs` | 动态命令注册、部署应用服务与部分 Provider 编排仍集中。 |
| `apps/desktop/src-tauri/src/workspace.rs` | 历史聚合仓储仍集中，已开始迁入 `workspace/`。 |
| `crates/deploy-core/src/render.rs` | 多种远端生成物仍集中。 |
| `crates/deploy-core/src/plan.rs` | 兼容部署计划仍集中。 |

生产 TypeScript/TSX、Rust 和 CSS 的超限预算由 `scripts/check-project-quality.mjs` 固定；现有例外只能缩小，不能通过压缩格式或无意义包装绕过。

## 6. 历史资产边界

`docs/product-prototype/index.html` 仍存在，但它是历史讨论资产，仅用于追溯，不代表当前产品、实现或完成状态。旧配置中心、旧工作区、四节点画布、运行配置独立页和旧原型都不得作为当前执行链或验收依据；是否删除历史资产必须由对应 change 明确决定，不能依据文件名或“看起来未引用”推断。

## 7. 体积与维护规则

仓库目录的大部分磁盘占用来自 Rust `target/` 和前端 `node_modules/`；它们是可重建缓存，不是业务代码。源码规模应按受版本控制文件、代码行数和运行可达性衡量。

- 新功能只进入产品合同对应的来源、运行位置、待办、任务或证据边界。
- 修改前先按 [CodeGraph 指南](codegraph.md) 查询定义、调用者和影响范围；动态入口或缺失层再用源码和测试复核。
- 代码入口、调用关系或测试变化时同步本索引与 CodeGraph；状态或真实验收变化时更新 [当前状态](../current-state.md)。
- 大规模删除和移动后重建 CodeGraph；完成定义见 [工程质量规范](../engineering-quality.md)。
