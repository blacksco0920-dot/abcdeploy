---
change: retire-legacy-desktop-command-surface
design-doc: docs/superpowers/specs/2026-08-02-retire-legacy-desktop-command-surface-design.md
base-ref: 24e0fc79f9bda0401362b4e93cb570774b4abfa8
---

# 退役旧桌面命令面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以当前随应用打包的前端为唯一受支持的 IPC 消费者，删除不可达 Tauri endpoint、前端空壳及其专属实现，同时保持本机、服务器、更新、恢复和旧数据迁移行为不变。

**Architecture:** 新增一个复用 TypeScript AST 的命令面审计模块，分别提取 Rust handler、生产 TypeScript 和 Vite bundle 命令集合。实施按“前端空壳 → 孤立命令 → 共享内核命令 → 数据与迁移命令”从边界向内收缩；没有 IPC 消费者但仍承担内部或数据职责的函数仅移除命令属性与注册，不进行目录迁移。

**Tech Stack:** Node.js 22、TypeScript Compiler API、Node test runner、React 19、Vite 7、Tauri 2、Rust、SQLite、Vitest、pnpm、CodeGraph、OpenSpec。

## Global Constraints

- 当前随应用打包的前端是唯一受支持的 Tauri IPC 消费者；旧命令没有外部兼容承诺。
- 完成时 `registeredCommands = sourceCommands = bundledCommands`，不使用历史兼容允许清单掩盖差异。
- 只有生产调用、Rust 内部调用、持久化/迁移职责和有效行为测试均为空的实现才可删除。
- `WorkspaceState` 的数据库升级、旧记录读取、重启恢复、当前在线版本指针和 deployment-path 聚合必须保留。
- 保持本地文件夹来源、本机运行、Linux 服务器上线、更新、恢复、失败不移动在线版本和重启恢复的当前可观察行为。
- 不改变产品交互、部署状态机、数据库 schema、Provider 选择、稳定错误代码或脱敏规则。
- 不实现仓库 URL 来源，不进行 commands/application/workspace 大规模目录迁移。
- 不新增第三方依赖；解析器使用项目已有 TypeScript 依赖。
- 不修改版本号、不生成 DMG、不创建标签、不触发 GitHub Release 或官网分发。
- 自动验证不得把任何能力升级为 `VERIFIED`。
- 生产 TypeScript/TSX 默认不超过 800 行、Rust 默认不超过 1200 行；现有超限文件只能净缩小，禁止用纯移动或压缩格式规避棘轮。
- 每个任务遵循 Red → Green → Refactor，并在独立验证通过后小步提交；不要把相邻任务合成一次大提交。

---

## 文件结构与职责

**新增：**

- `scripts/lib/desktop-command-surface.mjs`：纯解析与集合比较模块，不读取 `process.cwd()`，便于夹具测试。
- `scripts/check-desktop-command-surface.mjs`：仓库 CLI；负责定位生产源码、Rust handler 和 bundle，输出稳定诊断并设置退出码。
- `scripts/desktop-command-surface.test.mjs`：Node 单测，覆盖 AST、Rust handler、bundle 与差异分类。
- `scripts/fixtures/desktop-command-surface/source-valid.ts`：单行、多行、泛型和导入别名夹具。
- `scripts/fixtures/desktop-command-surface/source-dynamic.ts`：变量、模板字符串和计算命令名的拒绝夹具。
- `scripts/fixtures/desktop-command-surface/handler-valid.rs`：单一 `generate_handler!` 夹具。
- `scripts/fixtures/desktop-command-surface/handler-invalid.rs`：缺失/多 handler 结构异常夹具。
- `scripts/fixtures/desktop-command-surface/bundle-valid.js`：精确字符串字面量与相似子串夹具。
- `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`：逐命令基线、调用证据、兼容职责、处置和验证记录。

**修改或删除：**

- `apps/desktop/src/api.ts`：删除无 Feature 消费者的再导出，保留当前生产类型化调用。
- `apps/desktop/src/api/config-profiles.ts`：删除无生产消费者的旧配置 Profile 客户端。
- `apps/desktop/src/api/secrets.ts`：保留 `replaceRegistryCredentials` 与 `checkSavedRegistryCredentials`；删除旧 Secret CRUD IPC，并把浏览器凭据校验改为不含 IPC 的纯逻辑。
- `apps/desktop/src/api/settings.ts`：保留 `getAppSetting`、`setAppSetting`，删除未进入 bundle 的批量旧包装。
- `apps/desktop/src/api.test.ts`：删除 endpoint 存在性测试，保留浏览器回退、连接脱敏和当前在线版本行为测试。
- `apps/desktop/package.json`、`pnpm-lock.yaml`：删除已证实无生产用途的前端包。
- `apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/capabilities/default.json`、`apps/desktop/src-tauri/src/lib.rs`：移除无消费者命令、专属插件/权限和专属实现；保留共享内核。
- `apps/desktop/src-tauri/src/tests.rs`：把仍有效的内部行为断言留在内部层，只删除退役 endpoint 存在性断言。
- `apps/desktop/src-tauri/src/workspace.rs`、`apps/desktop/src-tauri/src/workspace/tests.rs`、`apps/desktop/src-tauri/src/workspace/current_runs_tests.rs`：只在调用图证明专属时删除方法；迁移、重启和当前指针测试是硬保护线。
- `scripts/check-project-quality.mjs`、`package.json`、`apps/desktop/package.json`：接入静态与 bundle 两级命令面门禁。
- `docs/internal/implementation-inventory.md`、`docs/current-state.md`：记录最终入口、数量、删除规模与自动验证事实。

