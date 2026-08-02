# Comet Native Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Comet Native the repository-default workflow while retaining explicit Classic access and documenting when direct user requests enter Comet.

**Architecture:** A project-owned `.comet/config.yaml` becomes the routing fact source for `/comet`; `AGENTS.md` becomes the collaboration-policy source for deciding whether a natural-language request should invoke that entry. Runtime state and archived Classic changes remain untouched.

**Tech Stack:** Comet CLI, YAML, Markdown, pnpm project-quality scripts

## Global Constraints

- Default workflow is `native`; both `native` and `classic` remain enabled.
- Native artifacts use `docs/`, `zh-CN`, and `batch` clarification.
- Direct requests that modify product behavior, code, configuration, tests, or authoritative documentation default to `/comet`.
- Read-only questions, explanations, status reports, reviews, and non-mutating Git operations do not create a change.
- Do not migrate archived Classic changes or modify global `~/.comet/config.yaml`.
- Do not modify application versions, tags, releases, installers, download assets, or product behavior.

---

### Task 1: Pin the project to Comet Native

**Files:**
- Create: `.comet/config.yaml`

**Interfaces:**
- Consumes: Comet project schema `comet.project.v1`.
- Produces: `/comet` resolves to `comet-native` from `project-config`; `/comet-classic` remains available because `classic` stays in `workflows`.

- [ ] **Step 1: Capture the pre-change routing baseline**

Run:

```bash
comet workflow resolve . --json
```

Expected before implementation: JSON contains `"workflow": "classic"` and `"source": "legacy-fallback"`.

- [ ] **Step 2: Add the project configuration**

Create `.comet/config.yaml` with exactly:

```yaml
schema: comet.project.v1
default_workflow: native
workflows:
  - native
  - classic
ambient_resume: true
native:
  artifact_root: docs
  language: zh-CN
  clarification_mode: batch
  snapshot:
    include:
      - "**/*"
    exclude: []
    max_files: 10000
    max_total_bytes: 268435456
    max_duration_ms: 60000
```

- [ ] **Step 3: Verify routing and Native configuration parsing**

Run:

```bash
comet workflow resolve . --json
comet native status
```

Expected: resolver JSON contains `"workflow": "native"`, `"skill": "comet-native"`, and `"source": "project-config"`; Native status reads the configuration without an error and reports no active Native change.

- [ ] **Step 4: Verify that the configuration did not create change state**

Run:

```bash
test ! -e .comet/current-change.json
test ! -e docs/comet/changes
git status --short
```

Expected: both `test` commands exit 0; Git lists only `.comet/config.yaml` and already-planned documentation changes.

- [ ] **Step 5: Commit the routing configuration**

```bash
git add .comet/config.yaml
git diff --cached --check
git commit -m "chore: default comet workflow to native"
```

### Task 2: Persist direct-request collaboration rules

**Files:**
- Modify: `AGENTS.md:8-17`

**Interfaces:**
- Consumes: the Native route established by Task 1.
- Produces: a cold-start rule that determines whether natural-language input enters Comet and prevents unrelated work from being attached to an active change.

- [ ] **Step 1: Add the Comet collaboration policy after the cold-start maintenance triggers**

Insert this section before `## 工程质量底线`:

```markdown
## Comet 路由与协作

- 会改变产品行为、代码、配置、测试或权威文档的直接需求，默认调用 `/comet`，按项目配置进入 Comet Native。
- 问答、解释、只读检查、状态汇报、代码审查和不修改项目的 Git 操作不创建 Comet change。
- 与唯一 active change 目标一致的后续输入自动恢复该 change；无关任务不得附加到现有 change。
- 用户显式指定 `/comet-native` 或 `/comet-classic` 时服从显式入口；不得根据任务大小、文件数量或模型能力在两种工作流之间隐式切换。
- Native 与 Classic 的 change、状态和产物保持独立，不迁移已归档的 Classic change。
```

- [ ] **Step 2: Verify the policy is complete and unambiguous**

Run:

```bash
rg -n "默认调用|不创建 Comet change|自动恢复|显式入口|保持独立" AGENTS.md
```

Expected: all five policy clauses appear exactly once under `## Comet 路由与协作`.

- [ ] **Step 3: Run repository gates and final Comet checks**

Run:

```bash
pnpm check:project
pnpm check:secrets
comet workflow resolve . --json
comet native status
git diff --check
```

Expected: both pnpm checks pass; Comet still resolves to Native from project config; Native status has no configuration error; Git reports no whitespace error.

- [ ] **Step 4: Confirm excluded state remained untouched**

Run:

```bash
test ! -e .comet/current-change.json
git diff --name-only HEAD
```

Expected: no current change selection exists; the only uncommitted implementation file is `AGENTS.md`.

- [ ] **Step 5: Commit the collaboration policy**

```bash
git add AGENTS.md
git diff --cached --check
git commit -m "docs: default development changes to comet native"
```

### Task 3: Final repository verification

**Files:**
- Verify only: `.comet/config.yaml`
- Verify only: `AGENTS.md`

**Interfaces:**
- Consumes: Task 1 routing configuration and Task 2 collaboration policy.
- Produces: fresh evidence that a new session will enter Native for qualifying direct requests without creating a spurious active change.

- [ ] **Step 1: Run the complete acceptance command set**

Run:

```bash
pnpm check:project
pnpm check:secrets
comet workflow resolve . --json
comet native status
test ! -e .comet/current-change.json
git status --short
```

Expected: all commands exit 0; resolver reports Native from project config; no active selection exists; worktree is clean.

- [ ] **Step 2: Record the resulting commits**

Run:

```bash
git log -4 --oneline
```

Expected: history includes `chore: default comet workflow to native` and `docs: default development changes to comet native`, preceded by the approved design and plan commits.
