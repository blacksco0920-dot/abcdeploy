---
change: organize-canonical-project-assets
design-doc: docs/superpowers/specs/2026-07-31-project-context-recovery-design.md
base-ref: fd5bacfd1d7116fee3d368da2e8e1de7b0359f97
---

# ABCDeploy 项目上下文恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ABCDeploy 的产品状态、稳定契约、技术边界、实现证据和进行中变更固化为可验证的仓库资产，使不具备历史聊天上下文的新会话能够从 `AGENTS.md` 快速、准确地恢复工作。

**Architecture:** 使用“入口 → 当前事实 → 稳定契约/架构 → 实现证据 → OpenSpec/Comet”的分层事实体系。`docs/current-state.md` 只记录带证据的当前状态；产品、架构、代码导航和变更历史分别留在各自权威资产中，并由项目质量脚本阻止入口或状态枚举回退。

**Tech Stack:** Markdown、Node.js 22、现有 `scripts/check-project-quality.mjs`、OpenSpec CLI、Comet CLI、CodeGraph、Git。

## Global Constraints

- 所有产物使用简体中文；状态枚举必须原样使用 `VERIFIED`、`IMPLEMENTED_UNVERIFIED`、`NEXT`、`TARGET`、`OUT_OF_SCOPE`。
- 只修改本 change 的治理资产；不得格式化、暂存、提交、回滚或删除现有业务代码和其他用户未提交改动。
- `docs/product-contract.md` 决定产品目标，`docs/current-state.md` 决定当前完成度，当前代码与有效测试决定可执行行为，`docs/architecture.md` 决定技术归属。
- 没有用户真实验收证据的能力不得标记为 `VERIFIED`；代码存在只能支持 `IMPLEMENTED_UNVERIFIED`。
- 历史原型继续保留为非权威参考，不进入新会话默认阅读路径；不恢复用户已经删除的历史文件。
- 修改前使用 CodeGraph 定位代码证据；跨层代码发生变化时才重建索引，本 change 不修改产品运行逻辑。
- 禁止修改应用版本、生成 DMG、触发远端发布或整理与本 change 无关的脏工作区。

## File Structure

| 文件 | 本计划中的唯一职责 |
| --- | --- |
| `docs/current-state.md` | 当前能力状态、证据截止时间、active change、最近下一步、禁区和待确认事项 |
| `AGENTS.md` | 一分钟冷启动协议、工程硬约束和完成触发器 |
| `README.md` | 面向开发者的项目入口和当前事实跳转，不承载详细进度 |
| `docs/README.md` | 文档地图、问题域权威、冲突裁决和默认/按需阅读边界 |
| `docs/product-contract.md` | 稳定产品目标和交互契约，不陈述实现完成度 |
| `docs/architecture.md` | 当前/目标架构边界及依赖方向，不陈述用户验收结果 |
| `docs/internal/implementation-inventory.md` | 能力到前端、Tauri、仓储、Provider、测试和缺口的代码证据索引 |
| `docs/internal/codegraph.md` | CodeGraph 的定位职责、同步条件和稳定查询起点 |
| `docs/product-prototype/index.html` | 对仍保留的历史原型显示非权威提示 |
| `scripts/check-project-quality.mjs` | 对冷启动必需文件、状态枚举、入口链接和历史资产导航进行机械门禁 |
| `openspec/changes/organize-canonical-project-assets/tasks.md` | 逐项记录本计划 15 项原始任务的真实完成状态 |

## 原始任务覆盖

| OpenSpec 项 | 实施任务 |
| --- | --- |
| 1.1 | Task 1 |
| 1.2、1.3 | Task 2 |
| 2.1、2.2、2.4 | Task 3 |
| 2.3、2.5、3.1、3.2、3.3 | Task 4 |
| 4.1、4.2、4.3、4.4 | Task 5 |

---

### Task 1: 建立可机械校验的当前状态账本

