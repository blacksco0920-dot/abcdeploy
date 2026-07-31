import { describe, expect, it } from "vitest";
import type { DeploymentRun } from "../../types";
import { serverDeploymentRunView } from "./run-view";

function serverRun(overrides: Partial<DeploymentRun> = {}): DeploymentRun {
  return {
    id: "run-1",
    projectPath: "/projects/sample-store",
    projectName: "sample-store",
    environment: "deployment",
    status: "running",
    currentStage: "deploy",
    buildSerial: "cnb-build-42",
    commitSha: "3111dcaa1abf0000000000000000000000000000",
    sourceRunId: null,
    candidateTag: null,
    artifacts: [
      { service: "api", image: "registry.example/api", digest: "sha256:api" },
      { service: "web", image: "registry.example/web", digest: "sha256:web" },
    ],
    actionKind: null,
    actionUrl: null,
    issueCode: null,
    repository: "owner/sample-store",
    branch: "main",
    message: "版本已经安全保存，正在更新运行服务器",
    completedSteps: ["snapshot-source", "sync-source", "build", "registry"],
    startedAt: "2026-07-24T13:42:00.000Z",
    updatedAt: "2026-07-24T13:42:30.000Z",
    ...overrides,
  };
}

describe("serverDeploymentRunView", () => {
  it("把后台持久化阶段投影为可理解的进度、时间和部署详情", () => {
    const view = serverDeploymentRunView(
      serverRun(),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.state).toBe("running");
    expect(view.progress).toEqual(
      expect.objectContaining({
        completed: 2,
        total: 4,
        currentLabel: "启动服务",
        elapsedLabel: "已运行 1 分 30 秒",
        updatedLabel: "1 分钟前有新进展",
      }),
    );
    expect(view.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "running",
      "pending",
    ]);
    expect(view.details).toEqual(
      expect.arrayContaining([
        { label: "任务编号", value: "run-1" },
        { label: "构建编号", value: "cnb-build-42" },
        { label: "代码版本", value: "3111dcaa1abf" },
        { label: "已生成版本", value: "2 个服务镜像" },
      ]),
    );
  });

  it("明确区分生成镜像和上传版本仓库，避免第二步看起来卡住", () => {
    const building = serverDeploymentRunView(
      serverRun({
        currentStage: "build",
        message: "构建服务正在生成可运行版本",
        completedSteps: ["snapshot-source", "sync-source"],
        artifacts: [],
      }),
      Date.parse("2026-07-24T13:42:10.000Z"),
    );
    const uploading = serverDeploymentRunView(
      serverRun({
        currentStage: "registry",
        message: "可运行版本已经生成，正在保存到版本仓库",
        completedSteps: ["snapshot-source", "sync-source", "build"],
      }),
      Date.parse("2026-07-24T13:42:10.000Z"),
    );

    expect(building.progress?.currentLabel).toBe("生成运行版本");
    expect(building.steps[1]?.detail).toBe("构建服务正在生成服务镜像");
    expect(uploading.progress?.currentLabel).toBe("保存运行版本");
    expect(uploading.steps[1]?.detail).toBe(
      "正在把 2 个服务镜像上传到版本仓库",
    );
  });

  it("版本仓库没有目标命名空间写入权限时提供直接修正入口", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        currentStage: "registry",
        issueCode: "AD-REG-201",
        actionKind: "deployment-path-registry-retry",
        message:
          "版本已经生成，但腾讯云 TCR 拒绝保存：当前账号没有 abcdeploy 命名空间的写入权限",
        completedSteps: ["snapshot-source", "sync-source", "build"],
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.progress?.currentLabel).toBe("保存运行版本");
    expect(view.recovery).toEqual({
      title: "运行版本没有保存到版本仓库",
      message:
        "服务镜像已经生成，但当前腾讯云 TCR 连接不能写入这个项目使用的命名空间。",
      preserved: "已生成的 2 个服务镜像和前两步结果都已保留，无需重新构建。",
      nextSteps: [
        "点击“更新版本仓库授权”，确认命名空间，并重新填写有推送权限的用户名和访问密码。",
        "验证通过后会从上传版本继续，不会重新读取源码或构建镜像。",
      ],
      action: "configure_registry",
      actionLabel: "更新版本仓库授权",
    });
  });

  it("后台进入待处理后不再继续显示正在启动", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        issueCode: "AD-DEP-201",
        message: "服务器没有完成本次更新，已经完成的步骤仍然保留",
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.state).toBe("failed");
    expect(view.steps[2]?.status).toBe("failed");
    expect(view.progress?.currentLabel).toBe("启动服务");
    expect(view.details).toContainEqual({
      label: "问题编号",
      value: "AD-DEP-201",
    });
    expect(view.recovery).toEqual({
      title: "服务器状态还没有确认完成",
      message: "系统暂时无法确认本次版本是否已经在服务器正常运行。",
      preserved: "已生成的 2 个服务镜像和前两步结果都已保留，无需重新构建。",
      nextSteps: [
        "点击“核对服务器状态并继续”，系统会核对服务器上正在运行的服务和本次镜像版本。",
        "如果本次版本已经正常运行，系统会跳过重复部署，直接继续配置访问地址；否则只重试启动服务。",
      ],
      action: "retry",
      actionLabel: "核对服务器状态并继续",
    });
  });

  it("运行配置失败只把本次实际缺少的字段交给恢复界面", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        issueCode: "AD-CFG-201",
        actionKind: "deployment-path-runtime-config",
        message:
          "运行服务器还缺少 2 项必要配置：MINIMAX_API_KEY、EXTERNAL_TOKEN",
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.recovery).toEqual(
      expect.objectContaining({
        action: "configure_runtime",
        missingConfigurationVariables: ["MINIMAX_API_KEY", "EXTERNAL_TOKEN"],
      }),
    );
  });

  it("访问地址缺失时提供专用配置动作，而不是再次检查服务器", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        issueCode: "AD-NET-201",
        actionKind: "deployment-path-route-check",
        message: "运行服务已经启动，还需要填写一个项目访问地址",
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.recovery).toEqual(
      expect.objectContaining({
        action: "configure_address",
        actionLabel: "设置访问地址",
        nextSteps: [
          "点击“设置访问地址”，确认系统生成的地址，或填写你自己的域名。",
          "保存后只继续配置访问入口并验证，已运行的服务和已生成版本都会保留。",
        ],
      }),
    );
  });

  it("访问地址已配置但证书仍在签发时只重新检查，不要求用户重填域名", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        currentStage: "server",
        issueCode: "AD-NET-201",
        actionKind: "deployment-path-route-check",
        message:
          "运行服务已经启动，访问地址还未就绪：api.example.com 的 443 端口已连通，但 TLS/HTTPS 尚未就绪",
        routeChecks: [
          {
            host: "api.example.com",
            url: "https://api.example.com/",
            phase: "https",
            reachable: false,
            httpStatus: null,
            message: "api.example.com 的 443 端口已连通，但 TLS/HTTPS 尚未就绪",
          },
        ],
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.recovery).toEqual(
      expect.objectContaining({
        action: "recheck_address",
        actionLabel: "重新检查访问地址",
        nextSteps: [
          "点击“重新检查访问地址”，系统会继续等待证书签发并重新验证现有地址。",
          "不会重新部署服务或构建版本，也不需要重新填写已经保存的域名。",
        ],
      }),
    );
  });

  it("云厂商拦截自动临时域名时提供更换地址入口，不让用户重复检查", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        currentStage: "server",
        issueCode: "AD-NET-201",
        actionKind: "deployment-path-route-check",
        message:
          "运行服务已经启动，访问地址还未就绪：sample-api.119-91-112-80.sslip.io 被云厂商的未备案域名策略拦截；应用已在服务器运行，请改用已备案的测试域名",
        routeChecks: [
          {
            host: "sample-api.119-91-112-80.sslip.io",
            url: "https://sample-api.119-91-112-80.sslip.io/",
            phase: "https",
            reachable: false,
            httpStatus: 403,
            message: "被云厂商的未备案域名策略拦截",
          },
        ],
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.recovery).toEqual(
      expect.objectContaining({
        action: "configure_address",
        actionLabel: "更换访问地址",
        nextSteps: [
          "点击“更换访问地址”，为需要公网访问的服务填写已备案域名。",
          "保存后只更新访问入口并继续验证，已运行的服务和已生成版本都会保留。",
        ],
      }),
    );
  });

  it("线路配置兼容问题说明无需用户修改，并从当前地址验证继续", () => {
    const view = serverDeploymentRunView(
      serverRun({
        status: "needs_action",
        currentStage: "healthcheck",
        issueCode: "AD-NET-201",
        actionKind: "route-check",
        message:
          "应用已部署，但无法读取公网路由配置：持续部署密钥只能用于测试或生产环境",
        routeChecks: [
          {
            host: "web.example.com",
            url: "https://web.example.com/",
            phase: "ready",
            reachable: true,
            httpStatus: 200,
            message: "访问正常",
          },
        ],
      }),
      Date.parse("2026-07-24T13:43:30.000Z"),
    );

    expect(view.recovery).toEqual(
      expect.objectContaining({
        title: "访问地址需要继续验证",
        message: "应用和访问地址都已保留，客户端需要重新读取这条线路的配置。",
        action: "recheck_address",
        actionLabel: "继续验证访问地址",
        nextSteps: [
          "点击“继续验证访问地址”，系统会重新读取这条线路并核对已有地址。",
          "不需要修改域名、重新部署服务或重新构建版本。",
        ],
      }),
    );
  });
});
