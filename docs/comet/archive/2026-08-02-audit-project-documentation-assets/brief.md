# Outcome

在不依赖历史聊天的前提下，新会话能够从项目入口准确区分产品目标、当前可用性、实现证据、进行中变更与历史资产；所有当前维护的文档都与仓库事实一致，项目门禁能够阻止本轮已经发现的同类事实回退。

# Scope

- 逐项复核根入口、`docs/` 当前维护文档、内部实现索引、项目上下文规格、Comet 配置和工程门禁，并以当前代码、测试、文件系统、CodeGraph 与 Comet Runtime 状态交叉验证。
- 修正当前维护文档中的已确认错误：历史 HTML 原型的存续状态、Native/Classic change 的发现路径、产品目标与当前能力的边界、秘密正文与 SQLite 元数据边界。
- 删除未被文档地图收录且重复产品合同的 `docs/local-running.md`；本机运行的稳定目标继续由产品合同、架构、前端规范与验收标准共同覆盖。
- 更新冷启动与实现导航，使 Native change 从 `.comet/current-change.json` 和 `docs/comet/changes/` 恢复，Classic change 从 selection、Comet/OpenSpec 工具状态和 `openspec/changes/` 恢复；不得把易变化的 active 状态只复制为静态文案。
- 扩展 `scripts/check-project-quality.mjs` 的文档回归检查，至少覆盖顶层维护文档可发现性、保留的历史原型与“已删除”陈述不能并存，以及冷启动入口包含可执行的 Native/Classic 恢复线索。
- 更新项目上下文恢复规格，使归档后的规范与上述治理规则一致。

# Non-goals

- 不改变产品合同中的四种来源/运行位置组合、用户流程、成功判定或 Provider 行为。
- 不把自动测试提升为用户验收，不改变当前能力的 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`TARGET` 或 `OUT_OF_SCOPE` 判定。
- 不修改业务代码、运行时数据、服务器资源、应用版本、标签、Release、安装包或官网分发。
- 不重写 archived OpenSpec/Classic change、历史 Superpowers 计划与验证报告；这些记录保留其形成时的事实。
- 不删除 `docs/product-prototype/index.html`；它继续作为带有显著非权威提示的历史追溯资产。

# Acceptance examples

- 当 `docs/product-prototype/index.html` 仍存在时，当前维护文档不得宣称“历史 HTML 原型已经删除”；工程规范应明确区分“并行权威原型”与“隔离的历史追溯资产”。
- 当项目选中 Native change 时，新会话能从 `AGENTS.md`、文档地图和 `.comet/current-change.json` 定位 `docs/comet/changes/<change>/`，而不是只检查 `openspec/changes/` 后错误判断没有 active change。
- 当根 README 或专题文档描述仓库来源与本机运行时，读者能就近看到这是 MVP 目标，并通过 `docs/current-state.md` 确认仓库来源当前仍是 `TARGET`。
- 当安全文档说明秘密存储时，表述与实现一致：秘密正文进入系统密钥库；SQLite 可以保存非秘密配置、状态和受限秘密引用，但不保存秘密正文。
- 当新的顶层 `docs/*.md` 没有进入文档地图或被明确分类时，`pnpm check:project` 失败并指出不可发现的文档。
- 当保留历史原型的同时重新加入“原型已删除”式当前陈述时，`pnpm check:project` 失败。

# Constraints and invariants

- `docs/product-contract.md` 仍是产品目标权威，`docs/current-state.md` 仍是完成度与用户验收权威，当前代码和有效测试仍决定可执行行为，`docs/architecture.md` 仍决定技术归属。
- active change 的实时身份以 `.comet/current-change.json` 和对应 workflow 的只读工具状态为准；静态状态页只记录稳定的恢复规则、已承诺范围或带日期的审计事实，不冒充实时锁或 selection。
- 历史资产不得进入默认冷启动阅读路径，也不得参与当前事实裁决。
- 文档内容修订不得掩盖已知实现缺口，尤其不得把仓库地址来源写成当前已接通。
- 只用项目相对路径保存 Comet 证据，不在文档或日志中写入秘密正文。

# Decisions

- 本次采用“审计后直接修正确认错误并加最小门禁”，而不是只输出一次性审计报告。
- 只修改当前维护的入口、规范、状态、实现导航和质量脚本；历史计划、报告与已归档 change 保持不可变。
- `docs/local-running.md` 作为孤立且重复的第二套产品定义删除，不再为它建立新的权威层级。
- `docs/current-state.md` 不再用容易失真的无日期断言充当 active change 注册表；它指向 selection 和 workflow 工具状态，并只保存本次审计的稳定结论与日期证据。
- 项目门禁采用可机械验证的结构与矛盾检查，不尝试用关键词证明全部业务语义正确；业务语义仍通过规格、CodeGraph、源码和受影响测试人工复核。
- 用户于 2026-08-02 确认上述共享理解，同意进入 Build。

# Open questions

无。

# Verification expectations

- `pnpm check:project`、`pnpm check:secrets`、`git diff --check` 通过。
- `pnpm exec openspec validate --all --strict` 通过，Native proposed spec 与归档后的 canonical spec 一致。
- `pnpm codegraph:status` 保持最新；本次没有业务代码入口变化，不重建图谱。
- 逐项文本复核确认：不存在与保留原型冲突的当前陈述，Native/Classic 恢复路径可从冷启动入口到达，仓库来源仍明确为 `TARGET`，秘密存储边界与代码/测试一致。
- Comet Verify 记录所有验收项的项目内证据；未运行的检查必须明确说明，不得把未执行项写成通过。