**Files:**
- Create: `docs/current-state.md`
- Modify: `scripts/check-project-quality.mjs`
- Modify: `openspec/changes/organize-canonical-project-assets/tasks.md`

**Interfaces:**
- Consumes: `docs/product-contract.md` 的稳定目标、CodeGraph 查询结果、现有有效测试和用户已经确认的服务器正向 MVP 验收事实。
- Produces: 后续入口统一引用的 `docs/current-state.md`，以及 `checkProjectContextRecovery()` 文档门禁。

- [x] **Step 1: 先扩展项目门禁，使缺失状态账本产生可复现失败**

  在 `requiredFiles` 中加入 `docs/current-state.md`，并在主流程调用下列检查：

  ```js
  checkProjectContextRecovery();

  function checkProjectContextRecovery() {
    const currentState = "docs/current-state.md";
    if (!existsSync(currentState)) return;
    const text = readFileSync(currentState, "utf8");
    const statuses = [
      "VERIFIED",
      "IMPLEMENTED_UNVERIFIED",
      "NEXT",
      "TARGET",
      "OUT_OF_SCOPE",
    ];
    for (const status of statuses) {
      if (!text.includes(status)) failures.push(`${currentState} 缺少状态枚举：${status}`);
    }
  }
  ```

- [x] **Step 2: 运行门禁并确认 RED 来自状态账本缺失**

  Run: `pnpm check:project`

  Expected: FAIL，且包含 `缺少开源项目必需文件：docs/current-state.md`；不得修复其他既有失败。

- [x] **Step 3: 创建当前状态账本并逐项附证据**

  文件必须按以下固定章节组织：

  ```markdown
  # ABCDeploy 当前状态

  > 更新时间：2026-07-31。证据截止：本次 change 验证完成时。

  ## 状态定义
  ## 关键用户能力
  ## 当前进行中的变更
  ## 最近下一步
  ## 明确禁区与非目标
  ## 已知冲突与待确认事项
  ## 本页维护触发器
  ```

  “关键用户能力”表至少覆盖四种来源/运行位置组合、服务器正向主线、完整待办、成功证据、更新部署、版本恢复和当前治理 change。只有用户明确验收过的服务器正向 MVP 可标记 `VERIFIED`；本机运行、仓库来源、更新和恢复若只有代码/测试证据，标记为 `IMPLEMENTED_UNVERIFIED` 或 `TARGET`，并引用精确文件、测试或 active change。

- [x] **Step 4: 验证状态枚举与文件入口变为 GREEN**

  Run: `pnpm check:project`

  Expected: PASS，或只剩明确属于工作区其他改动的失败；若有后者，记录原始输出，不修改无关文件。

- [x] **Step 5: 勾选 OpenSpec 1.1 并精确暂存本任务新增内容**

  更新 `tasks.md` 的 1.1；使用 `git diff -- docs/current-state.md scripts/check-project-quality.mjs openspec/changes/organize-canonical-project-assets/tasks.md` 检查范围。提交时只暂存本任务的新文件/新 hunk，提交信息：

  ```text
  docs: add evidence-backed current state ledger
  ```

---

### Task 2: 建立一分钟冷启动入口和权威文档地图

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `scripts/check-project-quality.mjs`
- Modify: `openspec/changes/organize-canonical-project-assets/tasks.md`

**Interfaces:**
- Consumes: Task 1 的 `docs/current-state.md`。
- Produces: 新会话唯一入口、有限阅读顺序和问题域冲突裁决规则。

- [x] **Step 1: 为入口资产增加失败优先的机械断言**

  扩展 `checkProjectContextRecovery()`，逐个读取 `AGENTS.md`、`README.md`、`docs/README.md`，要求三者都能到达 `docs/current-state.md`；另外要求 `AGENTS.md` 同时包含 `OpenSpec`、`Comet` 和 `CodeGraph`。错误信息分别指出缺失文件和缺失入口，不使用笼统的“上下文无效”。

