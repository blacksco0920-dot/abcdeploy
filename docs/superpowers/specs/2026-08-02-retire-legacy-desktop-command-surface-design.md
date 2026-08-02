---
comet_change: retire-legacy-desktop-command-surface
role: technical-design
canonical_spec: openspec
---

# 退役旧桌面命令面：深度技术设计

## 1. 摘要

本变更以当前随应用打包的前端为唯一受支持的 Tauri IPC 消费者，建立“Feature 消费者 → TypeScript 包装 → 生产 bundle → Rust handler → 内部实现”的可审计链路。没有生产消费者的 endpoint 将被取消注册并移除 `#[tauri::command]`；仍被当前部署主线、数据库迁移或恢复逻辑复用的函数降为普通内部函数，只有专属于退役入口的实现继续向内删除。

完成后，Rust 注册命令、生产源码静态 `invoke` 命令和 Vite 最终 bundle 命令三个集合必须严格相等。当前审计基线分别是 111、56 和 46；预计最终保留约 45–46 个命令，精确数量由逐命令证据矩阵决定，不预先按目标数字删除。

## 2. 背景与证据

### 2.1 当前命令面

- `apps/desktop/src-tauri/src/lib.rs` 的 `generate_handler!` 注册 111 个命令。
- 68 个非测试 TypeScript/TSX 文件中存在 56 个静态命令字符串，没有动态拼接的 `invoke`。
- 当前 Vite 生产构建只保留 46 个命令字符串；10 个源码包装因没有生产消费者被 tree-shaking 删除。
- 至少 65 个注册 endpoint 不进入最终生产 bundle。
- `check_registry_credentials` 等少量 bundle 命令仍可能只存在于浏览器回退分支，因此 bundle 集合仍是生产 Tauri 消费者上限。

Rust clippy、TypeScript 未使用检查和完整 `pnpm check` 当前均通过，因为动态注册的命令、公开导出和被测试引用的代码不会被普通 dead-code 检查判定为冗余。

### 2.2 外部兼容性审计

项目历史共有 5 个公开预览 Release。资产只有桌面安装包、校验值和 `latest.json`；Release 文案和仓库文档从未发布 SDK、插件或 IPC API。所有发布标签都使用本地 `frontendDist`、`default-src 'self'` CSP 和只绑定 `main` 窗口的本地 capability，未配置远程 IPC、`withGlobalTauri` 或全局 `__TAURI__` 接口。

Git 历史、GitHub Release、Issue、PR、fork 和代码搜索均没有第三方调用旧命令的证据。用户据此确认：当前随应用打包的前端是唯一受支持消费者，旧 Tauri 命令不承担外部兼容承诺。

### 2.3 必须保护的共享能力

`WorkspaceState` 的旧数据迁移、项目恢复、当前在线版本指针和 deployment-path 聚合仍被当前生产主线使用。`prepare_managed_server_deployment` 也会桥接到既有服务器部署执行内核。文件名、函数名或测试名中的 `legacy` 不是删除依据。

## 3. 目标与非目标

### 3.1 目标

- 删除没有当前产品消费者的 Tauri endpoint、前端包装和专属实现。
- 保留当前本机运行、服务器上线、更新、恢复、失败保留在线版本和旧数据恢复行为。
- 建立能够捕获动态注册冗余和测试专用导出的永久门禁。
- 净缩小 `lib.rs`、`api.ts` 及相邻迁移文件，不以纯移动伪造清理。
- 让实现证据索引和 CodeGraph 只指向当前生产主线。

### 3.2 非目标

- 不改变产品交互、部署状态机、数据库 schema 或 Provider 选择。
- 不实现仓库 URL 来源。
- 不在本变更中完成 commands/application/workspace 的大规模目录迁移；该工作属于后续 `converge-deployment-application-boundaries`。
- 不因自动测试或代码清理更新任何能力的 `VERIFIED` 状态。
- 不修改版本号或执行正式发布。

## 4. 命令契约模型

### 4.1 三个集合

命令面由三个独立可提取集合组成：

1. `registeredCommands`：从 Rust `tauri::generate_handler!` 宏提取的标识符。
2. `sourceCommands`：从非测试生产 TypeScript/TSX 中提取的静态 Tauri `invoke` 字符串。
3. `bundledCommands`：从 Vite 最终 JavaScript bundle 的字符串字面量中，与注册命令交集得到的命令集合。

完成条件：

```text
registeredCommands = sourceCommands = bundledCommands
```

生产源码出现非字符串字面量的动态命令名时直接失败。测试源码、历史原型和生成的 Tauri schema 不参与集合计算。

### 4.2 为什么同时检查源码和 bundle

