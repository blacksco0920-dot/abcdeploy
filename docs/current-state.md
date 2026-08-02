# ABCDeploy 当前状态

> 更新时间：2026-08-02。证据截止：2026-08-02 的项目文档资产复核、Comet Runtime 状态、CodeGraph 与本地治理门禁；自动验证不构成新增用户验收。

本页是冷启动时判断“已经验收什么、代码做到什么、下一步做什么”的唯一入口，也是当前完成度与验收事实的唯一账本。产品应当做到什么仍以 [产品合同](product-contract.md) 为准；实现边界以 [工程架构](architecture.md) 为准；本页不把目标或测试覆盖写成用户验收，也不把现有实现反写为产品合同。

代码入口、调用链、测试和已确认缺口统一见 [实现证据索引](internal/implementation-inventory.md)，查询当前定义与影响范围见 [CodeGraph 指南](internal/codegraph.md)。active change 的实时身份以 `.comet/current-change.json` 和对应 workflow 的只读状态为准：Native 从 `docs/comet/changes/` 恢复，Classic/OpenSpec 从 `openspec/changes/` 恢复。本页只保存稳定状态、带日期的审计快照和必要链接，不复制代码图谱、任务或设计全文，也不冒充实时 selection。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `VERIFIED` | 用户已经在真实桌面客户端中明确验收，且本页保留验收事实。 |
| `IMPLEMENTED_UNVERIFIED` | 有当前代码和自动测试证据，但尚未取得相应真实用户验收。 |
| `NEXT` | 已确定、应在当前活跃变更中紧接着完成的工作。 |
| `TARGET` | 产品合同或架构要求的目标；当前入口尚未实现或不能据现有证据称为可用。 |
| `OUT_OF_SCOPE` | 当前本地快速迭代明确不做的工作，不应据此触发发布或扩张范围。 |

## 冷启动审计与治理门禁

