# ABCDeploy 开发约定

## 一分钟冷启动

1. 先读 `docs/README.md`，确认问题域权威和阅读边界。
2. 再读 `docs/current-state.md`，确认 VERIFIED、未验证实现、NEXT 和禁区。
3. 只按任务需要读取产品契约、架构或实现清单，不默认遍历历史原型。
4. 检查 active OpenSpec/Comet change；存在时从仓库状态恢复，不从聊天摘要重建需求。
5. 修改代码前用 CodeGraph 查询定义、调用者和影响范围。

### 事实冲突与维护触发器

- 用户验收更新 `docs/current-state.md`；产品规则更新 `docs/product-contract.md`。
- 代码入口改变时更新 `docs/internal/implementation-inventory.md` 并同步 CodeGraph。
- 归档 change 前同步 `docs/current-state.md` 的状态和验证证据。

## 工程质量底线

- 开始修改前阅读 `docs/README.md`、`docs/product-contract.md` 和 `docs/architecture.md`。
- 优先通过 CodeGraph 查询定义、调用者和影响范围，不凭文件名猜测。
- 新代码按 Feature、应用服务、仓储和 Provider 边界归位，不继续向 `App.tsx`、`api.ts`、Tauri `lib.rs` 或 `workspace.rs` 堆积。
- 生产 TypeScript/TSX 和 Rust 文件默认不超过 800/1200 行；现有例外只能缩小。
- 修复问题先增加能复现的测试；不得删除有效断言换取通过。
- 用户可见成功必须来自可验证事实；错误必须说明发生了什么、保留了什么和下一步。
- 新增依赖前证明标准库、现有 UI 基础组件或既有模块无法覆盖，并清理不再使用的依赖。
- 完成修改后至少运行 `pnpm check:project`、`pnpm check:secrets` 和受影响测试；跨层修改运行完整门禁并同步 CodeGraph。

## 当前阶段：本地快速迭代

除非用户明确提出“正式发布”，否则默认执行以下规则：

- 不修改应用版本号。
- 不创建或推送 Git 标签。
- 不触发 GitHub Release，不生成全平台安装包。
- 不发布或替换官网的下载文件和 `latest.json`。
- 不等待与当前开发任务无关的远端 CI、构建或安装包任务。
- 只运行与改动相关的本地测试；桌面运行时改动优先验证当前 macOS Apple Silicon 开发机。
- 每次功能完成并通过本地验收后，生成当前 macOS Apple Silicon 的 `.app` 测试包，方便用户立即接续验收。
- `.app` 测试包属于本地验收产物，不修改版本号、不生成 DMG，也不触发远端构建或正式发布流程。
- 本机测试包统一运行 `pnpm tauri:build:app`，使用稳定的 Apple Development 身份签名，避免每次构建后重复出现 macOS 文件和钥匙串授权。

历史预览版继续承担下载页和安装流程试用。日常功能完成不等于对外发布新版本。

## 正式发布门禁

只有用户明确提出“正式发布”后，才执行完整发布流程：

1. 确认发布范围和版本号。
2. 运行完整本地测试与发布检查。
3. 提交发布改动并创建版本标签。
4. 构建 Windows x64、macOS Apple Silicon、macOS Intel 和 Linux x64 安装包。
5. 验证安装包、签名状态、校验值与下载清单。
6. 经用户确认后更新官网分发文件。
