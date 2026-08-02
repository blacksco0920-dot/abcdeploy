# `retire-legacy-desktop-command-surface` 验证报告

> 验证日期：2026-08-02
> 验证模式：Comet full verify
> 实施基线：`24e0fc79f9bda0401362b4e93cb570774b4abfa8`
> 验证 HEAD：`017edc06e382d44cbe0bfb7566fff0335534e9fa`

## 结论

本 change 的实现、测试、证据矩阵和稳定项目资产与 OpenSpec proposal、design、delta spec 及 Superpowers Design Doc 一致。未发现 CRITICAL、WARNING 或 SUGGESTION；可以进入归档阶段。

| 维度 | 结果 | 结论 |
| --- | --- | --- |
| Completeness | PASS | OpenSpec 16/16 tasks、4/4 requirements、8/8 scenarios 均有实现与验证证据。 |
| Correctness | PASS | 当前命令面为 `registered/source/bundled=45/45/45`，动态调用、无法静态证明的调用与四类差异均为 0。 |
| Coherence | PASS | OpenSpec 高层设计、深度 Design Doc、证据矩阵、实现索引和代码边界一致，无 spec/design 漂移。 |
| Safety | PASS | 密钥检查通过；未改变 Provider、迁移、部署状态机或用户验收状态，未触发正式发布。 |

## Requirement 与 Scenario 映射

### 1. 注册命令必须具有可验证的运行时消费者

- `scripts/lib/desktop-command-surface.mjs` 与 `scripts/lib/typescript-invoke-bindings.mjs` 使用 TypeScript 编译器符号绑定，只接受 core 具名运行时 `invoke` 的非可选直接字符串字面量调用；动态或无法证明的用法给出原因、文件和行号。
- `scripts/check-project-quality.mjs` 在 `pnpm check:project` 中执行 source 审计；`apps/desktop/package.json` 在 Vite 后执行 bundle 审计。
- `apps/desktop/src-tauri/src/lib.rs` 最终只注册 45 个当前生产命令；fresh source/all 审计为 `45/45/45`，所有差异集合为空。
- `scripts/desktop-command-surface.test.mjs` 与 `scripts/desktop-command-surface-instantiation.test.mjs` 覆盖未注册、无消费者、tree-shaking、动态/unsupported、符号遮蔽和 TypeScript 类型/运行时语义边界。

对应三个 Scenario 均为 PASS：生产调用必须已注册；无消费者注册入口已删除或内部化；未进入 production bundle 的包装不能作为消费者证据。

### 2. 退役判断必须保护数据兼容职责

- `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md` 对 111 个初始命令逐项记录生产 caller、内部职责、迁移/恢复依据、测试和最终处置。
- 66 个公开注册 endpoint 已删除；只有仍承担迁移、旧记录恢复、current pointer、部署重试或 Provider 共享职责的内部内核保留。
- Workspace 迁移、旧 Profile/绑定、服务器身份升级、版本/验证投影、失败不替换在线版本和重启恢复测试均在 fresh Rust workspace 245 项中通过。

对应两个 Scenario 均为 PASS：旧记录兼容能力及其测试保留；只服务退役入口的命令、类型、helper、测试和 4 个 runtime dependencies 已删除。

### 3. 清理不得改变当前部署行为

- Fresh `pnpm check` 通过：Rust 245 项、Vitest 36 files / 195 tests、release-manifest 2 项，以及 TypeScript、format、Clippy、desktop/site build。
- 当前本机、服务器、更新、恢复、失败保留在线版本和重启恢复的回归测试继续通过。
- 签名测试包位于 `target/release/bundle/macos/ABCDeploy.app`，为 thin arm64；`codesign --verify --deep --strict` 通过，Identifier 为 `cloud.finagent.abcdeploy`，使用稳定 Apple Development 身份。
- 无副作用 smoke 已验证启动、列表/详情、文件夹选择器取消和本机/服务器 ready-state 入口；最终运行、上线、更新均未点击。外链目标窗口和 Provider 授权内复制仍明确为 `NOT_TESTED`，不冒充 PASS。

对应两个 Scenario 均为 PASS：类型化 API 与 45 个 handler 保持当前主线；完整工程、安全和构建门禁通过。

### 4. 实现资产必须反映实际命令主线

- `docs/internal/implementation-inventory.md` 已同步编译器符号审计入口、45 命令面和保留的 Workspace/Provider/恢复边界。
- `docs/current-state.md` 仅记录自动验证和有限 smoke，不新增用户验收；服务器正向主线保留既有 `VERIFIED`，本机运行、更新和恢复仍为 `IMPLEMENTED_UNVERIFIED`。
- CodeGraph 在实际 worktree 为 218 files / 3,017 nodes / 8,931 edges，状态 up to date；忽略的 `.codegraph/` 未进入提交。
- 相对 plan base 的最终跟踪差异为 47 files、+3,304/-5,606，净减少 2,302 行。

对应“命令或入口被删除”Scenario 为 PASS：实现索引、当前状态、证据矩阵与 CodeGraph 同步完成并通过项目质量检查。

## 设计一致性

- 逐项证据矩阵决定 `keep-ipc`、`internalize` 或 `delete`，没有按 `legacy` 名称或文件体积删除。
- 清理从前端/API/Tauri 边界向内推进，共享 Workspace、Provider、迁移与恢复内核按 caller 和行为测试保留。
- source、project 和 post-Vite bundle 门禁共用同一 parser/diagnostic 实现，没有平行命令名单或批量 allowlist。
- 数据兼容以迁移、重启和 current pointer 场景证明；没有通过删除有效断言换取门禁通过。
- 最终 whole-branch review 接受两个非阻断 Minor：`localeCompare` 只影响全小写 ASCII 命令诊断排序；`open_project_preview` 本分支未修改且只读用户项目源码，既有 adoption/snapshot 测试足以覆盖本 change。

## Fresh 验证命令

以下命令在当前 worktree 重新执行并通过：

- `pnpm check:project`：356 files / 17 required docs。
- `pnpm check:secrets`：354 tracked files，无高置信度凭据。
- `openspec validate retire-legacy-desktop-command-surface --strict`：valid。
- `node --test scripts/*.test.mjs`：53/53。
- `node scripts/check-desktop-command-surface.mjs --mode all --json`：`45/45/45`，问题集合全空。
- `pnpm check`：完整工程门禁 exit 0。
- `pnpm codegraph:status`：218/3,017/8,931，up to date。
- `git diff --check`、`git status --short`：无实现脏改；Verify 阶段仅有 Comet 状态和本报告资产。
- `codesign --verify --deep --strict --verbose=2 target/release/bundle/macos/ABCDeploy.app`：通过。

## 非阻断验证观察

Spec reviewer 的首轮 `pnpm check` 曾在未被本 change 修改的 `DeploymentEditorController.update.test.tsx` 出现一次异步时序失败：测试先等待首屏已存在的“本次更新”标题，随后同步读取由异步恢复提交的服务器名。随后前端全套 195/195、第二次完整 `pnpm check` 以及该单测连续 20 次均通过，无法复现为本次回归，因此不列为 finding。若后续单独治理测试稳定性，可将服务器名断言改为异步等待。

## 最终评估

Completeness、Correctness、Coherence 与 Safety 全部通过；0 CRITICAL、0 WARNING、0 SUGGESTION。本 change 已具备进入 archive 的验证条件。
