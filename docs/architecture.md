# ABCDeploy 工程架构

> 本文定义代码应该如何承载 MVP。产品语义以 [产品合同](product-contract.md) 为准；本文描述目标结构，不用现有目录反推产品。

## 1. 架构目标

ABCDeploy 是本地优先的部署控制面。架构必须保证：

- 用户只需要理解项目来源、运行位置、待办和结果；
- Provider 可以替换，产品模型不随具体平台或云厂商变化；
- 系统自动动作和用户待办严格区分；
- 每次部署输入固定、可恢复、可追溯；
- 用户可见成功由实时证据证明；
- 秘密值只在最小可信边界流动；
- 新贡献者和 AI 可以按稳定对象定位修改范围。

## 2. 核心领域对象

### 候选对象

页面填写阶段先保存草稿，不把“尚未验证”伪装成稳定事实：

```text
ProjectSourceCandidate
  LocalFolderCandidate(path + discoverySnapshotId?)
  RepositoryCandidate(repositoryUrl)

EnvironmentCandidate
  LocalEnvironmentCandidate
  SavedServerCandidate(serverConnectionRef)
  NewServerCandidate(adapterId + connectionInput + ephemeralCredentialHandles[])
```

空值或明显错误的仓库地址属于字段校验，不创建候选对象；格式正确但读取失败、私有仓库未授权等问题进入 `ActionChecklist`。新服务器候选只保存适配器声明允许持久化的非秘密输入；`ephemeralCredentialHandles` 只指向当前进程内的临时秘密，不进入仓储、前端快照或日志，关闭页面或取消连接即销毁。连接字段、目标身份证据和确认方式均由服务器适配器描述，领域层不假设某种协议或凭据形式。

### `ProjectSource`

```text
LocalFolderSource
  path + inferredName + displayName? + immutableContentSnapshotId

RepositorySource
  repositoryUrl + inferredName + displayName? + defaultBranch + commitSha + credentialRef?
```

它只回答“部署哪份代码”。选择本地文件夹时先生成可更新的发现快照；点击运行/上线前重新计算内容身份，有变化就让旧检查失效并重新扫描，最终生成包含未提交修改的不可变快照。仓库来源每次运行前重新解析默认分支，并把具体 Commit 固定为最终源码身份。

`inferredName` 只由本地根文件夹名或仓库路径最后一段确定，仓库名移除 `.git` 后缀；`displayName` 仅在用户主动重命名后存在。二者都不是对象主键，也不参与内容快照、仓库 Commit、运行位置、访问地址或部署更新判断。领域层不得从项目内容猜测业务名称。

MVP 默认不向源码目录写文件。仓库副本、生成文件和运行配置全部进入 ABCDeploy 管理目录。

### `DeploymentEnvironment`

```text
LocalEnvironment
  runtimeProfile + managedDirectory

ServerEnvironment
  verifiedServerConnectionRef
```

它只回答“运行在哪里”。可复用服务器 `Connection` 保存适配器标识、经过验证的连接事实、能力档案和系统密钥库中的秘密引用；秘密正文、运行工具、路由实现和项目访问地址不进入该对象。项目访问地址属于具体部署记录的 `AccessEndpoint`。

`resolveDeploymentEnvironment` 调用适配器完成无副作用校验、必要的用户确认、认证和支持性探测；确认方式由适配器能力描述决定，不能由 UI 猜测。通过支持矩阵后才建立并验证可复用安全连接，随后清除临时凭据并保存稳定 `Connection`。不支持的环境必须在首次写入前返回结构化结果。

稳定 `Connection` 保存的是可再次验证的连接材料和上次证据，不是永久“已验证”标记。服务器重装、主机身份变化、受管密钥失效或证据过期后进入可恢复状态：`verifyServerConnection` 负责无副作用检查，`repairServerConnection` 只收集临时凭据并更新稳定连接，成功后由 `resumeDeploymentReadiness` 从原部署上下文继续。

