## Why

完成旧命令面退役后，保留下来的生产部署主线仍集中在超大 `lib.rs`、`api.ts` 和 `workspace.rs` 中，命令校验、应用编排、Provider 调用和持久化职责交错。若直接在这些入口继续增加仓库来源等下一轮能力，会扩大已经超出默认预算的迁移债务，并让跨会话定位和变更影响分析继续依赖人工追踪。

## What Changes

- 按当前产品用例建立明确的 Rust `commands`、`application`、`workspace` 与基础设施依赖方向。
- 将本机运行、服务器上线、更新和恢复的 Tauri 边界校验与应用编排从 `lib.rs` 迁出，入口仅保留装配和命令注册。
- 将生产前端 API 按来源、环境、部署、证据和恢复职责迁入 `api/`，持续缩小兼容门面 `api.ts`。
- 按聚合和查询职责继续拆分 `workspace.rs`，保留数据库 schema、事务和兼容迁移行为。
- 为跨层用例增加契约和回归测试，保证迁移前后的用户行为、错误语义和持久化事实一致。
- 更新实现证据索引、文件预算和 CodeGraph，使新会话可从领域用例直接定位主线。

## Capabilities

### New Capabilities

- `deployment-application-boundaries`: 定义当前部署主线的分层入口、依赖方向、行为保持和可恢复定位要求。

### Modified Capabilities

无。

## Impact

- 主要影响 `apps/desktop/src-tauri/src/lib.rs`、`workspace.rs`、`workspace/`、`mvp_environment.rs`、`apps/desktop/src/api.ts`、`api/` 和相邻测试。
- 不更改 SQLite schema、Provider 类型、用户页面或产品合同；模块移动必须保持序列化参数、错误代码与重启恢复兼容。
- 文件和符号入口变化会同步 `docs/internal/implementation-inventory.md`、质量预算与 CodeGraph。
- 本 change 依赖 `retire-legacy-desktop-command-surface`，避免先为即将删除的旧命令设计新边界。