## 共享接口

后续任务统一使用以下接口，不另建第二套解析器：

```js
// scripts/lib/desktop-command-surface.mjs
export function extractSourceCommands({ files, loadTypeScript }) {
  return { commands: string[], dynamicInvocations: Array<{ file: string, line: number, expression: string }> };
}

export function extractRegisteredCommands({ file, source }) {
  return { commands: string[] };
}

export function extractBundledCommands({ files, registeredCommands, loadTypeScript }) {
  return { commands: string[] };
}

export function compareCommandSets({ registeredCommands, sourceCommands, bundledCommands }) {
  return {
    // (source ∪ bundle) - registered
    missingRegistrations: string[],
    // registered - (source ∪ bundle)
    registeredOnly: string[],
    // bundle - source
    bundleOnly: string[],
    // source - bundle
    sourceNotBundled: string[],
  };
}

export async function auditDesktopCommandSurface({ root, mode }) {
  // mode: "source" | "bundle" | "all"
  return { registeredCommands, sourceCommands, bundledCommands, dynamicInvocations, differences };
}
```

所有命令数组在返回和输出前按字典序排序并去重；CLI 成功退出码为 `0`，动态调用、结构异常或集合不一致为 `1`。

### Task 1: 以 TDD 建立命令面解析器与夹具

- [ ] Task 1 完成：命令面解析器与夹具通过 TDD 验收

**Files:**
- Create: `scripts/lib/desktop-command-surface.mjs`
- Create: `scripts/desktop-command-surface.test.mjs`
- Create: `scripts/fixtures/desktop-command-surface/source-valid.ts`
- Create: `scripts/fixtures/desktop-command-surface/source-dynamic.ts`
- Create: `scripts/fixtures/desktop-command-surface/handler-valid.rs`
- Create: `scripts/fixtures/desktop-command-surface/handler-invalid.rs`
- Create: `scripts/fixtures/desktop-command-surface/bundle-valid.js`

**Interfaces:**
- Consumes: Node `fs/path/module` 与从 `apps/desktop/package.json` 创建的 `createRequire` 所解析的 TypeScript Compiler API。
- Produces: “共享接口”中的四个纯函数；不访问网络、不修改仓库文件。

- [ ] **Step 1: 写解析器失败测试**

  在 `scripts/desktop-command-surface.test.mjs` 中逐项断言：`source-valid.ts` 提取 `alpha/beta/gamma`；泛型、多行和 `invoke as callDesktop` 均可识别；`source-dynamic.ts` 的变量、模板拼接和函数返回值分别产生带文件与行号的 `dynamicInvocations`；Rust 夹具只允许一个 handler；bundle 只识别 AST 字符串字面量，不把 `alpha-suffix` 当作 `alpha`。

  ```js
  assert.deepEqual(result.commands, ["alpha", "beta", "gamma"]);
  assert.deepEqual(dynamic.dynamicInvocations.map(({ line }) => line), [3, 4, 5]);
  assert.throws(() => extractRegisteredCommands(invalid), /只能存在一个可判定的 generate_handler/);
  assert.deepEqual(bundle.commands, ["alpha", "gamma"]);
  ```

- [ ] **Step 2: 运行测试并确认 Red**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Expected: FAIL，提示 `scripts/lib/desktop-command-surface.mjs` 不存在或导出函数未定义。

- [ ] **Step 3: 实现最小 AST 与 handler 解析**

  用 TypeScript AST 识别从 `@tauri-apps/api/core` 导入的 `invoke` 本地绑定，使用 `getStart()` 计算动态调用行号；Rust 解析先去除行注释，再定位唯一 `tauri::generate_handler![...]` 并校验标识符；bundle 以 JS AST 字符串节点和 `registeredCommands` 交集提取命令。

- [ ] **Step 4: 运行测试并确认 Green**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Expected: PASS，所有解析、拒绝和稳定排序断言通过。

- [ ] **Step 5: Refactor 并检查格式**

  抽取 `sortedUnique(values)` 与统一的 `sourceLocation(node, sourceFile)`，确保解析函数没有仓库路径常量；运行 `pnpm exec prettier --check scripts/lib/desktop-command-surface.mjs scripts/desktop-command-surface.test.mjs scripts/fixtures/desktop-command-surface/*`。

- [ ] **Step 6: 提交解析器**

  ```bash
  git add scripts/lib/desktop-command-surface.mjs scripts/desktop-command-surface.test.mjs scripts/fixtures/desktop-command-surface
  git commit -m "test: add desktop command surface parser"
  ```

### Task 2: 建立仓库 CLI、111/56/46 初始失败证据与逐命令矩阵

- [ ] Task 2 完成：仓库 CLI 与逐命令证据矩阵通过审查

**Files:**
- Create: `scripts/check-desktop-command-surface.mjs`
- Modify: `scripts/desktop-command-surface.test.mjs`
- Create: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: Task 1 的 `auditDesktopCommandSurface({ root, mode })` 与 `compareCommandSets(...)`。
- Produces: CLI `node scripts/check-desktop-command-surface.mjs --mode source|bundle|all [--json]`；矩阵字段固定为 `command | feature consumer | TypeScript wrapper | production bundle | Rust internal callers | data/migration duty | tests | decision | rationale`。

- [ ] **Step 1: 写 CLI 诊断失败测试**

  使用临时目录夹具断言 `--mode all --json` 输出稳定字段和排序；人为设置 `registered=[alpha,beta]`、`source=[alpha,gamma]`、`bundle=[alpha]` 时，按共享接口顺序断言四类差异分别为 `gamma/beta/[]/gamma`，退出码为 `1`。