服务器运行环境与连接授权分属两个事实。`evaluateServerRuntime` 返回结构化能力事实；`prepareServerRuntime` 幂等安装或启动可安全代办的容器运行工具、编排能力、受管目录与统一路由。它必须先探测既有环境、保留未知配置、记录实际修改并允许中断后重试。

准备运行工具时，服务器适配器可以结合可信本机事实和运行位置元数据排列软件下载来源，但识别结果不能代替实际可用性验证。系统必须验证来源完整性、系统版本、架构和所需能力，失败后自动切换可信后备来源。它只维护独立的受管配置，不覆盖系统主配置、已有可用运行环境或项目版本存储连接。

### `ActionChecklist`

它贯穿部署前准备和部署后验证，整体保存：

```text
phase: readiness | verification
state: idle | scanning | blocked | ready | check_failed
revision
items[]
```

每项必须保存：

- 稳定类型和身份；
- 用户可读标题与原因；
- `待处理`、`检查中`、`已完成` 或 `仍有问题`；
- 处理入口；
- 验证器和最近验证结果；
- 与来源、环境或配置的失效关系。

只有当前 revision 的所有必要检查器完成、整体状态为 `ready` 时，主操作才可用。部署后访问验证形成 `verification` 待办；修复后只恢复验证，不重新构建已经固定的版本。

### `DeploymentRun`

保存一次固定输入的执行：

- 来源快照；
- 运行位置快照；
- 配置引用；
- 当前尝试和状态；
- 可恢复位置；
- 生成版本引用；
- 最终结果引用。

重试新增 Attempt，不改写原输入。

### `DeploymentEvidence`

聚合源码、运行版本、服务健康和访问结果。每条证据包含：

- 检查类型；
- 预期值；
- 实际值；
- 检查位置；
- 时间；
- 连续通过次数；
- 原始技术证据引用。

### `AccessEndpoint`

每个需要公开访问的服务拥有一个地址记录：

```text
deploymentRunRef + serviceRef + url + isPrimary
dnsEvidence? + tlsEvidence? + requestEvidence?
```

内部依赖没有公开地址。服务器适配器能够安全提供临时访问地址时，系统可以自动准备并验证；具体生成方式不进入产品模型。用户改用自有域名后才产生相应的解析与安全访问检查。多个公开服务分别验证，并指定一个主地址供首页展示。

公网验证若返回稳定的域名策略限制，控制面将 `requires-registered-domain` 写入对应服务器 `Connection` 的能力档案。部署准备读取该事实并禁用临时域名草稿，直接生成逐公开服务的地址待办。这里复用的是服务器能力，不是 `AccessEndpoint`；实际域名、主地址和验证证据仍按部署记录隔离。纯地址修复只更新路由并重新验证，不重新构建镜像或重启健康服务。

`Release`、`Artifact`、`Connection`、`Provider` 和内部阶段继续存在，但只服务上述用户对象。

MVP 来源解析只接受至少包含一个 HTTP 可访问服务的项目。纯 CLI、Worker 和定时任务返回明确的“不受当前版本支持”，不进入无法产生访问证据的运行任务。

## 3. 状态机

```text
选择项目候选
  ↓ 解析成功
选择运行位置候选
  ↓ 验证成功
scanning
  ├─ blocked → 处理全部用户待办 → scanning
  ├─ check_failed → 重试系统准备
  └─ ready → 运行/上线
                 ↓
               执行中
                 ↓
               验证中
        ┌────────┴────────┐
      成功          verification blocked / 执行失败
                         ↓
                 处理后仅恢复相应阶段
```

不变量：

- 待办通过只允许开始，不能产生成功；
- 检查进行中或系统检查失败时，即使待办数量暂时为 0，主按钮也不能可用；
- 来源、版本或环境改变后，相关检查与证据失效；
- 命令退出 0、构建成功和容器启动均不是最终成功；
- 服务器服务运行但公网失败是独立状态；
- 客户端重启从持久化事实恢复，不从 UI 缓存猜测。

