# Brainstorm Summary

- Change: `retire-legacy-desktop-command-surface`
- Date: 2026-08-02
- Language: `zh-CN`

## 已确认事实

- 当前 `generate_handler!` 注册 111 个 Tauri 命令。
- 68 个非测试 TypeScript/TSX 文件中存在 56 个静态 `invoke` 命令名，未发现动态拼接命令名；因此 55 个注册命令连 TypeScript 命令包装都没有。
- 当前 Vite 生产构建最终只保留 46 个命令字符串：56 个源码包装中有 10 个被 tree-shaking 删除；因此至少 65 个注册 endpoint 不进入生产 bundle。
- 46 个 bundle 命令仍是上限：例如 `check_registry_credentials` 仅出现在浏览器回退分支，Tauri 产品路径是否真正可达仍需在证据矩阵中复核；预计最终受支持命令约为 45–46 个。
- Rust clippy、TypeScript 未使用检查和完整 `pnpm check` 当前通过，说明普通编译器检查不足以识别动态注册面和公开导出冗余。
- `WorkspaceState` 迁移、旧记录恢复及当前 deployment-path 执行内核仍被生产主线复用，不能根据 `legacy` 命名或文件位置删除。
- 本 change 只退役不可达命令面及其专属实现；大规模模块迁移、产品行为变化和仓库 URL 来源均不在范围内。
- GitHub 历史共有 5 个公开预览 Release；资产只有桌面安装包、校验值和 `latest.json`，Release 文案只描述最终用户产品流程，没有 SDK、插件或 IPC 接口承诺。
- 五个发布标签的 Tauri 配置都使用打包的本地 `frontendDist`、`default-src 'self'` CSP 和仅绑定 `main` 窗口的本地 capability；未配置 remote capability、`dangerousRemoteDomainIpcAccess`、`withGlobalTauri` 或 `__TAURI__` 全局接口。
- Git 历史、当前文档、Release、Issue/PR 和全局 GitHub 代码搜索均未发现第三方脚本或插件调用旧命令的证据；仓库当前无 fork、star 或外部 issue，公开 PR 仅来自仓库所有者和 Dependabot。
- 上述证据不能证明从未有人逆向调用安装包内部 IPC，但可以证明项目从未发布或承诺这些命令是外部兼容 API。

## 待确认

- 用户已确认：当前随应用打包的前端是唯一受支持消费者；未公开的内部 Tauri 命令不承担外部兼容承诺。
- 用户已确认采用“生产命令契约 + 证据矩阵驱动删除”。

## 候选方案

- **已采用**：生产命令契约 + 证据矩阵驱动删除。沿 Feature 消费者 → TypeScript 包装 → Tauri 注册 → Rust 实现裁决；内部仍复用的函数只移除 IPC 属性/注册，专属实现再向内清理。
- 已拒绝“只删除 55 个零包装命令”：会保留只有测试或未使用导出的第二层冗余。
- 已拒绝“整簇替换旧工作流”：与后续架构 change 重叠，误伤当前服务器主线和旧数据恢复的风险过高。

## 已确认设计：命令契约与删除边界

- Rust 注册、生产源码静态 `invoke` 和 Vite 最终 bundle 三个命令集合在完成后必须严格相等。
- 不保留历史兼容命令允许清单；没有生产消费者的 endpoint 取消注册并移除 `#[tauri::command]`。
- 内部仍被当前主线、数据迁移或恢复复用的函数降为普通内部函数；只有专属实现继续向内删除。
- 逐命令证据矩阵作为本 change 的可归档证据，长期实现文档只保存稳定入口和最终数量。
- 快速项目门禁检查静态命令与注册集合并拒绝动态命令名；生产构建后再用 bundle 集合捕获 tree-shaken 的未使用包装。
- 用户已确认这一部分设计正确。

## 已确认设计：分批删除与安全回退

- 按“前端空壳 → 孤立命令 → 共享内核命令 → 数据与迁移命令”四批删除，每批独立验证和记录证据。
- 前端空壳只删除无 Feature 消费者的包装、测试与依赖，不删除本机基础设施内部使用的配置仓储。
- 共享内核先移除 IPC 适配器；当前服务器部署、更新或恢复仍复用的内部执行器和错误映射继续保留，本轮不做模块迁移。
- 数据命令与 Workspace 数据能力分开裁决；旧数据升级、恢复和事务测试仍需要的方法不删除。
- 隐藏依赖按 Feature 消费、Rust 内部复用、旧数据职责三类归位，不因为内部依赖恢复无消费者 IPC。
- 用户已确认这一部分设计正确。

## 测试策略候选

- 在快速项目门禁中比较 Rust 注册集合与生产源码静态 `invoke` 集合，并拒绝动态命令名。
- 在生产构建后比较最终 bundle 命令字符串与 Rust 注册集合，阻止只有未使用导出/测试包装的命令继续注册。
- 对每个删除簇运行命令边界、Workspace 迁移、当前部署主线和完整项目门禁。
- 保留所有证明旧数据恢复和当前在线版本不变量的测试；只删除纯粹验证已退役公开入口的测试。

## 已确认设计：测试、门禁与完成标准

- 新解析器先用独立夹具覆盖多行泛型 `invoke`、动态命令拒绝、Rust handler 和生产 bundle 字符串提取；再对当前仓库准确报告 111/56/46 差异。
- 完成后 Rust 注册、生产源码静态命令和 Vite 最终 bundle 三个集合必须严格相等，不允许测试专用、未使用导出或动态命令继续注册。
- 四个删除批次分别运行前端、Tauri/Rust、Workspace 数据兼容和当前部署主线测试；有效内部行为断言迁到合适层级，只删除旧 endpoint 存在性断言。
- 最终运行项目/密钥/OpenSpec/完整工程门禁，重建 CodeGraph，记录净删除规模，并生成签名 macOS Apple Silicon `.app` 做启动与主线基本烟测。
- 不修改版本号、不触发正式发布，也不在本 change 中升级任何用户能力为 `VERIFIED`。
- 用户已确认完整设计，并同意回写“源码包装未进入 Tauri 生产路径时不构成生产消费者”的 Spec Patch。

## Spec Patch

- 已确认：补充“源码中存在 `invoke` 包装但被生产 bundle tree-shaking 删除，或只存在于非 Tauri 回退分支时，不能单独视为生产消费者”的验收场景。