- [ ] **Step 2: 运行测试并确认 Red**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Expected: FAIL，提示 CLI 或仓库审计函数尚不存在。

- [ ] **Step 3: 实现仓库 CLI**

  CLI 用 `import.meta.url` 定位仓库根目录，不依赖调用者的 `process.cwd()`。生产源码范围固定为 `apps/desktop/src/**/*.{ts,tsx}`，排除 `*.test.*`、`*.spec.*`、`src/test/**` 和 `vite-env.d.ts`；Rust 固定读取 `apps/desktop/src-tauri/src/lib.rs`；bundle 固定读取 `apps/desktop/dist/assets/*.js`。文本输出必须包含三集合数量与逐类差异，JSON 输出复用同一结果对象。

- [ ] **Step 4: 生成最新 Vite 基线并确认预期失败**

  Run: `pnpm --filter @abcdeploy/desktop build`

  Run: `node scripts/check-desktop-command-surface.mjs --mode all`

  Expected: FAIL，明确报告 `registered=111`、`source=56`、`bundled=46`；若数量与 base-ref 不同，先检查工作树是否混入别的业务改动，不修改期望值迎合未知状态。

- [ ] **Step 5: 写入基线与 111 条证据矩阵**

  在矩阵头记录 base-ref、审计命令、111/56/46 与“当前前端是唯一受支持消费者”。每个 handler 命令建立一行；先填源码包装、bundle、CodeGraph/`rg` 调用者、数据职责和测试。65 个未进入 bundle 的候选必须全部落行；`check_registry_credentials` 单列为“bundle 中存在但只由浏览器回退保活”的复核项。只有三类最终值可写入 `decision`：`keep-ipc`、`internalize`、`delete`，不得留下空单元格。

- [ ] **Step 6: 用矩阵反查保护线**

  对每个 `internalize` 行执行 `pnpm codegraph:status`、CodeGraph callers/impact 与 `rg -n '<symbol>' apps/desktop/src-tauri/src`；把具体内部调用者或迁移测试名写入 `rationale`。以下保护测试必须作为矩阵证据保留：

  - `migrates_legacy_workspace_model_idempotently`
  - `migrates_legacy_failed_only_project_without_inventing_a_version`
  - `persists_per_address_route_checks_across_workspace_restart`
  - `persists_version_validation_across_workspace_restart`
  - `newer_failed_or_needs_action_production_does_not_replace_online_version`
  - `restart_backfills_production_history_and_preserves_a_newer_rollback`
  - `production_digest_mismatch_is_atomic_and_does_not_switch_pointer`
  - `current_run_query_keeps_the_online_version_after_a_failed_update`

- [ ] **Step 7: 运行测试与文档检查**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Run: `git diff --check`

  Expected: PASS；仓库审计仍按设计失败并保留 111/56/46 证据。

- [ ] **Step 8: 提交 CLI 与证据基线**

  ```bash
  git add scripts/check-desktop-command-surface.mjs scripts/desktop-command-surface.test.mjs openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git commit -m "docs: record desktop command reachability baseline"
  ```

### Task 3: 删除前端空壳并清理无生产用途依赖

- [ ] Task 3 完成：前端空壳、无用依赖和权限完成清理

**Files:**
- Delete: `apps/desktop/src/api/config-profiles.ts`
- Modify: `apps/desktop/src/api/secrets.ts`
- Modify: `apps/desktop/src/api/settings.ts`
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/api.test.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: 当前 Feature 直接使用的 `replaceRegistryCredentials(...)`、`checkSavedRegistryCredentials(...)`、`getAppSetting(...)`、`setAppSetting(...)`。
- Produces: 相同签名的四个 API；浏览器校验由私有 `validateRegistryCredentials(registry, username, password): ProviderCheck` 完成，不再调用 `check_registry_credentials`。

- [ ] **Step 1: 把待退役前端导出写成 Red 契约**

  修改 `apps/desktop/src/api.test.ts`：通过动态导入断言根 API 不再导出 Config Profile CRUD、`getAppSettings`、旧 Secret CRUD 和 `checkRegistryCredentials`。同时保留并收紧 `replaceRegistryCredentials(...)` 的浏览器契约：空密码返回 `AD-IMG-201` 且不能写入 verified 时间，完整输入仍写入非秘密验证时间。删除只证明旧包装行为存在的测试。

- [ ] **Step 2: 运行目标前端测试并确认 Red**

  Run: `pnpm --filter @abcdeploy/desktop test -- src/api.test.ts`

  Expected: FAIL，诊断列出当前仍存在的待退役根 API 导出；浏览器凭据行为断言保持可执行。

- [ ] **Step 3: 删除 11 个无生产消费者包装**

  删除 Config Profile 六个包装；删除 `getSecretStatus/storeSecret/deleteSecret`；删除 `getAppSettings`；删除 `checkRegistryCredentials` IPC 并保留纯浏览器校验。同步删掉 `api.ts` 的旧再导出，不能保留测试专用 facade。

- [ ] **Step 4: 移除已证实无生产引用的依赖与权限**

  从前端依赖移除 `@radix-ui/react-collapsible`、`@radix-ui/react-dropdown-menu`、`@tauri-apps/plugin-clipboard-manager`。从 Rust 移除 `tauri-plugin-clipboard-manager`、`.plugin(tauri_plugin_clipboard_manager::init())` 与 `clipboard-manager:allow-write-text`；保留当前仍使用的 dialog/opener。执行 `pnpm install --lockfile-only` 更新锁文件。