## 4. 分层与依赖方向

```text
React 视图与纯投影
  ↓ 只依赖类型化用例 API
Tauri 命令适配层
  ↓
应用服务
  ├─ SourceAnalysisService
  ├─ ActionChecklistService
  ├─ DeploymentService
  └─ VerificationService
  ↓
领域模型与仓储端口
  ↓
Provider 与基础设施适配器
  ├─ 本地文件/Git/进程/容器
  ├─ 系统密钥库/SQLite
  ├─ 代码托管/构建/不可变版本存储
  └─ 远程连接/运行环境/路由/DNS/HTTP
```

依赖只能向下：

- 领域层不得依赖 React、Tauri 或具体 UI 文案；
- React 不得直接 `invoke`、访问 SQLite、拼 shell 或判断 Provider 错误；
- 应用服务编排用例，不内嵌具体 Provider 请求和 shell 文本；
- Provider 返回结构化事实和错误，不返回决定用户页面的 HTML 或文案。

## 5. 应用用例

MVP 用例固定为：

1. `selectProjectSourceCandidate`：选择本地文件夹或接收格式有效的仓库 URL；
2. `resolveProjectSource`：读取候选并生成稳定源码身份；
3. `selectEnvironmentCandidate`：选择本机、已验证服务器或新服务器草稿；
4. `resolveDeploymentEnvironment`：验证运行位置并生成稳定环境；
5. `evaluateActions`：并发执行当前 revision 的检查，生成完整待办或系统失败；
6. `resolveActionItem`：接收用户输入，验证后更新待办；
7. `startDeployment`：重新确认源码身份、固定输入并创建任务；
8. `resumeDeployment`：恢复任务或开始新尝试；
9. `verifyDeployment`：收集并聚合成功证据；
10. `verifyServerConnection`：重新验证保存服务器的身份、网络和授权；
11. `repairServerConnection`：使用临时凭据恢复受管安全连接；
12. `evaluateServerRuntime`：生成服务器运行环境的结构化事实；
13. `prepareServerRuntime`：幂等准备系统能够安全代办的运行环境；
14. `resumeDeploymentReadiness`：从连接或环境失败处恢复同一部署检查；
15. `removeDeploymentRecord`：只移除项目级本地部署状态，保留源码、远端服务和公共连接；
16. `getDeploymentProjection`：投影页面状态与唯一主操作。

处理授权、连接服务器和补配置后回到 `evaluateActions`；处理 DNS、TLS 或公网访问后回到 `verifyDeployment`。后置验证不得重新构建相同版本。

## 6. 前端目录边界

当前结构：

```text
apps/desktop/src/
├── App.tsx                      # 只负责首页/编辑器装配
├── features/
│   ├── deployment-list/         # 我的部署
│   ├── deployment-editor/       # 单页来源、环境、待办与结果容器
│   ├── action-checklist/        # 准备与验证阶段的完整待办
│   ├── deployment-evidence/     # 成功门禁和证据展示
│   └── deployment-path/         # 旧记录的纯兼容投影，不承载页面
├── api/                         # 已拆出的类型化 Tauri 客户端
├── api.ts                       # 迁移期门面，只允许持续缩小
├── components/                  # 仍在主线复用的组合组件
├── components/ui/               # 无业务语义的通用组件
├── lib/                         # 小型纯函数
└── types.ts                     # 兼容入口；新类型靠近领域
```

规则：