- [x] **Step 2: 运行门禁并确认入口断言失败**

  Run: `pnpm check:project`

  Expected: FAIL，明确指出尚未链接 `docs/current-state.md` 或缺少变更恢复/代码定位入口。

- [x] **Step 3: 更新 AGENTS.md 的一分钟冷启动协议**

  在工程质量底线之前增加固定顺序：

  ```markdown
  ## 一分钟冷启动

  1. 先读 `docs/README.md`，确认问题域权威和阅读边界。
  2. 再读 `docs/current-state.md`，确认 VERIFIED、未验证实现、NEXT 和禁区。
  3. 只按任务需要读取产品契约、架构或实现清单，不默认遍历历史原型。
  4. 检查 active OpenSpec/Comet change；存在时从仓库状态恢复，不从聊天摘要重建需求。
  5. 修改代码前用 CodeGraph 查询定义、调用者和影响范围。
  ```

  同时增加事实冲突规则和维护触发器：用户验收更新 current-state；产品规则更新 product-contract；代码入口改变更新 implementation-inventory 与 CodeGraph；归档前同步状态和验证证据。

- [x] **Step 4: 收敛 README 和 docs/README.md**

  根 README 保留产品概览和开发命令，增加“当前状态”链接，不再把“服务器主线已验通”等进度断言留在产品介绍。`docs/README.md` 首屏展示问题域权威表，并明确默认只读 `current-state`，产品/架构/实现材料按任务读取；历史原型和 archived changes 仅供追溯。

- [x] **Step 5: 运行入口门禁和 Markdown 链接检查**

  Run: `pnpm check:project`

  Expected: PASS，且不包含失效链接、缺失状态入口或历史资产进入默认导航的错误。

- [x] **Step 6: 勾选 OpenSpec 1.2、1.3 并形成入口提交**

  提交前用 `git diff -- AGENTS.md README.md docs/README.md scripts/check-project-quality.mjs openspec/changes/organize-canonical-project-assets/tasks.md` 核对只含本 change 新 hunk。提交信息：

  ```text
  docs: define one-minute project cold start
  ```

---

### Task 3: 分离稳定产品契约、当前状态与目标架构

**Files:**
- Modify: `docs/product-contract.md`
- Modify: `docs/architecture.md`
- Modify: `docs/current-state.md`
- Modify: `openspec/changes/organize-canonical-project-assets/tasks.md`

**Interfaces:**
- Consumes: Task 1 的状态分类和 `docs/README.md` 的问题域权威规则。
- Produces: 不再互相冒充的产品目标、当前完成度和架构边界。

- [x] **Step 1: 找出进度式断言和目标/现状混写**

  Run:

  ```bash
  rg -n "已经|已完成|已验通|当前实现|当前版本支持|已经支持|原型.*删除" docs/product-contract.md docs/architecture.md
  ```

  Expected: 输出所有需要逐条裁决的候选；每条必须迁移、改写为稳定规则，或证明它确实属于契约/架构。

- [x] **Step 2: 收敛产品契约**

  保留用户模型、四种组合、待办和成功证据等稳定要求；把完成度陈述替换为指向 `current-state.md` 的一句链接。仓库地址来源仍作为产品目标保留，但若当前入口未接通，状态账本必须标记为 `TARGET`，不得删除目标或宣称已支持。

- [x] **Step 3: 标注架构中的“当前边界”与“目标结构”**

  `docs/architecture.md` 对 `commands/`、`application/`、`infrastructure/` 等尚未完全落地的目录使用“目标结构”措辞；当前代码入口只做链接，完成度回到状态账本/实现清单。保留依赖方向和尺寸预算作为规范性约束。

