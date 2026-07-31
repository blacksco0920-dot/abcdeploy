# ABCDeploy 小白部署

ABCDeploy 是面向 vibe coding 用户的桌面部署工具。它只要求用户做两次选择：

```text
选择项目  →  选择运行位置  →  处理系统列出的待办  →  运行/上线  →  查看成功依据
```

项目可以来自电脑里的文件夹，也可以来自代码仓库地址；运行位置可以是这台电脑，也可以是某台 Linux 服务器。因此 MVP 覆盖四种组合：

- 本地文件夹 → 这台电脑；
- 代码仓库 → 这台电脑；
- 本地文件夹 → Linux 服务器；
- 代码仓库 → Linux 服务器。

用户不需要先理解构建、制品存储、远程连接、运行环境或路由。系统能够安全完成的工作自动完成；必须由用户授权、输入或在外部平台处理的事项，统一列成一张完整待办列表。

## 产品承诺

ABCDeploy 不用“命令执行完成”或“内部阶段变绿”冒充成功。

一次可信结果至少回答：

- 部署的是哪份代码；
- 运行位置实际运行的是哪个版本或源码快照；
- 必要服务和依赖是否仍然健康；
- 用户视角的访问地址是否连续检查通过；
- 证据来自哪里、何时检查、连续通过了几次。

服务已经运行但公网地址尚未可用时，产品必须明确显示“服务已运行，访问地址仍需处理”，并把剩余问题放回待办，而不是显示上线成功。

## MVP 页面

首页只展示已保存的部署和“新建部署”。新建部署是一个自然纵向页面：

1. 选择项目；
2. 选择运行位置；
3. 查看自动检查和完整待办；
4. 执行当前唯一主操作；
5. 查看运行结果和成功依据。

项目选择、运行位置、待办、主操作和结果始终在同一个自然纵向页面完成。后台实现可以替换，不决定用户看到的页面结构。

历史实现与具体 Provider 已隔离在 [内部实施资料](docs/internal/README.md)，只能用于迁移代码，不能用于补充产品需求。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `apps/desktop` | React + Tauri 桌面客户端 |
| `crates/deploy-core` | 项目识别、计划生成、Provider、安全和部署领域能力 |
| `crates/deployctl` | 命令行入口与诊断工具 |
| `apps/site` | 官网与下载页 |
| `schemas` | `deploy.yaml` Schema |
| `examples` / `fixtures` | 可运行示例和匿名化回归夹具 |
| `docs` | 当前有效的产品、技术、前端和验收文档 |
| `.codegraph` | 本机生成的 CodeGraph 索引，不提交仓库 |

## 本地开发

需要 Node.js 22、pnpm 11、Rust 1.97 和 Tauri 2 对应平台依赖。

```bash
pnpm install
pnpm dev
```

常用验证：

```bash
pnpm check
```

也可以按层运行：

```bash
pnpm --filter @abcdeploy/desktop test
pnpm --filter @abcdeploy/desktop build
pnpm check:project
pnpm check:secrets
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

日常 macOS Apple Silicon 验收包：

```bash
pnpm tauri:build:app
```

该命令只生成签名 `.app`，不升级版本、不生成 DMG、不触发远端发布。

## CodeGraph

本项目使用 CodeGraph 为 AI 提供符号、调用关系和影响范围索引：

```bash
pnpm codegraph:index
pnpm codegraph:status
```

使用方式和推荐查询见 [CodeGraph 指南](docs/internal/codegraph.md)。

## 当前技术边界

- 首版后台只接入一组受支持的代码构建、不可变版本存储、Linux 服务器和受管路由适配器；具体 Provider 不进入用户信息架构。
- 首版项目必须至少包含一个 HTTP 可访问服务；纯 CLI、Worker 和定时任务暂不进入成功门禁。
- 服务器适配器在任何写入前验证系统、架构、权限和网络是否受支持；具体支持范围由适配器能力声明和自动检查结果决定。
- 产品默认不接 AI 服务，不能依赖 AI 才能完成检查或证明成功。
- 数据库备份和迁移不属于通用自动承诺；只有项目明确声明持久数据风险时才生成对应待办。

## 文档入口

AI 和开发者从 [docs/README.md](docs/README.md) 开始；新会话默认阅读 [当前状态](docs/current-state.md)。产品冲突只以 [产品合同](docs/product-contract.md) 为准，工程承载方式以 [工程架构](docs/architecture.md) 为准，长期维护要求以 [工程质量规范](docs/engineering-quality.md) 为准，实施完成以 [验收标准](docs/implementation-acceptance.md) 为准。

## 许可证

[Apache License 2.0](LICENSE)