- [ ] **Step 5: 运行 Green 验证**

  Run: `pnpm --filter @abcdeploy/desktop test -- src/api.test.ts src/features/deployment-editor/server-deployment-authorization.test.ts src/features/deployment-editor/server-deployment-setup-service.test.ts`

  Run: `pnpm --filter @abcdeploy/desktop exec tsc --noEmit --noUnusedLocals --noUnusedParameters`

  Run: `pnpm --filter @abcdeploy/desktop build`

  Expected: PASS；生产源码和 bundle 命令都收敛到 45，Rust 注册仍为 111，因此 CLI 仍只因 `registeredOnly` 失败。

- [ ] **Step 6: Refactor 与矩阵更新**

  确认 `navigator.clipboard.writeText`、dialog `open` 和 opener `openUrl` 的生产引用仍存在；把 11 个包装、`check_registry_credentials` 和三个前端依赖/clipboard runtime 的处置写回矩阵。

- [ ] **Step 7: 提交前端空壳清理**

  ```bash
  git add apps/desktop/src/api.ts apps/desktop/src/api/secrets.ts apps/desktop/src/api/settings.ts apps/desktop/src/api.test.ts apps/desktop/package.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/capabilities/default.json apps/desktop/src-tauri/src/lib.rs pnpm-lock.yaml openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git add -u apps/desktop/src/api/config-profiles.ts
  git commit -m "refactor: remove unreachable desktop api wrappers"
  ```

### Task 4: 退役旧预检、Manifest 与项目步骤命令

- [ ] Task 4 完成：旧预检、Manifest 与项目步骤命令完成退役

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/tests.rs`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: 矩阵中 `get_preflight/save_project_step/preview_manifest/apply_manifest/check_docker/discover_ssh_identities` 的裁决。
- Produces: handler 不再注册这些 endpoint；`open_project`、`continue_existing_deployment`、`reset_project_deployment`、`resolve_local_folder_source`、`save_manifest_draft`、`generate_ssh_identity` 的参数、返回值与错误字符串不变。

- [ ] **Step 1: 记录命令面 Red，并确认项目恢复保护线**

  Run: `node scripts/check-desktop-command-surface.mjs --mode source`

  Expected: FAIL，`registeredOnly` 至少包含 `get_preflight/save_project_step/preview_manifest/apply_manifest/check_docker/discover_ssh_identities`。随后检查 `apps/desktop/src-tauri/src/tests.rs` 已覆盖：打开已有项目不得写入源码目录；继续/重置采用现有 adoption 状态；`save_manifest_draft` 拒绝不安全 manifest。只在缺少具体不变量时先补一个会失败的内部行为断言，不新增 endpoint 存在性测试。

- [ ] **Step 2: 运行项目恢复特征测试**

  Run: `cargo test -p abcdeploy-desktop open_project -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop manifest -- --nocapture`

  Expected: 全部 PASS；这些测试作为删除前后的行为基线，不通过临时篡改生产实现制造失败。

- [ ] **Step 3: 从 handler 和 command 属性删除旧边界**

  逐项删除上述注册项及 `#[tauri::command]` 适配器。仍被 `open_project`、源码快照或测试复用的解析/检查函数改为普通私有函数；没有内部调用、迁移职责或行为测试的专属输入类型、常量和辅助函数一并删除。

- [ ] **Step 4: Green 与 Refactor**

  Run: `cargo fmt --all`

  Run: `cargo test -p abcdeploy-desktop open_project -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop manifest -- --nocapture`

  Run: `cargo clippy --workspace --all-targets -- -D warnings`

  Expected: PASS；矩阵对应行没有未裁决或无依据保留项。

- [ ] **Step 5: 提交孤立项目命令清理**

  ```bash
  git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/tests.rs openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git commit -m "refactor: retire legacy project setup commands"
  ```

### Task 5: 退役旧本机准备与服务控制命令

