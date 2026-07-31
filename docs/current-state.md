# ABCDeploy 当前状态

> 更新时间：2026-07-31。证据截止：本次 change 验证完成时。

本页是冷启动时判断“已经验收什么、代码做到什么、下一步做什么”的唯一入口，也是当前完成度与验收事实的唯一账本。产品应当做到什么仍以 [产品合同](product-contract.md) 为准；实现边界以 [工程架构](architecture.md) 为准；本页不把目标或测试覆盖写成用户验收，也不把现有实现反写为产品合同。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `VERIFIED` | 用户已经在真实桌面客户端中明确验收，且本页保留验收事实。 |
| `IMPLEMENTED_UNVERIFIED` | 有当前代码和自动测试证据，但尚未取得相应真实用户验收。 |
| `NEXT` | 已确定、应在当前活跃变更中紧接着完成的工作。 |
| `TARGET` | 产品合同或架构要求的目标；当前入口尚未实现或不能据现有证据称为可用。 |
| `OUT_OF_SCOPE` | 当前本地快速迭代明确不做的工作，不应据此触发发布或扩张范围。 |

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
| 当前治理 change | `NEXT` | 活跃变更为 `openspec/changes/organize-canonical-project-assets/`；任务清单为 `openspec/changes/organize-canonical-project-assets/tasks.md`。本页与项目门禁是其 1.1 的实现产物。 |

## 当前进行中的变更

- `NEXT`：`organize-canonical-project-assets` 正在把当前事实入口、文档权威层级和代码导航收束为可复核资产。进度以 `openspec/changes/organize-canonical-project-assets/tasks.md` 为准。
- `TARGET`：四种来源/运行位置组合仍是稳定产品目标；不得因为目前只验收服务器正向主线而缩小产品合同。

## 最近下一步

1. `NEXT`：完成该治理 change 后续任务：冷启动协议、文档权威层级、冲突清理、代码导航和最终验证。
2. `NEXT`：在任何声称仓库来源已可用之前，先接通 `resolveRepository` 的真实解析、身份锁定和受管目录流程，并取得自动测试与用户验收。
3. `NEXT`：为本机运行、更新部署和版本恢复补充真实客户端验收记录；验收前保持 `IMPLEMENTED_UNVERIFIED`。

## 明确禁区与非目标

- `OUT_OF_SCOPE`：未获“正式发布”明确授权时，不修改版本号、不创建或推送 Git 标签、不触发 GitHub Release、不生成全平台安装包、不发布下载文件或 `latest.json`。
- `OUT_OF_SCOPE`：本轮不把历史页面、原型或测试覆盖当作当前产品事实；需要历史结论时查 Git。
- `OUT_OF_SCOPE`：不因治理文档工作改动业务代码、Provider 行为或服务器资源。

## 已知冲突与待确认事项

- `TARGET`：产品合同要求支持代码仓库地址，但当前 `resolveRepository` 明确未接入；后续文档必须同时保留产品目标与当前状态，不能写成“已支持”。
- `IMPLEMENTED_UNVERIFIED`：自动测试证明的是代码行为，不是用户在真实客户端完成验收；除服务器正向 MVP 外，不能升级为 `VERIFIED`。
- `NEXT`：当前部署详情与恢复相关代码存在，但其端到端真实验收证据尚未汇总到本页。

## 本页维护触发器

- 用户完成或撤回真实客户端验收时，更新相应能力状态、日期和验收事实。
- 改动项目来源、运行位置、待办、部署、证据、更新或恢复的代码入口、测试或可用性时，复核本页的精确证据。
- 创建、完成、归档或替换影响当前判断的 OpenSpec change 时，更新“当前进行中的变更”和“最近下一步”。
- 每次更新后运行 `pnpm check:project`；状态枚举缺失会被项目门禁拒绝。
