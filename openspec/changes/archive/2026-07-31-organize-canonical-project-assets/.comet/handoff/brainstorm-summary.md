# Brainstorm Summary

- Change: `organize-canonical-project-assets`
- Date: 2026-07-31

## 确认的技术方案

- 采用“方案二：分层权威资产”，不建设单一大总览，也不试图仅靠代码自动生成产品事实。
- `AGENTS.md` 和 `docs/README.md` 负责一分钟冷启动协议与固定阅读顺序。
- `docs/current-state.md` 成为唯一当前状态账本，只允许 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`NEXT`、`TARGET`、`OUT_OF_SCOPE` 五种互斥状态。
- `docs/product-contract.md` 只记录稳定产品目标和范围；`docs/architecture.md` 只记录技术边界；`docs/internal/implementation-inventory.md` 记录代码证据和入口。
- OpenSpec / Comet 记录需求、决策与变更过程；CodeGraph 负责定义、调用关系与影响范围定位；两者都不代替当前状态账本。
- 历史原型和旧设计保留用于追溯，但退出默认导航并明确标为非权威。
- 权威性按问题领域裁决：产品意图看产品契约，完成度看当前状态，可执行行为看代码和测试，技术边界看架构，代码关系看 CodeGraph，进行中改动看 active OpenSpec / Comet change。

## 关键取舍与风险

- 多份文档可能再次重复：每份资产只回答一个问题域，跨文档只链接、不复制结论。
- 当前状态可能过期：功能实现、用户验收、OpenSpec 归档和跨层变更都必须触发状态同步检查。
- CodeGraph 可能滞后：记录同步时间；不可用时回退到源码、`rg` 和测试，不伪造图关系。
- 历史资产可能被误读：从当前导航移除，并在入口处明确“非权威参考”。
- 当前工作区存在大量未提交资产：实施和提交只触碰本 change 明确列出的治理文件，不清理、不覆盖其他改动。

## 测试策略

- 运行 OpenSpec 校验、文档链接与状态枚举一致性检查。
- 运行 `pnpm check:project`、`pnpm check:secrets` 和受影响的文档门禁。
- 同步 CodeGraph，并核对实现清单中的关键入口。
- 模拟无历史上下文的新会话，只按冷启动入口读取，验证其能回答：已验收能力、未验收实现、最近下一步、禁止事项、代码入口。
- 缺少用户证据时禁止写成 `VERIFIED`；无法裁决的冲突必须显式登记，不能以推断替代事实。

## Spec Patch

无。现有 delta spec 已完整覆盖冷启动入口、状态模型、问题域权威、历史资产降级、OpenSpec / CodeGraph 分工和冷启动审计，不需要额外补丁。