- [ ] Task 5 完成：旧本机准备与服务控制命令完成退役

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/local_process.rs`
- Modify: `apps/desktop/src-tauri/src/local_runtime.rs`
- Modify: `apps/desktop/src-tauri/src/tests.rs`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: `recommend_runtime_config/write_local_env/get_local_infrastructure_status/prepare_local_infrastructure/set_local_infrastructure_service/prepare_local_preview/get_local_development_support/prepare_local_development/start_local_preview_service/cancel_local_preview_start/stop_managed_local_port_owner/get_local_preview_status/stop_local_preview/stop_local_preview_service`。
- Produces: 当前 `start_local_preview`、`create_managed_local_run_workspace`、`verify_managed_local_run` 及其内部运行/停止清理能力不变。

- [ ] **Step 1: 记录命令面 Red，并确认本机主线保护线**

  Run: `node scripts/check-desktop-command-surface.mjs --mode source`

  Expected: FAIL，`registeredOnly` 包含本任务列出的旧本机命令。随后检查现有本机测试已断言受管工作区从固定快照启动、公开地址为 loopback、进程取消终止子进程、连续验证读取同一 run/snapshot 身份；只对缺失不变量先补一个会失败的内部测试，复用匿名化临时目录和假进程，不连接真实服务。

- [ ] **Step 2: 运行目标测试并确认 Red/保护能力**

  Run: `cargo test -p abcdeploy-desktop managed_local -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop local_preview -- --nocapture`

  Expected: 当前特征测试全部 PASS；若 Step 1 发现缺口，则新增断言先因该具体缺口 FAIL，再以最小测试接缝修复到 PASS。

- [ ] **Step 3: 删除旧本机 IPC 并保留共享内部函数**

  从 handler 删除列出的旧命令。当前启动、退出清理或验证仍调用的 `*_inner`、进程表、端口探测、Compose/运行时辅助函数取消 command 暴露但保留内部可见性；只服务旧单服务按钮的状态类型和命令级测试删除。

- [ ] **Step 4: Green 与 Refactor**

  Run: `cargo fmt --all`

  Run: `cargo test -p abcdeploy-desktop managed_local -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop local_preview -- --nocapture`

  Run: `cargo clippy --workspace --all-targets -- -D warnings`

  Expected: PASS；`start_local_preview`、受管快照与连续验证命令仍在三个生产集合中。

- [ ] **Step 5: 提交本机命令清理**

  ```bash
  git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/local_process.rs apps/desktop/src-tauri/src/local_runtime.rs apps/desktop/src-tauri/src/tests.rs openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git commit -m "refactor: retire legacy local runtime commands"
  ```

### Task 6: 退役旧 staging/production、路由修复和外部同步命令

- [ ] Task 6 完成：旧部署控制、路由修复和外部同步命令完成退役

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/deployment_route_verification.rs`
- Modify: `apps/desktop/src-tauri/src/deployment_state.rs`
- Modify: `apps/desktop/src-tauri/src/tests.rs`
- Modify: `apps/desktop/src-tauri/src/tests/deployment_error_tests.rs`
- Modify: `apps/desktop/src-tauri/src/tests/deployment_route_capability_tests.rs`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: `create_deployment_task/begin_deployment_attempt/list_deployment_attempts/pause_deployment_task/prepare_deployment_path_retry/start_staging_deployment/start_deployment_path/resume_staging_deployment/promote_production_deployment/retry_deployment_certificates/open_staging_preview_tunnel/sync_external_deployments/bootstrap_server_caddy/inspect_server_route_conflicts/take_over_server_routes/take_over_deployment_path_routes/reapply_deployment_routes/detect_dns_provider/rollback_environment`。
- Produces: `prepare_managed_server_deployment`、`project_managed_deployment_evidence`、`refresh_deployment`、`check_deployment_routes`、`redeploy_deployment_path_version` 与共享部署执行器/路由状态转换保持不变。

- [ ] **Step 1: 记录命令面 Red，并固化服务器、更新和路由恢复不变量**

  Run: `node scripts/check-desktop-command-surface.mjs --mode source`

  Expected: FAIL，`registeredOnly` 包含本任务列出的旧 staging/production、路由和同步命令。随后逐个确认这些现有内部测试覆盖对应不变量：`runtime_dependency_failures_resume_the_same_server_deploy`、`route_reconciliation_failures_resume_without_redeploying_the_application`、`public_route_failures_pause_without_rebuilding`、`repaired_deployment_path_routes_keep_existing_artifacts_on_the_server`、`interrupted_first_route_check_preserves_the_deployed_version`。发现具体缺口时先增加会失败的共享内部函数或持久化结果断言，不要求旧 command 存在。

- [ ] **Step 2: 运行目标测试并确认保护测试有效**

  Run: `cargo test -p abcdeploy-desktop route -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop server_deploy -- --nocapture`

  Expected: 所有当前主线断言 PASS；新增断言只针对 Step 1 识别出的真实覆盖缺口。

- [ ] **Step 3: 删除旧 IPC，internalize 共享执行器**

  删除列出的 handler 项和薄 command 适配器。仍由 `prepare_managed_server_deployment`、更新、恢复或路由验证调用的执行器、Provider、错误映射、状态转换和 `*_inner` 保持原文件与签名；本任务不得迁移到新 commands/application 目录。

- [ ] **Step 4: Green 与 Refactor**

  Run: `cargo fmt --all`

  Run: `cargo test -p abcdeploy-desktop route -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop server_deploy -- --nocapture`

  Run: `cargo clippy --workspace --all-targets -- -D warnings`

  Expected: PASS；服务器部署、更新和恢复的稳定错误代码与脱敏输出不变。

- [ ] **Step 5: 提交共享内核边界清理**

  ```bash
  git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/deployment_route_verification.rs apps/desktop/src-tauri/src/deployment_state.rs apps/desktop/src-tauri/src/tests.rs apps/desktop/src-tauri/src/tests/deployment_error_tests.rs apps/desktop/src-tauri/src/tests/deployment_route_capability_tests.rs openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git commit -m "refactor: retire legacy deployment control commands"
  ```

### Task 7: 退役旧数据、配置、运行时秘密和 Provider 管理命令