- [x] **Step 4: 运行冲突搜索和项目门禁**

  Run:

  ```bash
  rg -n "已经|已完成|已验通|当前实现|已经支持|原型.*删除" docs/product-contract.md docs/architecture.md
  pnpm check:project
  ```

  Expected: 搜索结果只剩语义上确属稳定规则或明确引用当前状态的内容；项目门禁 PASS。

- [x] **Step 5: 勾选 OpenSpec 2.1、2.2、2.4 并精确提交**

  提交信息：

  ```text
  docs: separate product targets from current facts
  ```

---

### Task 4: 建立代码证据导航并降级历史资产

**Files:**
- Modify: `docs/internal/implementation-inventory.md`
- Modify: `docs/internal/codegraph.md`
- Modify: `docs/product-prototype/index.html`
- Modify: `docs/README.md`
- Modify: `docs/current-state.md`
- Modify: `openspec/changes/organize-canonical-project-assets/tasks.md`

**Interfaces:**
- Consumes: CodeGraph 对当前工作树返回的符号、调用关系和测试入口。
- Produces: 从用户能力到 Feature、Tauri、仓储、Provider、测试的稳定查询起点，以及历史资产非权威标识。

- [x] **Step 1: 用 CodeGraph 重新核对八类能力入口**

  对本地文件夹、仓库地址、本机运行、服务器上线、待办、成功证据、更新、恢复分别运行 `codegraph_explore`；记录稳定符号名、调用链和测试文件。CodeGraph 未返回或提示过期的项，用 `rg` 和源码/测试复核，并在清单写明缺口，不凭文件名补全。

- [x] **Step 2: 重写实现清单为证据索引**

  每项采用下列列定义：

  ```markdown
  | 用户能力 | 前端入口 | Tauri/应用入口 | 仓储/Provider | 测试 | 接通状态/缺口 | CodeGraph 查询词 |
  ```

  删除“HTML 产品原型已经删除”等与当前文件系统不一致的表述；保留 `api.ts`、`lib.rs`、`workspace.rs` 等架构债务及棘轮预算说明。

- [x] **Step 3: 明确 OpenSpec/Comet 与 CodeGraph 分工**

  在实现清单和 CodeGraph 指南中固定：OpenSpec/Comet 保存 why/what/任务/验证和恢复状态；CodeGraph 只定位定义、调用者与影响范围；`current-state.md` 只链接二者，不复制全文。

- [x] **Step 4: 为仍保留的历史原型增加显著非权威提示**

  在 `docs/product-prototype/index.html` 的首屏可见区域加入：

  ```html
  <aside class="archive-notice" role="note">
    历史讨论资产：仅用于追溯，不代表当前产品、实现或完成状态。
  </aside>
  ```

  复用现有样式或增加最小局部样式；不恢复已被用户删除的原型脚本、样式或截图。`docs/README.md` 只在“历史追溯”区链接该页面。

- [x] **Step 5: 更新状态账本的 active change 和代码入口**

  链接 `openspec/changes/organize-canonical-project-assets/`、Design Doc、实现清单与 CodeGraph 指南；“最近下一步”写为完成冷启动审计和验证，不复制 change 全文。

- [x] **Step 6: 运行历史标识和链接验证**

  Run:

  ```bash
  rg -n "历史讨论资产|非当前.*依据|仅用于追溯" docs/product-prototype/index.html docs/README.md
  pnpm check:project
  ```

  Expected: 两处都存在非权威说明，当前导航不要求读取原型，项目门禁 PASS。

- [x] **Step 7: 勾选 OpenSpec 2.3、2.5、3.1、3.2、3.3 并精确提交**

  提交信息：

  ```text
  docs: connect project facts to implementation evidence
  ```

---

### Task 5: 执行无会话冷启动审计并闭合变更证据

**Files:**
- Modify: `docs/current-state.md`
- Modify: `openspec/changes/organize-canonical-project-assets/tasks.md`
- Modify: `openspec/changes/organize-canonical-project-assets/.comet.yaml` only through Comet CLI
- Create during verify phase: Comet verification report at the path selected by `comet-verify`

