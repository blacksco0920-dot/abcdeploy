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