- [ ] Task 7 完成：旧数据、配置、秘密和 Provider 管理命令完成退役

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/runtime_config.rs`
- Modify: `apps/desktop/src-tauri/src/workspace.rs`
- Modify: `apps/desktop/src-tauri/src/workspace/tests.rs`
- Modify: `apps/desktop/src-tauri/src/workspace/current_runs_tests.rs`
- Modify: `apps/desktop/src-tauri/src/tests.rs`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: `get_project_server/get_project_connection_bindings/delete_deployment_path/list_config_profiles/save_config_profile/delete_config_profile/bind_config_profile/list_config_profile_bindings/set_environment_config_bindings/list_project_environments/list_project_versions/list_version_validations/set_version_validation/load_existing_project_config/runtime_config_sync_status/sync_runtime_config_to_server/runtime_secret_status/store_runtime_secret/generate_runtime_secret/secret_status/store_secret/delete_secret/create_cnb_repository/check_cnb_repository_access/enable_cnb_auto_trigger/get_app_settings`。
- Produces: 当前 `list_connections/list_deployment_paths/save_deployment_path/list_deployment_path_runs/load_runtime_config/store_runtime_config/prepare_cnb_secret_bundle/replace_registry_credentials/check_saved_registry_credentials/ensure_cnb_repository/check_cnb_secret_repository_access` 保持原契约；Workspace 数据方法按矩阵保留内部可见性。

- [ ] **Step 1: 记录命令面 Red，并固化数据兼容保护线**

  Run: `node scripts/check-desktop-command-surface.mjs --mode source`

  Expected: FAIL，`registeredOnly` 包含本任务列出的旧数据、配置、秘密和 Provider 管理命令。随后确认 Workspace 测试已断言：旧 schema 幂等升级；旧失败记录不伪造在线版本；配置 Profile 旧数据可被当前聚合读取但不暴露秘密；重启恢复逐地址检查；更新/恢复失败不移动 `currentRunId`。如果同名测试缺少关键字段，先补一个因该真实缺口失败的断言，不复制夹具。

- [ ] **Step 2: 运行数据测试基线**

  Run: `cargo test -p abcdeploy-desktop workspace::tests::migrates_legacy_workspace_model_idempotently -- --exact`

  Run: `cargo test -p abcdeploy-desktop workspace::tests::newer_failed_or_needs_action_production_does_not_replace_online_version -- --exact`

  Run: `cargo test -p abcdeploy-desktop workspace::current_runs_tests::current_run_query_keeps_the_online_version_after_a_failed_update -- --exact`

  Expected: 当前保护测试 PASS；若 Step 1 识别出覆盖缺口，新增字段断言先 FAIL，补齐最小测试接缝后 PASS。

- [ ] **Step 3: 删除公开 CRUD/管理 endpoint，保留数据能力**

  删除列出的 handler 和 command 属性。仍被迁移、当前聚合、本机基础设施或 Provider 流程调用的 `WorkspaceState` 方法保留；只有调用者为空且没有矩阵数据职责的方法、输入类型、序列化模型和纯 endpoint 测试才删除。不得改 SQLite schema 或 migration SQL。

- [ ] **Step 4: 运行完整 Workspace Green**

  Run: `cargo fmt --all`

  Run: `cargo test -p abcdeploy-desktop workspace -- --nocapture`

  Run: `cargo test -p abcdeploy-desktop runtime_config -- --nocapture`

  Run: `cargo clippy --workspace --all-targets -- -D warnings`

  Expected: PASS；矩阵所有数据命令都有 `internalize` 或 `delete` 的具体依据。

- [ ] **Step 5: 提交数据与 Provider 边界清理**

  ```bash
  git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/runtime_config.rs apps/desktop/src-tauri/src/workspace.rs apps/desktop/src-tauri/src/workspace/tests.rs apps/desktop/src-tauri/src/workspace/current_runs_tests.rs apps/desktop/src-tauri/src/tests.rs openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git commit -m "refactor: retire legacy data management commands"
  ```

### Task 8: 用编译器和调用图删除退役入口的专属实现

- [ ] Task 8 完成：退役入口的专属实现与测试残留完成清理

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/tests.rs`
- Modify: `apps/desktop/src-tauri/src/workspace.rs`
- Modify: `apps/desktop/src-tauri/src/workspace/tests.rs`
- Modify: `apps/desktop/src/types.ts`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`

**Interfaces:**
- Consumes: Tasks 3–7 已移除 endpoint 后的 Rust/TypeScript 编译器诊断和矩阵 `decision`。
- Produces: 没有只服务 `delete` 命令的类型、常量、helper、测试或依赖；所有 `internalize` 函数仍有真实调用者或数据测试。

- [ ] **Step 1: 建立孤儿符号失败清单**

  Run: `cargo clippy --workspace --all-targets -- -D warnings`

  Run: `pnpm --filter @abcdeploy/desktop exec tsc --noEmit --noUnusedLocals --noUnusedParameters`

  对矩阵中每个 `delete` 命令执行 CodeGraph impact 和 `rg -n '<symbol>' apps/desktop`；任何只剩定义/测试的专属符号写入同一矩阵行的删除清单。Expected: 删除前至少命中旧类型或测试，形成 Red 清单。

- [ ] **Step 2: 删除专属实现，迁移有效断言**

  删除只服务退役入口的类型和 helper。若命令测试仍保护内部行为，将同一输入/输出断言迁到现有内部函数或 Workspace 方法测试；只删除“handler 中必须出现该命令”或“旧 endpoint 能被调用”的断言。

- [ ] **Step 3: 证明没有伪造缩小**

  Run: `git diff --stat 24e0fc79f9bda0401362b4e93cb570774b4abfa8 -- apps/desktop/src/api.ts apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/workspace.rs apps/desktop/src-tauri/src/tests.rs`

  Expected: 生产代码总删除行数大于新增行数；没有新建承载旧实现的大型业务文件。

- [ ] **Step 4: Green 与矩阵终审**

  Run: `cargo test -p abcdeploy-desktop`

  Run: `cargo clippy --workspace --all-targets -- -D warnings`

  Run: `pnpm --filter @abcdeploy/desktop exec tsc --noEmit --noUnusedLocals --noUnusedParameters`

  Expected: PASS；矩阵 111 行全部有最终 decision、rationale 和验证证据。

- [ ] **Step 5: 提交专属实现清理**

  ```bash
  git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/tests.rs apps/desktop/src-tauri/src/workspace.rs apps/desktop/src-tauri/src/workspace/tests.rs apps/desktop/src/types.ts openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md
  git commit -m "refactor: remove retired command implementation debris"
  ```

### Task 9: 把静态命令契约接入快速项目门禁

- [ ] Task 9 完成：静态命令契约接入项目快速门禁

**Files:**
- Modify: `scripts/check-project-quality.mjs`
- Modify: `package.json`
- Modify: `scripts/desktop-command-surface.test.mjs`

**Interfaces:**
- Consumes: `auditDesktopCommandSurface({ root, mode: "source" })`。
- Produces: `pnpm check:desktop-command-surface` 与 `pnpm check:project` 都会拒绝动态命令、缺失注册和无源码消费者注册。

- [ ] **Step 1: 写项目门禁诊断适配器的失败测试**

  在 Node 测试中为共享的 `commandSurfaceFailures(result)` 诊断适配器写测试：未注册源码调用、无源码消费者注册、动态命令分别产生 failure；完全相等返回空数组。断言诊断包含精确命令名和源文件行号，CLI 与 `check-project-quality.mjs` 后续必须复用该适配器。

- [ ] **Step 2: 运行测试并确认 Red**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Expected: FAIL，因为共享诊断适配器尚未导出。

- [ ] **Step 3: 接入静态门禁**

  在根 `package.json` 增加 `"check:desktop-command-surface": "node scripts/check-desktop-command-surface.mjs --mode source"`；`scripts/check-project-quality.mjs` 顶层等待共享审计函数，把 `commandSurfaceFailures(result)` 并入现有 `failures`，避免启动第二个 Node 进程和重复实现诊断规则。

- [ ] **Step 4: 运行 Green**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Run: `pnpm check:desktop-command-surface`

  Run: `pnpm check:project`

  Expected: PASS；输出的 registered/source 数量完全相等且没有动态调用。

- [ ] **Step 5: 提交静态门禁**

  ```bash
  git add scripts/check-project-quality.mjs scripts/desktop-command-surface.test.mjs package.json
  git commit -m "build: enforce static desktop command contract"
  ```

### Task 10: 把生产 bundle 命令契约接入桌面构建

- [ ] Task 10 完成：生产 bundle 命令契约接入桌面构建

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `scripts/check-desktop-command-surface.mjs`
- Modify: `scripts/desktop-command-surface.test.mjs`

**Interfaces:**
- Consumes: `auditDesktopCommandSurface({ root, mode: "bundle" })` 与 Vite 生成的 `apps/desktop/dist/assets/*.js`。
- Produces: `pnpm --filter @abcdeploy/desktop build` 在 `vite build` 后强制 `registeredCommands = bundledCommands`，并同时拒绝 `sourceNotBundled`。

- [ ] **Step 1: 写 bundle 门禁 Red 测试**

  用夹具断言：注册命令只在注释或较长字符串中出现时仍失败；source 有包装但 bundle 不含时列入 `sourceNotBundled`；精确 JS 字符串字面量进入集合时通过。

- [ ] **Step 2: 运行测试并确认 Red**

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Expected: FAIL，提示构建脚本尚未执行 bundle 模式或相似子串被误判。

- [ ] **Step 3: 接入 build 后门禁**

  把桌面 `build` 固定为 `tsc --noEmit && vite build && node ../../scripts/check-desktop-command-surface.mjs --mode bundle`。bundle 模式在 `dist/assets` 缺失时直接失败并说明先运行 Vite，不读取旧缓存目录以外的文件。

- [ ] **Step 4: 运行三集合 Green**

  Run: `pnpm --filter @abcdeploy/desktop build`

  Run: `node scripts/check-desktop-command-surface.mjs --mode all`

  Expected: PASS；文本输出三个数量完全相等，`missingRegistrations/registeredOnly/bundleOnly/sourceNotBundled` 全为空。

- [ ] **Step 5: 提交 bundle 门禁**

  ```bash
  git add apps/desktop/package.json scripts/check-desktop-command-surface.mjs scripts/desktop-command-surface.test.mjs
  git commit -m "build: enforce bundled desktop command contract"
  ```

### Task 11: 同步实现文档、OpenSpec 证据与 CodeGraph

- [ ] Task 11 完成：实现文档、OpenSpec 证据与 CodeGraph 完成同步

**Files:**
- Modify: `docs/internal/implementation-inventory.md`
- Modify: `docs/current-state.md`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/tasks.md`

**Interfaces:**
- Consumes: 最终 CLI JSON、`git diff --stat base-ref`、测试结果与 CodeGraph 状态。
- Produces: 新会话能从稳定文档定位最终生产命令入口、门禁位置、保留迁移债务和自动验证证据；不复制整张调用图到长期文档。

- [ ] **Step 1: 运行文档事实采集**

  Run: `node scripts/check-desktop-command-surface.mjs --mode all --json`

  Run: `git diff --shortstat 24e0fc79f9bda0401362b4e93cb570774b4abfa8`

  Run: `pnpm codegraph:index`

  Run: `pnpm codegraph:sync`

  Run: `pnpm codegraph:status`

  Expected: 三集合相等；CodeGraph 无 pending/stale 文件。

- [ ] **Step 2: 更新实现证据索引**

  在 `docs/internal/implementation-inventory.md` 写入最终数量、`lib.rs` handler、`api.ts/api/` 客户端、静态门禁、bundle 门禁和仍保留的迁移/恢复入口；删除所有指向已退役命令的稳定入口描述。

- [ ] **Step 3: 更新当前状态但不升级验收**

  在 `docs/current-state.md` 添加带日期的自动审计事实、净删除规模和门禁结果；本机运行、更新、恢复仍为 `IMPLEMENTED_UNVERIFIED`，服务器正向主线仍保持原 `VERIFIED`，不把本次测试写成新用户验收。

- [ ] **Step 4: 完成矩阵并复核 OpenSpec 任务账本**

  矩阵记录最终三集合数量、每个命令的最终处置和验证命令；复核主协调会话已按各 Task 的审查结果增量勾选 `openspec/.../tasks.md` 1.1–4.3，发现不一致时只报告缺口，不由实现者修改复选框。4.4–4.5 留到 Task 12 验证后由主协调会话勾选。

- [ ] **Step 5: 运行文档 Green**

  Run: `pnpm check:project`

  Run: `openspec validate retire-legacy-desktop-command-surface --strict`

  Run: `git diff --check`

  Expected: PASS；长期文档没有复制 111 行矩阵，也没有新增用户验收声明。

- [ ] **Step 6: 提交文档和图谱同步**

  ```bash
  git add docs/internal/implementation-inventory.md docs/current-state.md openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md openspec/changes/retire-legacy-desktop-command-surface/tasks.md .codegraph
  git commit -m "docs: record the supported desktop command surface"
  ```

  若 `.codegraph` 为忽略的本地索引且 `git status --short .codegraph` 无输出，则不要强制添加；只提交文档并保留 `pnpm codegraph:status` 证据。

### Task 12: 完整门禁、签名 macOS `.app` 与最终证据

- [ ] Task 12 完成：完整门禁、签名 `.app` 与最终证据通过验收

**Files:**
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md`
- Modify: `openspec/changes/retire-legacy-desktop-command-surface/tasks.md`
- Modify: `docs/current-state.md`

**Interfaces:**
- Consumes: Tasks 1–11 的最终代码、矩阵、门禁和文档。
- Produces: 全量验证记录、签名 Apple Silicon `.app` 路径、启动/基本烟测结果；不执行正式发布。

- [ ] **Step 1: 运行最终静态与安全门禁**

  Run: `pnpm check:project`

  Run: `pnpm check:secrets`

  Run: `openspec validate retire-legacy-desktop-command-surface --strict`

  Run: `node --test scripts/desktop-command-surface.test.mjs`

  Expected: 全部 PASS。

- [ ] **Step 2: 运行完整工程回归**

  Run: `pnpm check`

  Expected: Rust、TypeScript、Workspace、Vitest、Vite、站点构建、格式和 clippy 全部 PASS；桌面 build 内部再次证明三集合相等。

- [ ] **Step 3: 复核 CodeGraph 与工作树质量**

  Run: `pnpm codegraph:index && pnpm codegraph:sync && pnpm codegraph:status`

  Run: `git diff --check`

  Run: `git status --short`

  Expected: CodeGraph 最新；除本 change 的预期修改外没有无关文件。

- [ ] **Step 4: 构建签名 `.app`**

  Run: `pnpm tauri:build:app`

  Expected: 生成当前 macOS Apple Silicon `.app`，使用稳定 Apple Development 身份签名；不生成 DMG、不改版本号。

- [ ] **Step 5: 验证签名、启动和主线基本能力**

  对构建脚本输出的精确 `.app` 路径运行：

  ```bash
  codesign --verify --deep --strict --verbose=2 "<build 输出的 .app 绝对路径>"
  open "<build 输出的 .app 绝对路径>"
  ```

  在应用中完成无副作用烟测：启动“我的部署”；系统文件夹选择器能打开并取消；外部准备链接能打开；复制按钮写入剪贴板；已有部署列表和详情能恢复；本机/服务器当前主线入口不报“command not found”。不连接新 Provider、不修改服务器资源。

- [ ] **Step 6: 回写最终验证证据**

  将实际最终命令数、删除 endpoint/依赖数量、全量门禁时间、CodeGraph 状态、`.app` 绝对路径、codesign 和烟测结果写入矩阵与 `docs/current-state.md`；向主协调会话提供勾选 OpenSpec tasks 4.4、4.5 所需证据，不由实现者修改复选框。只记录自动证据与本次烟测，不新增 `VERIFIED` 能力。

- [ ] **Step 7: 最终再验证文档改动**

  Run: `pnpm check:project && pnpm check:secrets && openspec validate retire-legacy-desktop-command-surface --strict && git diff --check`

  Expected: PASS。

- [ ] **Step 8: 提交最终证据**

  ```bash
  git add openspec/changes/retire-legacy-desktop-command-surface/evidence/command-surface-matrix.md openspec/changes/retire-legacy-desktop-command-surface/tasks.md docs/current-state.md
  git commit -m "test: verify desktop command surface cleanup"
  ```

## 完成检查

- [ ] 三集合严格相等，动态调用为零，矩阵无空 decision/rationale。
- [ ] 旧 endpoint 的专属实现、测试、依赖和权限已删除；共享内核、迁移和恢复能力有明确调用/测试证据。
- [ ] `lib.rs`、`api.ts` 和相关迁移文件相对 base-ref 净缩小，没有用新大型文件转移旧代码。
- [ ] 本机、服务器、更新、恢复、失败保留在线版本和重启恢复回归通过。
- [ ] 实现索引、当前状态、OpenSpec 任务和 CodeGraph 与最终代码一致。
- [ ] 完整门禁、签名 `.app`、启动与基本烟测通过，且没有版本、标签、Release、DMG 或官网分发副作用。