**Interfaces:**
- Consumes: Tasks 1–4 的全部入口和证据资产。
- Produces: 五个必答问题的无聊天上下文审计、完整门禁输出、同步后的 CodeGraph 和可进入 verify 的 Comet 状态。

- [ ] **Step 1: 运行 OpenSpec 结构校验**

  Run:

  ```bash
  openspec validate organize-canonical-project-assets --strict
  ```

  Expected: change、proposal、design、delta spec 和 tasks 结构全部通过；若当前 CLI 的参数顺序不同，先运行 `openspec validate --help`，只调整命令语法，不调整规范内容来绕过失败。

- [ ] **Step 2: 派发无历史上下文的冷启动审计**

  使用新鲜审计 agent，`fork_turns: none`，只给出仓库路径和以下指令：先读 `AGENTS.md`，严格按其默认路径阅读，然后回答：

  1. 哪些能力是 `VERIFIED`？
  2. 哪些能力只是 `IMPLEMENTED_UNVERIFIED`？
  3. 最近唯一的 `NEXT` 是什么？
  4. 哪些事项是 `OUT_OF_SCOPE` 或明确禁止？
  5. 前端、Tauri/应用、仓储、Provider 和测试分别从何处定位？

  每个答案必须附仓库路径；审计 agent 若读取旧聊天、默认遍历历史原型、猜测代码入口或混淆状态，则本步骤失败并回到对应文档修复。

- [ ] **Step 3: 运行项目治理门禁**

  Run:

  ```bash
  pnpm check:project
  pnpm check:secrets
  pnpm codegraph:index
  pnpm codegraph:status
  ```

  Expected: 全部退出码为 0。因为本 change 不修改运行逻辑，不生成 `.app`；若门禁因 change 外的业务改动失败，保存完整命令、退出码和归因，不删除断言或修改无关文件。

- [ ] **Step 4: 把审计证据写回状态账本**

  在 `docs/current-state.md` 记录审计日期、审计输入边界、五题结果摘要、四条门禁命令及结果、CodeGraph 同步时间。证据只记录路径和结论，不复制完整命令日志。

- [ ] **Step 5: 勾选全部剩余 OpenSpec 4.1–4.4 并核对 15/15**

  Run:

  ```bash
  openspec list --json
  rg -n "^- \[ \]" openspec/changes/organize-canonical-project-assets/tasks.md
  ```

  Expected: change 显示 `completedTasks: 15`、`totalTasks: 15`；未勾选搜索无输出。

- [ ] **Step 6: 按 review_mode 完成最终审查并提交治理资产**

  `standard` 模式下使用 `requesting-code-review` 对本 change 的治理文件做一次轻量审查，修复 CRITICAL 发现，记录接受的非 CRITICAL 发现。只暂存本 change 新增文件和精确 hunk；提交信息：

  ```text
  docs: verify context-independent project recovery
  ```

- [ ] **Step 7: 推进 Comet build 守卫**

  Run:

  ```bash
  comet guard organize-canonical-project-assets build --apply
  comet state next organize-canonical-project-assets
  ```

  Expected: build guard 全部 PASS，phase 变为 `verify`；按 `state next` 的 `SKILL` 自动进入 `comet-verify`，不得把 build 门禁当成最终验证或归档证据。

## Self-Review Result

- Spec coverage: 六项 delta requirements 与 OpenSpec 15 项任务均映射到 Task 1–5。
- Placeholder scan: 计划不包含未决实现占位符；所有文件、状态枚举、命令、提交边界和失败条件均已给出。
- Type/name consistency: `docs/current-state.md`、`checkProjectContextRecovery()`、change 名称、Design Doc 和 base-ref 在各任务中一致。
- Scope control: 计划只触及治理资产；业务代码、版本、安装包和远端发布均明确排除。
