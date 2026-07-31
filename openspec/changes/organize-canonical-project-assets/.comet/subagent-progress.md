# Comet 子代理进度 — organize-canonical-project-assets

- 当前计划任务：`Task 2: 建立一分钟冷启动入口和权威文档地图`
- 映射 OpenSpec 任务：`1.2 更新 AGENTS.md，加入一分钟冷启动协议、固定阅读顺序和事实冲突处理规则`；`1.3 更新根目录 README.md 与 docs/README.md，明确文档职责、权威层级和当前文档导航`
- 当前阶段：`done`
- 实现者：`/root/context_recovery_task2`
- 实现基线：`c67870b3ac9d72d58f7c2bbfc5d2a4ef881a5e1d`
- review_mode：`standard`
- 实现提交：`52e9164 docs: define one-minute project cold start`
- 变更文件：`AGENTS.md`、`README.md`、`docs/README.md`、`scripts/check-project-quality.mjs`
- 测试证据：`pnpm check:project` PASS；`pnpm check:secrets` PASS；`pnpm codegraph:sync` 索引最新（tdd_mode 为 `direct`）
- 风险任务级 review：未触发；实现者自报无风险，协调者复核 77 行治理资产 diff，无风险信号
- 审查-修复轮次：`0/1`
- 未解决反馈：无
- 勾选状态：计划 Task 2 的 6 个步骤与 OpenSpec 1.2、1.3 已勾选
- 已完成前置：Task 1，提交 `065a16a`，进度提交 `c67870b`
