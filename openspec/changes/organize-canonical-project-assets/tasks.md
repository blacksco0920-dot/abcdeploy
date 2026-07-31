## 1. 建立唯一的当前事实入口

- [x] 1.1 新增 `docs/current-state.md`，用 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`NEXT`、`TARGET`、`OUT_OF_SCOPE` 记录能力状态、证据和更新时间
- [x] 1.2 更新 `AGENTS.md`，加入一分钟冷启动协议、固定阅读顺序和事实冲突处理规则
- [x] 1.3 更新根目录 `README.md` 与 `docs/README.md`，明确文档职责、权威层级和当前文档导航

## 2. 消除文档资产中的事实冲突

- [ ] 2.1 调整 `docs/product-contract.md`，只保留稳定产品契约，并将实现进度统一指向 `docs/current-state.md`
- [ ] 2.2 调整 `docs/architecture.md`，保留技术边界和代码入口，不再用目标设计冒充已验证能力
- [ ] 2.3 更新 `docs/internal/implementation-inventory.md`，按代码证据列出已实现能力、未接通入口和主要模块
- [ ] 2.4 修正“代码仓库地址已支持”和“产品原型已删除”等已发现的矛盾表述
- [ ] 2.5 将 `docs/product-prototype/` 明确标记为历史讨论资产，并从当前文档主导航中移除其权威地位

## 3. 建立可持续的变更与代码导航机制

- [ ] 3.1 在文档中明确 OpenSpec/Comet 负责需求与决策历史，CodeGraph 负责代码定义、调用关系和影响范围
- [ ] 3.2 更新 CodeGraph 说明与当前代码入口索引，使后续会话能从业务能力快速定位到 Feature、应用服务、仓储和 Provider
- [ ] 3.3 记录本次治理的变更依据和维护规则，禁止后续文档重新混写目标、实现和验收状态

## 4. 验证新会话冷启动质量

- [ ] 4.1 模拟无历史上下文的新会话，验证其能准确回答已验证能力、未验证实现、下一步、禁止事项和代码入口五个问题
- [ ] 4.2 校验所有当前文档链接、状态枚举、权威引用和 OpenSpec 变更资产的一致性
- [ ] 4.3 运行 `pnpm check:project`、`pnpm check:secrets` 与受影响的文档检查，并同步 CodeGraph
- [ ] 4.4 将验证证据写回 `docs/current-state.md` 和本变更任务清单，确保结论可追溯
