# `organize-canonical-project-assets` 完整验证报告

> 验证日期：2026-08-01（Asia/Shanghai）  
> 验证模式：`full`  
> 变更范围：`0a22f58e603f6bfb470ddfe390ceee928c982cfd...HEAD`

## 结论

本 change 的任务完成度、需求与场景覆盖、设计一致性、工程门禁、安全检查、CodeGraph 同步和无历史上下文冷启动审计均通过。未发现 CRITICAL、WARNING 或 SUGGESTION 级未解决项，可进入 archive 前确认。

第一次 verify 因计划 `base-ref` 仍指向整理前提交 `fd5bacf` 而失败；该值会把用户已明确单独固化的全量工作区基线误算成本 change。流程自动返回 build，并在提交 `f8bebff` 中把实施起点修正为 `0a22f58`。修正后提交区间只覆盖 17 个治理、计划和 Comet 状态文件。

## Summary Scorecard

| 维度 | 状态 | 证据摘要 |
| --- | --- | --- |
| Completeness | PASS | OpenSpec tasks `15/15`；6 个 requirements 均有实现证据；关联 Design Doc 可定位。 |
| Correctness | PASS | 8 个 scenarios 全部由入口、状态账本、实现索引、历史标识、机械门禁和冷启动审计覆盖。 |
| Coherence | PASS | proposal、OpenSpec design、delta spec、技术 Design Doc 与实际治理资产职责一致，无 spec/design 漂移。 |
| Engineering | PASS | 完整 `pnpm check`、strict OpenSpec、CodeGraph index/status 全部退出码 0。 |
| Security / Scope | PASS | 跟踪文件秘密扫描通过；实际 change 区间无业务逻辑、版本号、安装包或发布操作。 |

## 1. Completeness

### 任务完成

- `openspec instructions apply --change organize-canonical-project-assets --json` 返回 `15/15`、`remaining: 0`、`state: all_done`。
- `openspec/changes/organize-canonical-project-assets/tasks.md` 的 15 项均为 `[x]`。
- `docs/superpowers/plans/2026-07-31-project-context-recovery.md` 的 30 个计划步骤均已完成。

### Requirements 覆盖

| Requirement | 结果 | 实现证据 |
| --- | --- | --- |
| 固定的新会话冷启动入口 | PASS | `AGENTS.md:3-9` 固定五步协议；`docs/README.md:5-24` 提供问题域权威和有限阅读；`scripts/check-project-quality.mjs:135-183` 机械校验入口和顺序。 |
| 当前能力使用互斥状态 | PASS | `docs/current-state.md:11-17` 定义五种枚举，`:30-40` 为关键能力逐项分类并附代码、测试或用户验收依据。 |
| 不同问题域具有明确权威来源 | PASS | `docs/README.md:5-15` 指定问题域权威；产品、架构、实现索引分别单向链接当前状态，不复制完成度。 |
| 历史资产不参与当前事实裁决 | PASS | `docs/README.md:26-32` 仅在历史追溯区链接；`docs/product-prototype/index.html:323-325` 首屏提示非权威；项目门禁阻止历史链接回到默认入口。 |
| 变更计划与代码定位可恢复 | PASS | `AGENTS.md:8-9`、`docs/current-state.md:40-44` 可恢复 active change；`docs/internal/codegraph.md` 与实现证据索引提供稳定符号和查询起点。 |
| 冷启动审计能够验证上下文完整性 | PASS | `docs/current-state.md:19-26` 记录审计边界、五题答案、门禁和 CodeGraph 证据；独立新会话未读取历史原型、未猜测入口。 |

## 2. Correctness 与 Scenario Coverage

1. **新会话进入仓库：PASS。** `AGENTS.md` 明确先读文档地图、再读当前状态；门禁对调换步骤和移入历史链接的回归夹具会失败。
2. **代码已实现但用户尚未验收：PASS。** 更新部署、版本恢复、本机运行、待办和成功证据均为 `IMPLEMENTED_UNVERIFIED`，没有被自动测试升级为 `VERIFIED`。
3. **仅存在长期产品目标：PASS。** 两种仓库来源组合均为 `TARGET`，并指向 `resolveRepository` 尚未接通的精确缺口。
4. **产品契约与当前代码不一致：PASS。** 产品契约继续保留仓库来源目标；当前状态和实现索引如实记录未接通，不以现状删除目标。
5. **仓库仍保留历史 HTML 原型：PASS。** 原型保留，首屏标记“仅用于追溯”，默认导航和事实裁决均排除它。
6. **新会话恢复未完成工作：PASS。** current-state、AGENTS 和文档地图均指向 active OpenSpec/Comet change；proposal、design、specs、tasks 与 Comet phase 可从仓库恢复。
7. **治理变更准备完成：PASS。** 独立审计只按 `AGENTS.md` 默认路径阅读，五题均能附仓库路径回答。
8. **必答问题只能通过猜测回答：PASS（失败条件未发生）。** 审计没有读取旧聊天、没有遍历历史原型，也没有凭文件名猜代码入口。

## 3. Coherence

- proposal 的范围保持为文档、上下文入口、变更导航和代码定位说明；实际 `0a22f58...HEAD` 区间没有产品运行逻辑修改。
- OpenSpec design 的六项决策均已落实：分层事实体系、五种状态、问题域权威、历史资产降级、OpenSpec/Comet 与 CodeGraph 分工、冷启动审计门禁。
- 技术 Design Doc `docs/superpowers/specs/2026-07-31-project-context-recovery-design.md` 存在，且入口、状态账本、迁移规则、维护触发器、审计失败条件与实现一致。
- delta spec 与 OpenSpec design、技术 Design Doc 无矛盾；不存在需要记录的 Implementation Divergence。
- 实现索引只记录技术接通事实和缺口，完成度单向指向 current-state；文档地图不再形成第二份产品合同。

## 4. 新鲜验证证据

### 完整工程门禁

`pnpm check` 退出码 0，包含：

- `pnpm check:project`：PASS，308 个文件、17 个必需文档，架构预算与链接有效；
- `pnpm check:secrets`：PASS，扫描 306 个跟踪文件，未发现高置信度凭据；
- `cargo fmt --all -- --check` 与 workspace clippy `-D warnings`：PASS；
- Rust：desktop lib 147、deploy-core 109、fixture 2、hello 1，共 259 项通过；
- 前端 Vitest：36 个文件、195 项通过；
- release manifest：2 项通过；
- desktop 与 site build：PASS；仅保留既有 Vite 大 chunk 警告，无构建失败。

### 规范与代码导航

- `openspec validate organize-canonical-project-assets --strict`：退出码 0；
- `pnpm codegraph:index`：退出码 0；
- `pnpm codegraph:status`：退出码 0，201 files、3,134 nodes、9,745 edges，索引最新；
- 修正 `base-ref` 后再次运行 `pnpm check:project` 与 strict OpenSpec：均退出码 0；
- 第二次 build guard：全部 PASS，桌面构建通过并重新进入 full verify。

## 5. Issues by Priority

### CRITICAL

无。

### WARNING

无。

### SUGGESTION

无。

## 6. 最终判定

**PASS — Ready for archive confirmation.**

验证报告仅证明本 change 的治理资产与恢复机制符合规范；不会把自动门禁通过升级为新的用户 `VERIFIED` 能力，也不会自动授权正式发布或归档。