- Feature 可以依赖 `api`、`components/ui` 和 `lib`，不能反向依赖；
- 通用 UI 不导入业务类型或 Tauri API；
- 页面状态、主按钮和成功文案由纯投影函数生成；
- `api` 只处理参数、返回值、兼容反序列化和错误归一化；
- Provider 术语只进入授权辅助说明或技术详情；
- 新页面必须直接承载产品合同中的来源、运行位置、待办、任务或证据，不建立并行交互模型；
- 新代码必须进入与领域对象对应的 Feature 或服务边界，不向应用装配入口堆积业务逻辑；
- `api.ts`、`types.ts` 和兼容目录是收缩中的迁移边界，不得新增与既有模块无关的职责。

## 7. Rust 目录边界

目标结构：

```text
commands/         # 边界校验并调用应用服务
application/      # 来源、待办、部署与验证用例
infrastructure/   # 密钥库、进程、网络和文件适配器
workspace/        # 按聚合拆分的仓储
```

领域内核保持领域、扫描、计划、渲染和 Provider 边界。SQL、外部请求、命令生成和用户文案不得混在同一函数。

## 8. 待办生成架构

检查器返回两类结果：

```text
AutomaticAction
  系统可安全自动执行，可重试并记录结果

UserRequiredAction
  必须由用户输入、授权、选择或完成外部操作
```

只有 `UserRequiredAction` 进入用户待办。待办标识必须稳定，刷新时更新同一项而不是不断新增。处理器只接收该待办需要的最小输入，验证通过后才写完成状态。

检查器按依赖并发执行；所有必要检查器进入终态后，整体状态才能从 `scanning` 变为 `blocked` 或 `ready`。私有仓库授权、主机身份确认等信息屏障可能让后续检查暂时不可执行；屏障解除后必须创建新的 revision、完整重扫，并一次投影该 revision 的全部已知待办。不得把同一 revision 已知的问题逐项串行解锁。自动动作失败写入 `check_failed`，页面显示“系统准备失败”、保留事实、重试和技术详情，不能伪造一条让用户点击完成的待办。

## 9. 成功验证架构

验证器按环境实现同一端口：

```text
LocalDeploymentVerifier
ServerDeploymentVerifier
```

两者都必须验证：

- 来源身份；
- 实际运行身份；
- 全部必要内部服务和依赖；
- 每个公开服务的用户访问视角。

服务器额外验证适配器提供的不可变运行身份、访问路由和外部请求；自有域名还验证 DNS/TLS。本机额外验证进程、监听端口和本机地址。

关键检查必须连续通过 3 次，相邻间隔至少 5 秒，总窗口至少 10 秒。成功证据的当前有效期为 5 分钟；过期后投影为“上次验证通过 · 待复查”，打开已有部署或客户端重启时自动重新验证。离线时只保留历史事实与时间，不能继续显示当前绿色成功。

证据聚合器负责连续检查、新鲜度和最终等级。UI 只读取聚合后的事实，不能在组件中自行推导成功。

首页列表、部署编辑器和成功结果都由同一组 `DeploymentRun + DeploymentEvidence + AccessEndpoint` 投影。应用加载时同时读取运行中、需处理和最近成功记录；任务转为终态后立即刷新投影。打开已有服务器部署时，应用按最近成功运行定位唯一部署路径和服务器连接，恢复只读结果，再以后台复查更新证据新鲜度。无法唯一匹配时不得猜测线路。

`AccessEndpoint.isPrimary` 是打开动作的唯一依据；旧数据没有该字段时，由公开服务声明和稳定服务名规则生成兼容投影。运行版本摘要与逐服务摘要属于同一证据对象，默认折叠详情不会改变成功门禁。

## 10. 状态与副作用

