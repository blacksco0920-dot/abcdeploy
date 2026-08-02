## 1. 固化迁移基线与边界

- [ ] 1.1 在旧命令面退役完成后重新测量 `lib.rs`、`api.ts`、`workspace.rs` 及测试文件预算，并记录当前生产命令与用例调用图
- [ ] 1.2 为 Tauri 参数/返回、稳定错误、Workspace 当前指针和重启恢复增加迁移前契约测试
- [ ] 1.3 根据 CodeGraph 调用者和事务边界确定本机、服务器、查询/证据、更新/恢复四个垂直切片的精确模块映射

## 2. 迁移来源与本机运行切片

- [ ] 2.1 建立来源/本机运行的 Rust command 与 application 模块，使 command 只做边界校验和委派
- [ ] 2.2 把前端来源和本机运行调用迁入领域化 `api/` 模块，并删除 `api.ts` 中对应业务实现或再导出
- [ ] 2.3 迁移并运行来源快照、本机启动、取消和连续验证测试，删除原位置重复实现

## 3. 迁移服务器上线切片

- [ ] 3.1 建立服务器环境解析、自动准备和部署启动的 application 服务，复用现有 deployment-path、Provider 与错误契约
- [ ] 3.2 将服务器相关 Tauri command 和前端 API 迁入对应领域模块，保持命令名、参数和返回结构稳定
- [ ] 3.3 验证授权、运行环境准备、构建/版本存储、远程运行和公网证据回归后删除原位置实现

## 4. 迁移查询、证据、更新与恢复切片

- [ ] 4.1 将部署列表、详情、运行查询和证据投影迁入独立 command/application 边界
- [ ] 4.2 将更新部署和版本恢复编排迁入应用服务，保持失败不移动当前指针和成功后原子切换不变量
- [ ] 4.3 将相应前端调用迁入 `api/deployments`、`api/evidence` 或等价领域模块并清理兼容门面

## 5. 收缩 Workspace 聚合实现

- [ ] 5.1 按 deployment paths、runs/evidence、connections/config 和 migrations 将 `workspace.rs` 实现迁入子模块，不修改 schema
- [ ] 5.2 保持跨聚合事务由同一 `WorkspaceState` 与连接管理，并用临时 SQLite 测试验证迁移、并发约束和重启恢复
- [ ] 5.3 删除主文件中的重复 SQL 和实现，确认所有超限文件预算净缩小且新文件满足预算

## 6. 文档、图谱与完整验证

- [ ] 6.1 更新 `docs/internal/implementation-inventory.md` 与架构债务，按用例列出新的跨层稳定入口
- [ ] 6.2 重建并同步 CodeGraph，复核每个用例从 Feature 到 Provider/Workspace 的单向调用关系
- [ ] 6.3 运行 `pnpm check:project`、`pnpm check:secrets`、各切片受影响测试和完整 `pnpm check`，记录文件预算和行为等价证据