- 审计日期：2026-08-02。
- 审计输入边界：从 `AGENTS.md`、`docs/README.md`、本页、实现索引、产品合同和架构开始；按文档准确性任务继续复核全部当前维护文档、根入口、项目质量脚本、Comet 配置与 selection。代码事实先用 CodeGraph 查询，图谱没有覆盖嵌套回调或动态入口时才使用 `rg`、源码和测试补充；历史原型只用于核对“文件是否存在和是否有非权威提示”，不参与产品事实裁决。聊天中的旧结论不作为证据。
- 五题结果：唯一 `VERIFIED` 仍是本地文件夹 → Linux 服务器正向 MVP 主线；本机运行、完整待办与门禁、成功证据、更新部署和版本恢复均为 `IMPLEMENTED_UNVERIFIED`；仓库来源仍为 `TARGET`；已确认 change 的下一步从 selection、workflow 状态和 change brief 恢复；未获正式发布授权时的版本、标签、Release、全平台安装包与下载文件发布均为 `OUT_OF_SCOPE`。前端、Tauri/应用、仓储、Provider 与测试从实现证据索引的稳定跨层起点定位，目录边界见 `docs/architecture.md` §6–§7、§12。
- 变更结构：2026-08-02 审计快照中，selection 指向 Native change `audit-project-documentation-assets`；实时状态必须用 `comet native status` 确认。此前的 Classic change `organize-canonical-project-assets` 已归档至 [`2026-07-31-organize-canonical-project-assets`](../openspec/changes/archive/2026-07-31-organize-canonical-project-assets/)，其 6 项需求已同步到 [Classic 项目上下文恢复规格](../openspec/specs/project-context-recovery/spec.md)。
- 项目门禁：`pnpm check:project`、`pnpm check:secrets` 与 `git diff --check` 于 2026-08-02 通过；项目质量检查新增顶层文档可发现性、历史原型事实一致性以及 Native/Classic 恢复路径检查。
- 桌面命令面：2026-08-02 在变更工作树运行 `node scripts/check-desktop-command-surface.mjs --mode all --json` 通过，Rust 注册、生产 TypeScript 源码与 Vite bundle 三个集合均为 45，动态调用与所有差异集均为 0。根 `check:desktop-command-surface` 和 `check:project` 保护 source 面，桌面 `build` 在 Vite 之后保护 bundle 面；精确入口与保留的迁移/恢复内核见 [实现证据索引](internal/implementation-inventory.md#4-桌面生产命令面与保留边界)。
- 净收缩：相对实施计划 base `24e0fc79f9bda0401362b4e93cb570774b4abfa8`，Task 11 最终工作树的跟踪差异为 45 个文件、2,611 行新增、5,602 行删除，净减少 2,991 行；该统计包含 change 证据、门禁与测试资产，不用作功能完成度或用户验收依据。
- CodeGraph：在实际变更工作树运行 `pnpm codegraph:index`、`pnpm codegraph:sync` 与 `pnpm codegraph:status` 于 2026-08-02 通过；索引为最新状态，共 216 个文件、3,006 个节点和 8,936 条边。`.codegraph/` 是忽略的本机索引，没有作为产品或验收资产提交。
- 证据边界：本次只记录静态审计、构建产物审计和自动回归；本任务未执行桌面客户端启动或当前主线的无副作用烟测，因此不新增用户验收。服务器正向主线仍保持原 `VERIFIED`；本机运行、更新部署和版本恢复仍为 `IMPLEMENTED_UNVERIFIED`。

## 关键用户能力

| 能力 | 状态 | 事实与精确证据 |
| --- | --- | --- |
| 本地文件夹 → Linux 服务器的正向 MVP 主线 | `VERIFIED` | 用户已确认该服务器正向 MVP 在真实桌面客户端中验通；代码入口为 `apps/desktop/src/features/deployment-editor/DeploymentEditorController.tsx`，服务器准备与上线接口见 `apps/desktop/src/features/deployment-editor/deployment-editor-services.ts`。 |
| 本地文件夹 → 本机运行 | `IMPLEMENTED_UNVERIFIED` | 受管源码快照与本机运行验证位于 `apps/desktop/src-tauri/src/source_snapshots.rs`；连续验证流程位于 `apps/desktop/src/features/deployment-editor/use-local-run-verification.ts`。尚无用户验收记录。 |
| 代码仓库地址 → 本机运行 | `TARGET` | `apps/desktop/src/features/deployment-editor/deployment-editor-services.ts` 的 `resolveRepository` 当前明确抛出“代码仓库读取能力尚未接入当前客户端”；仅有格式与状态机测试 `apps/desktop/src/features/deployment-editor/session.test.ts`。 |
| 代码仓库地址 → Linux 服务器 | `TARGET` | 同一 `resolveRepository` 未接通，不能从仓库地址进入服务器正向主线；产品目标见 [产品合同 §4.2](product-contract.md#42-代码仓库地址)。 |
| 完整待办、阻塞与主操作门禁 | `IMPLEMENTED_UNVERIFIED` | `apps/desktop/src/features/action-checklist/model.test.ts` 覆盖 revision、检查中、阻塞和开始门禁；服务器待办生成见 `apps/desktop/src/features/deployment-editor/server-deployment-setup.test.ts`。 |
| 成功证据与连续验证 | `IMPLEMENTED_UNVERIFIED` | `crates/deploy-core/src/mvp/evidence.rs` 与 `apps/desktop/src/features/deployment-evidence/model.test.ts` 覆盖三次、五秒间隔、十秒窗口；尚无本机或仓库来源的真实验收。 |
| 更新部署 | `IMPLEMENTED_UNVERIFIED` | 更新后的编辑器行为由 `apps/desktop/src/features/deployment-editor/DeploymentEditorController.update.test.tsx` 覆盖；尚无独立用户验收事实。 |
| 版本恢复 | `IMPLEMENTED_UNVERIFIED` | 恢复服务入口在 `apps/desktop/src/features/deployment-detail/deployment-detail-services.ts`，展示恢复版本的回归证据在 `apps/desktop/src/components/ProjectGallery.test.tsx`；尚无用户验收事实。 |

## 当前进行中的变更

- 实时入口：读取 `.comet/current-change.json`，再运行对应 workflow 的只读 `status`；selection 缺失、失效或存在多个候选时不得根据聊天摘要猜测。
- `NEXT`：2026-08-02 审计快照中的已确认工作是完成 `audit-project-documentation-assets` 的 Build、Verify 与 Archive；该快照归档后不继续充当 active 注册表。
- `TARGET`：四种来源/运行位置组合仍是稳定产品目标；不得因为目前只验收服务器正向主线而缩小产品合同。

## 最近下一步

1. `NEXT`：优先完成 selection 指向且已确认的 change；没有 active change 时，必须先为新的已承诺工作创建或恢复对应 Native 或 Classic change。
2. `TARGET`：在任何声称仓库来源已可用之前，接通 `resolveRepository` 的真实解析、身份锁定和受管目录流程，并取得自动测试与用户验收。
3. `TARGET`：为本机运行、更新部署和版本恢复补充真实客户端验收记录；验收前保持 `IMPLEMENTED_UNVERIFIED`。

## 明确禁区与非目标

- `OUT_OF_SCOPE`：未获“正式发布”明确授权时，不修改版本号、不创建或推送 Git 标签、不触发 GitHub Release、不生成全平台安装包、不发布下载文件或 `latest.json`。
- `OUT_OF_SCOPE`：本轮不把历史页面、原型或测试覆盖当作当前产品事实；需要历史结论时查 Git。
- `OUT_OF_SCOPE`：不因治理文档工作改动业务代码、Provider 行为或服务器资源。

## 已知冲突与待确认事项

- `TARGET`：产品合同要求支持代码仓库地址，但当前 `resolveRepository` 明确未接入；后续文档必须同时保留产品目标与当前状态，不能写成“已支持”。
- `IMPLEMENTED_UNVERIFIED`：自动测试证明的是代码行为，不是用户在真实客户端完成验收；除服务器正向 MVP 外，不能升级为 `VERIFIED`。
- `IMPLEMENTED_UNVERIFIED`：当前部署详情与恢复相关代码存在，但其端到端真实验收证据尚未汇总到本页。

## 本页维护触发器

- 用户完成或撤回真实客户端验收时，更新相应能力状态、日期和验收事实。
- 改动项目来源、运行位置、待办、部署、证据、更新或恢复的代码入口、测试或可用性时，复核本页的精确证据。
- 创建、完成、归档或替换影响稳定状态判断的 Native 或 Classic/OpenSpec change 时，更新带日期快照和验证证据；实时 active 身份只由 selection 与 workflow 状态决定。
- 每次更新后运行 `pnpm check:project`；状态枚举缺失会被项目门禁拒绝。
