# Architecture

ABCDeploy 的工程架构、依赖方向、模块边界、尺寸预算和测试策略统一维护在 [docs/architecture.md](docs/architecture.md)。

核心原则：

- 产品概念与 Provider 解耦。
- React 视图只依赖类型化 API。
- Tauri 命令只做边界适配和用例编排。
- SQLite、密钥库和外部 Provider 位于基础设施边界。
- 状态可恢复、部署可追溯、副作用可验证。
- 超限文件只能缩小，不能继续增长。

提交前运行：

```bash
pnpm check:project
```

架构改动必须同步更新文档、测试和 CodeGraph。
