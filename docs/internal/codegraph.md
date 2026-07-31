# CodeGraph 使用指南

## 目的

CodeGraph 为代码建立符号、引用、调用和文件依赖索引，帮助后续 AI 在修改前定位入口、评估影响范围并选择回归测试。它是导航证据，不是产品需求来源；产品冲突仍以 [产品合同](../product-contract.md) 为准。

`.codegraph/` 是本机可重建索引，不提交 Git。

## 初始化与更新

```bash
pnpm codegraph:index   # 大规模删除、移动或首次使用；按当前工作树建立临时 Git 索引
pnpm codegraph:sync    # 日常增量更新
pnpm codegraph:status  # 检查索引状态
```

若本机尚未初始化，可直接运行 `codegraph init .`。`pnpm codegraph:index` 不会改动真实暂存区，并会把任何解析错误作为失败返回。索引异常或与代码明显不符时执行该命令，不要根据旧查询结果修改代码。

## AI 修改流程

1. 阅读 `docs/README.md` 和相关权威文档。
2. 运行 `pnpm codegraph:sync`。
3. 用 `query` 定位符号和定义，不靠文件名猜测。
4. 用 `callers` / `callees` 理解调用边界。
5. 用 `impact` 评估修改符号的下游影响。
6. 修改后用 `affected` 检查变更涉及的符号与测试。
7. 运行针对性测试和文档门禁，再次同步索引。

## 常用查询

```bash
codegraph query DeploymentEditorController --path .
codegraph callers refreshDeployment --path .
codegraph callees resolveServerReadiness --path .
codegraph impact serverDeploymentRunView --path .
git diff --name-only | codegraph affected --stdin --path .
```

具体选项以 `codegraph <command> --help` 为准。符号重名时先使用 `query` 返回的精确标识，不要选择第一个相似结果。

## 当前实现入口（仅用于定位与迁移）

| 任务 | 推荐起点 |
| --- | --- |
| 应用启动与页面装配 | `App` |
| 首页部署聚合与刷新 | `useDeploymentDashboard`、`ProjectGallery` |
| 部署编辑器用例编排 | `DeploymentEditorController` |
| 部署编辑器页面 | `DeploymentEditorPage` |
| 页面唯一主操作 | `projectDeploymentEditorAction` |
| 运行记录刷新 | `refreshDeployment` |
| 服务器任务状态投影 | `serverDeploymentRunView` |
| 已保存服务器复核 | `verifySavedServer`、`resolveServerReadiness` |
| 项目扫描 | `inspect_project` |
| 受管运行文件生成 | `render_project_files`、`render_deployment_path_bundle` |
| 本机持久化 | `WorkspaceStore` |

## 查询判断原则

- 没有调用者不等于可以删除：Tauri 命令、React 懒加载和序列化边界可能是动态入口。
- 对 `api.ts` 或 Tauri 命令的修改必须同时检查 TypeScript 调用方和 Rust 注册处。
- 对数据库结构的修改必须检查迁移、兼容回填、读取模型和测试。
- 对 `render.rs` 的修改必须检查生成脚本测试、安全回滚和真实 shell 行为。
- 文档、HTML 原型和配置文件不一定形成符号边，仍需使用文本搜索与链接检查补充。

## Codex 集成

CodeGraph CLI 可以安装本地 Codex 集成，使后续会话直接使用图谱查询。集成只是工具入口，索引仍需在仓库内初始化并保持同步。