- 一个用户动作对应一个明确应用用例；
- 首次上线与已有部署维护复用同一个部署设置组件，但由显式模式隔离副作用：`initial` 只投影缺项，保存后创建新的 readiness revision，全部就绪才恢复同一部署任务；`settings` 以 `部署资源 → 访问地址` 两步投影完整线路，最终保存只持久化下一次更新使用的配置并刷新摘要，禁止派发构建、部署、重启命令或修改当前在线事实；
- 两种模式始终展示同一个两步进度头。`initial` 明示 `首次上线设置 / 只显示当前需要你确认的内容`，`settings` 明示 `与首次上线共用同一套设置 / 保存后用于下次上线`；情境标题可以随当前待办变化，但步骤、字段定义、校验能力和持久化目标必须保持一致；
- `UpdateDeployment` 先锁定新的源码快照并与当前在线源码身份比较；没有变化时返回无操作结果，不创建 `DeploymentRun`，有变化时才复用已保存的部署设置创建新尝试；
- `RestoreDeploymentVersion` 只接受同一项目与服务器历史中已经验证成功、且不可变运行版本仍可取得的记录；恢复必须创建新的 `DeploymentRun`，不能改写原记录；
- `DeploymentRun` 与验证证据采用追加写入，`CurrentDeployment` 只保存最近一次验证成功记录的指针。更新或恢复失败只追加失败事实，不移动当前指针；
- 项目与服务器组成部署目标锁。首次上线、更新和恢复共用该锁，同一目标不能并发执行两个会改变线上状态的任务；
- 配置事实、任务、尝试、版本、证据和当前指针分开保存；
- 副作用必须幂等或拥有幂等键；
- 受管文件与路由写入遵循候选、验证、备份、原子替换和恢复；
- 一次性连接凭据只在首次引导期间存在内存并及时清除；需要长期复用的秘密正文进入系统密钥库，普通记录只保存秘密引用；
- 首次缺少 Provider 连接时，应用服务负责验证凭据、写入系统密钥库、保存可复用连接并更新项目级非秘密地址；Provider 提供幂等资源接口时同一用例自动确保项目资源存在；这些动作全部成功后才重新计算 readiness revision，任何秘密不得进入项目 Manifest；
- 连接凭据与云厂商资源管理凭据必须分开建模。适配器只有登录材料时不能假装创建平台实例或命名空间；应用隐藏固定地址，建议并保存共享命名空间，在首次缺少平台资源时执行可恢复的控制台交接。登录验证成功后，后续项目复用连接和命名空间，具体版本仓库由推送按服务产生；
- 版本仓库连接的 `ready` 不能只表示登录成功。首次保存和每次复用到新项目时，Provider 必须用目标命名空间执行无制品副作用的写权限探测；只有登录身份、目标命名空间和推送权限同时成立，连接才可进入构建。失效时回到版本仓库授权待办，不创建新的构建任务；
- 服务器部署的第二段在领域上分为“生成运行版本”和“保存运行版本”。前者由构建服务产出镜像，后者把镜像写入版本仓库。界面必须按真实后台阶段分别展示；保存失败时保留已生成镜像和源码快照，更新授权后只恢复上传，不把整个阶段含糊显示为“准备运行版本”；
- 远端最终版本使用适配器可验证的不可变身份；
- 并发任务使用数据库约束和目标锁，不能只依赖按钮禁用。

## 11. 模块尺寸与质量

`scripts/check-project-quality.mjs` 默认限制：

- 生产 TypeScript/TSX：800 行；
- TypeScript/TSX 测试：1,200 行；
- Rust：1,200 行；
- CSS：1,200 行。

现有超限文件使用棘轮预算，只能缩小。禁止通过压缩格式或无意义包装绕过门禁。

## 12. 测试策略

- 领域纯函数：状态机、失效规则、待办合并、证据聚合和主操作投影；
- React Feature：按用户可见行为测试四种组合和完整待办；
- Tauri 命令：边界、脱敏和应用服务调用；
- Workspace：临时 SQLite 验证约束、事务、迁移和重启恢复；
- Provider：匿名化夹具，不连接个人账号或生产服务；
- 端到端：本机、服务器、证据不足、重试与旧版本保留；
- 页面合同：单页结构、按钮门禁和成功证据。

修复缺陷先添加能复现的测试，不删除有效断言换取通过。