只比较 Rust 与源码会把“存在包装但没有 Feature 消费者”的导出误判为有效；当前已有 10 个这样的命令。只比较 Rust 与 bundle 又会把错误推迟到完整生产构建。两级检查兼顾快速反馈和真实 tree-shaking 结果：

- `pnpm check:project` 执行静态检查，拒绝动态命令并比较注册集合与生产源码集合。
- 桌面生产构建完成后执行 bundle 检查，比较注册集合与最终 bundle 集合。

为了让静态集合也能相等，所有只有测试或回退分支使用的 Tauri 包装必须删除或拆成纯浏览器实现与真实 IPC 包装。浏览器回退需要的纯逻辑可以保留，但不能通过一个没有 Tauri Feature 消费者的 endpoint 包装间接保活。

### 4.3 检查器结构

新增独立脚本模块负责：

- 使用 TypeScript AST 识别从 `@tauri-apps/api/core` 导入的 `invoke` 绑定和调用；
- 支持多行调用、泛型返回类型和导入别名；
- 拒绝模板拼接、变量或函数计算得到的命令名；
- 从 `lib.rs` 的单一 `generate_handler!` 块提取注册标识符，并在缺失或存在多个无法判定的 handler 块时失败；
- 在 build 模式读取 `apps/desktop/dist/assets/*.js`，解析字符串字面量而不是做模糊子串判断；
- 输出缺失注册、无消费者注册、只在源码存在和只在 bundle 存在四类差异。

解析逻辑使用项目已有 Node.js 与 TypeScript 依赖，不新增第三方依赖。

## 5. 证据矩阵

本 change 保存一份可归档的逐命令矩阵，每行至少包含：

| 字段 | 含义 |
| --- | --- |
| command | Tauri 命令名 |
| feature consumer | 当前 Feature 或应用装配调用者 |
| TypeScript wrapper | 包装符号与文件 |
| production bundle | 是否进入最终 bundle |
| Rust internal callers | command 函数或内部实现的 Rust 调用者 |
| data/migration duty | 是否承担 schema 升级、旧记录读取或恢复职责 |
| tests | 当前行为、数据兼容或纯 endpoint 存在性测试 |
| decision | `keep-ipc`、`internalize` 或 `delete` |
| rationale | 处置依据与保留不变量 |

矩阵保存在当前 OpenSpec change 内并随归档保留，用于解释本次大规模删除。长期维护文档只保存稳定入口、最终数量和门禁位置，不复制完整调用图。

处置规则：

- `keep-ipc`：存在当前 Feature 消费者，且包装、bundle 与注册链完整。
- `internalize`：没有 IPC 消费者，但内部实现仍被当前主线或数据兼容路径复用；删除注册和 command 属性，保留普通函数或仓储方法。
- `delete`：没有生产消费者、内部调用或数据兼容职责；删除 endpoint、专属实现及仅为它存在的测试和依赖。

## 6. 分批实施

### 6.1 批次一：前端空壳

删除被生产 tree-shaking 移除的 Config Profile、Secret、Settings 再导出和 API 包装，并清理只验证这些公开包装的测试。配置 Profile 仓储仍被本机基础设施使用时继续保留。

同时审计前端依赖：只有确认生产源码、构建配置和 Tauri runtime 均不需要时才删除。浏览器原生 `navigator.clipboard` 与 Rust clipboard plugin 分开判断，不能只因 TypeScript 包未导入就同时移除 Tauri runtime 权限。

### 6.2 批次二：孤立命令

优先处理只有函数定义与 handler 注册引用的命令，包括旧预检、Manifest 预览/应用、项目步骤和部分 Provider 管理入口。删除 endpoint 后，通过 Rust 编译、clippy 和调用图识别专属类型、常量、导入与辅助函数。

### 6.3 批次三：共享内核命令

处理旧本机服务控制、staging/production、路由修复和外部同步命令。先删除 IPC 适配器；当前服务器部署、更新或恢复仍调用的 `*_inner`、执行器、Provider、错误映射与状态转换继续保留。本轮不为这些共享实现设计新目录。

### 6.4 批次四：数据与迁移命令

删除没有 UI 消费者的版本、环境、验证和配置 CRUD endpoint。Workspace 方法独立裁决：只要仍参与当前聚合、数据库升级、旧记录恢复或事务测试，就保留内部方法和数据行为测试。

### 6.5 每批固定闭环

```text
确认或补充保护测试
→ 删除命令边界
→ 编译器与调用图暴露专属代码
→ 删除专属实现
→ 运行该簇测试
→ 更新证据矩阵与数量
```

