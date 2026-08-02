---
status: approved
approved_at: 2026-08-02
owner: chanjack
---

# ABCDeploy 默认使用 Comet Native 的协作设计

## 目标

让单人开发中的日常改动默认由 Comet Native 管理，同时保留 Comet Classic 作为显式选择。新会话必须能仅凭项目配置和 `AGENTS.md` 判断是否进入 Comet、恢复哪个 change，以及何时不应创建 change。

## 已确认选择

采用“Native 默认、Classic 保留”的方案：

- 项目默认入口固定为 `native`，不再依赖缺少项目配置时的 `legacy-fallback`。
- 项目同时允许 `native` 和 `classic`；`/comet-classic` 继续作为显式入口。
- Native 产物使用中文，保存到 `docs/comet/`，需求澄清使用 `batch` 模式。
- 自动恢复保持开启；相关后续任务恢复已有 active change，不从聊天上下文重建需求。
- 已归档的 Classic change 保持原样，不迁移为 Native change。

## 备选方案与取舍

1. **Native 默认并保留 Classic（采用）**：日常协作停点更少，仍能在明确需要时使用 Classic 的 OpenSpec + Superpowers 流程。
2. **只允许 Native**：配置最简单，但会不必要地删除大型重构或正式流程审查时的显式 Classic 入口。
3. **继续使用 Classic fallback**：无需修改仓库，但直接需求不会获得项目级稳定路由，且日常单人开发需要更多流程选择。

## 路由规则

`AGENTS.md` 增加仓库级协作规则：

- 会改变产品行为、代码、配置、测试或权威文档的直接需求，默认调用 `/comet`，由项目配置进入 Native。
- 问答、解释、只读检查、状态汇报、代码审查和不包含项目修改的 Git 操作不创建 Comet change。
- 与唯一 active change 目标一致的后续输入自动恢复该 change；无关任务不得附加到现有 change。
- 用户显式指定 `/comet-native` 或 `/comet-classic` 时服从显式入口。
- Native 与 Classic 的 change、状态和产物保持独立，不在两种工作流之间隐式迁移或按任务大小自动切换。

## 项目配置

新增 `.comet/config.yaml`，使用 `comet.project.v1`：

- `default_workflow: native`
- `workflows: [native, classic]`
- `ambient_resume: true`
- `native.artifact_root: docs`
- `native.language: zh-CN`
- `native.clarification_mode: batch`
- 快照覆盖项目内全部 Git 可见文件，并使用 Runtime 文档中的默认资源预算。

全局 `~/.comet/config.yaml` 不修改；项目配置是本仓库的可移植事实源。

## 安全边界

- 切换默认入口不修改产品代码、应用版本、发布资产或已归档 change。
- Native 仍必须经过 Shape、Build、Verify、Archive，不以“模型更聪明”为由跳过需求确认或证据验证。
- 正式发布门禁和本机 `.app` 验收要求继续由 `AGENTS.md` 管理，不由 Comet 配置覆盖。

## 验收

实施完成后必须满足：

1. `comet workflow resolve . --json` 返回 `workflow: native`、`skill: comet-native`、`source: project-config`。
2. `comet native status` 能读取项目配置且不产生配置错误。
3. `AGENTS.md` 能独立回答直接需求是否进入 Comet，以及如何显式选择 Classic。
4. `pnpm check:project` 和 `pnpm check:secrets` 通过。
5. 工作区不存在因配置切换而生成的伪 active change；既有 Classic 归档保持不变。

## 非目标

- 不为本次配置切换创建业务功能 change。
- 不迁移或重写既有 OpenSpec/Classic 归档。
- 不修改 Comet 的全局安装、Skill 或 Runtime。
- 不改变 ABCDeploy 的产品合同、应用行为或发布状态。
