# CodeGraph 使用指南

## 目的与职责

CodeGraph 为当前工作树建立符号、引用、调用和文件依赖索引，帮助后续 AI 在修改前定位定义、调用者、被调用者、影响范围与可能的测试入口。它是代码导航证据，不是产品需求、实现状态或用户验收来源。

- 产品规则冲突以 [产品合同](../product-contract.md) 为准。
- 当前完成度与验收事实以 [当前状态](../current-state.md) 为准。
- OpenSpec/Comet 保存变更的 why、what、任务、验证证据和恢复状态；`.comet/current-change.json` 选择当前 workflow，Native 资产位于 `docs/comet/changes/`，Classic/OpenSpec 资产位于 `openspec/changes/`。
- CodeGraph 只回答“当前代码在哪里、怎样相连、改动可能影响什么”。
- [实现证据索引](implementation-inventory.md) 保存用户能力到各层稳定入口的人工复核结果；[当前状态](../current-state.md) 只链接这些资产，不复制 change 或调用图全文。

`.codegraph/` 是本机可重建索引，不提交 Git。

## 初始化与更新

```bash
pnpm codegraph:index   # 大规模删除、移动或首次使用；按当前工作树建立临时 Git 索引
pnpm codegraph:sync    # 日常增量更新
pnpm codegraph:status  # 检查索引状态
```

若本机尚未初始化，可运行 `codegraph init .`。`pnpm codegraph:index` 不会改动真实暂存区，并会把解析错误作为失败返回。查询提示过期、列出 pending files 或结果与当前代码明显不符时，先同步或重建；不得根据旧结果修改代码。

## AI 修改流程

1. 阅读 `docs/README.md`、`docs/current-state.md` 和任务对应的权威文档。
2. 读取 `.comet/current-change.json` 并用对应 workflow 的只读状态确认 active change，再从 `docs/comet/changes/` 或 `openspec/changes/` 恢复当前 why、what 和任务。
3. 运行 `codegraph_status`；索引健康后，用一次 `codegraph_explore` 同时询问相关符号、调用链和测试入口。
4. 只在需要精确影响范围时补充 `codegraph_callers`、`codegraph_callees` 或 `codegraph_impact`。
5. 若单项没有返回、动态 Tauri/React/序列化入口无法形成静态边，或该文件被标为过期，记录缺口，再用 `rg` 和对应源码/测试复核；禁止凭文件名补全。
6. 修改后运行受影响测试和项目门禁；新增或移动核心符号后执行 `pnpm codegraph:sync`，大规模结构变化执行 `pnpm codegraph:index`。
7. 代码入口变化时同步 [实现证据索引](implementation-inventory.md)；用户验收或完成度变化时同步 [当前状态](../current-state.md)。

## 八类能力查询起点

下面的词组用于 `codegraph_explore`，不是对接通状态的承诺。查询时应在同一句中要求返回前端、Tauri/应用、仓储/Provider 和测试；结论以 [实现证据索引](implementation-inventory.md) 的缺口栏为准。

| 用户能力 | 推荐查询词 | 预期稳定起点 |
| --- | --- | --- |
| 本地文件夹 | `DeploymentEditorController resolveLocalPath resolve_local_folder_source snapshot_local_source inspect_project` | `resolveLocalPath`、`resolve_local_folder_source`、`snapshot_local_source` |
| 代码仓库地址 | `chooseRepository changeRepositoryUrl resolveRepository DeploymentEditorSession repository source` | `changeRepositoryUrl`、`resolveRepository`；当前查询应显示未接通异常 |
| 本机运行 | `startLocal useLocalRunVerification create_managed_local_run_workspace start_local_preview verify_managed_local_run` | `startLocal`、`create_managed_local_run_workspace`、`verify_managed_local_run` |
| Linux 服务器上线 | `startServer prepare_managed_server_deployment sync_project_to_cnb start_deployment_path_inner WorkspaceState ssh execute` | `startServer`、`prepare_managed_server_deployment`、`start_deployment_path_inner` |
| 完整待办 | `useSourceReadiness deploymentReadinessChecklist projectDeploymentEditorAction ActionChecklist project_primary_action` | `evaluateReadiness`、`deploymentReadinessChecklist`、`project_primary_action` |
| 成功证据 | `useLocalRunVerification serverEvidenceView project_evidence project_managed_deployment_evidence verify_deployment_path` | `project_evidence`、`verify_managed_local_run`、`verify_deployment_path` |
| 更新部署 | `App onUpdate mode update refreshLocalSourceBeforeRun prepare_managed_server_deployment refresh_deployment` | `App` 的 `onUpdate`、更新模式 `DeploymentEditorController`、复用的服务器链 |
| 版本恢复 | `restoreVersion redeployDeploymentPathVersion redeploy_deployment_path_version WorkspaceState list_deployment_path_runs` | `restoreVersion`、`redeploy_deployment_path_version` |

## 常用精确查询

MCP 工具优先：

```text
codegraph_explore   # 先看一个能力的定义、相关调用和测试
codegraph_callers   # 谁调用这个精确符号
codegraph_callees   # 这个精确符号调用谁
codegraph_impact    # 修改这个符号的下游影响
codegraph_node      # 重名或被截断时读取一个精确符号
```

CLI 等价入口适合本地复核：

```bash
codegraph query DeploymentEditorController --path .
codegraph callers refreshDeployment --path .
codegraph callees resolveServerReadiness --path .
codegraph impact serverDeploymentRunView --path .
git diff --name-only | codegraph affected --stdin --path .
```

具体选项以 `codegraph <command> --help` 为准。符号重名时使用查询返回的文件和行号消歧，不选择第一个相似结果。

## 查询判断原则

- 没有调用者不等于可以删除：Tauri `generate_handler!`、React 回调、序列化、测试夹具和脚本可能是动态入口。
- 对 `api.ts` 或 Tauri 命令的修改必须同时检查 TypeScript 调用方、Rust 实现和 `generate_handler!` 注册。
- 对数据库结构的修改必须检查迁移、兼容回填、读取模型、当前指针和 Workspace 测试。
- 对 Provider 或 `render.rs` 的修改必须检查生成脚本、安全回滚、脱敏和真实远程行为。
- 图谱标注“no covering tests found”只表示没有形成可识别的覆盖边；必须复核同文件 `#[cfg(test)]`、相邻集成测试和前端行为测试，不能把“有测试文件”反推成完整覆盖。
- 文档、HTML 原型和配置文件通常没有符号边，必须使用文本搜索和链接检查补充。
- CodeGraph 没有实时正确性验证能力；编译器、测试和项目门禁仍是完成证据。

## Codex 集成

CodeGraph CLI 可以安装本地 Codex 集成，使后续会话直接使用图谱查询。集成只是工具入口，索引仍需在仓库内初始化并保持同步。