隐藏依赖不自动恢复旧 IPC：当前 Feature 需要时补齐完整生产调用证据；仅 Rust 内部需要时降为普通函数；仅旧数据需要时保留仓储或迁移实现；没有这些依据时继续删除。

## 7. 错误处理与安全边界

- 当前生产命令的参数、返回值、稳定错误代码和脱敏规则保持不变。
- 移除的命令不提供运行时兼容 fallback；任何当前 Feature 遗漏都会在静态集合、bundle 集合或 Feature 测试中失败，而不是在发布后静默降级。
- 秘密正文、Keychain、临时密码和 Provider 凭据行为不因命令退役而迁移或扩张。
- 删除命令过程中不更改 SQLite schema；Workspace 迁移失败或旧记录恢复测试失败时，该删除批次不得继续。
- 无法证明安全删除的共享实现可以保留为内部代码，但不能以“不确定”为理由继续暴露没有消费者的 IPC endpoint。

## 8. 测试策略

### 8.1 门禁的测试驱动开发

先为命令解析器建立独立夹具，覆盖：

- 单行和多行 `invoke`；
- `invoke<ResultType>` 泛型调用；
- 导入别名；
- 动态字符串、变量和模板拼接拒绝；
- Rust handler 提取与结构异常；
- 最终 bundle 字符串字面量提取；
- 集合差异分类与稳定排序输出。

随后对当前仓库运行新检查器，预期先得到 111/56/46 不一致；完成清理后再把检查接入常规门禁。

### 8.2 分批回归

- 前端空壳：TypeScript 严格未使用检查、API/Feature 单测与 Vite build。
- 孤立和共享命令：相关 Tauri/Rust 单测、`cargo clippy --workspace --all-targets -- -D warnings`。
- 数据与迁移：完整 Workspace 临时 SQLite 测试，重点覆盖 schema 升级、重启恢复、失败不移动当前在线版本、回退和项目重连。
- 当前用户路径：本地来源、本机运行、服务器上线、更新、恢复、证据投影和首页/详情回归。

旧 endpoint 测试如果仍保护有效内部行为，将断言迁到内部函数或仓储层；只有纯粹要求已退役 endpoint 存在的断言可以删除。

### 8.3 最终验证

- `pnpm check:project`
- `pnpm check:secrets`
- OpenSpec strict validation
- `pnpm check`
- CodeGraph 重建、同步与状态检查
- `pnpm tauri:build:app`
- 签名 `.app` 的启动和当前主线基本烟测

本地 `.app` 只用于当前 macOS Apple Silicon 验收，不修改版本号、不生成 DMG、不创建标签、不触发 GitHub Release 或官网分发。

## 9. 文档与资产更新

- `docs/internal/implementation-inventory.md` 更新实际 Tauri 主线入口、命令数量和仍保留的迁移债务。
- `docs/current-state.md` 只记录本次代码事实与自动验证，不升级用户验收状态。
- CodeGraph 在大规模删除后重新索引，确保文档中的稳定符号可查询。
- 当前 change 的证据矩阵记录每个命令的处置和验证；归档后作为历史审计保留。

## 10. 风险与缓解

- 动态调用未被识别：AST 检查拒绝非静态命令名，生产 bundle 再做第二层核对。
- tree-shaking 造成源码假消费者：注册、源码和 bundle 三集合必须相等。
- 测试保活旧接口：区分行为断言与 endpoint 存在性断言，有效行为迁到内部层。
- 共享内核误删：每项记录 Rust 调用者和数据职责，先 internalize 再判断实现删除。
- 迁移兼容回归：完整 Workspace 临时数据库测试是每个相关批次的硬门禁。
- 允许清单重新积累：本设计不设置历史兼容允许清单；新命令必须同时出现在三个集合。
- 删除与架构迁移混杂：共享实现只保留或删除，不在本 change 中迁移到新架构目录。

## 11. Spec Patch

OpenSpec delta spec 增加场景“源码包装没有进入 Tauri 生产路径”：被最终 bundle tree-shaking 移除，或只存在于非 Tauri 回退分支的 `invoke` 包装，不能单独证明 endpoint 具有生产消费者。

## 12. 完成定义

- 三个命令集合严格相等，且证据矩阵没有未裁决项。
- 当前部署用户路径、错误语义和数据恢复行为保持不变。
- 只服务退役入口的 endpoint、实现、测试、依赖和权限被删除。
- 超限迁移文件净缩小，没有复制或纯移动旧代码。
- 项目、密钥、OpenSpec、完整工程、CodeGraph 与 `.app` 验证全部通过。
- 文档准确记录自动证据，不宣称新增用户验收或正式发布。
