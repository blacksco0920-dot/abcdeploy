import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentEditorPage } from "./DeploymentEditorPage";
import type { DeploymentEditorMode, DeploymentEditorViewModel } from "./model";

const baseModel = (): DeploymentEditorViewModel => ({
  source: { kind: "none" },
  environment: { kind: "none" },
  checklist: {
    phase: "readiness",
    revisionId: null,
    state: "idle",
    totalActionCount: 0,
    completedActionCount: 0,
    unresolvedActionCount: 0,
  },
  checklistItems: [],
  systemChecks: [],
  run: { state: "idle", message: "", canCloseClient: false, steps: [] },
  evidence: null,
});

function renderPage(
  model: DeploymentEditorViewModel,
  mode: DeploymentEditorMode = "initial",
) {
  const handlers = {
    onBack: vi.fn(),
    onChooseLocalSource: vi.fn(),
    onChooseRepositorySource: vi.fn(),
    onRepositoryUrlChange: vi.fn(),
    onChooseLocalEnvironment: vi.fn(),
    onChooseServerEnvironment: vi.fn(),
    onSelectServer: vi.fn(),
    onConnectServer: vi.fn(),
    onOpenDeploymentSettings: vi.fn(),
    onContinueExistingDeployment: vi.fn(),
    onResetExistingDeployment: vi.fn(),
    onResolveAction: vi.fn(),
    onPrimaryAction: vi.fn(),
  };
  render(<DeploymentEditorPage mode={mode} model={model} {...handlers} />);
  return handlers;
}

describe("DeploymentEditorPage", () => {
  it("使用一个纵向页面承载项目、运行位置和唯一主操作", () => {
    const handlers = renderPage(baseModel());
    expect(
      screen.getByRole("heading", { name: "选择项目" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "选择运行位置" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /这台电脑/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /服务器/ })).toBeDisabled();
    const primary = screen.getByRole("button", { name: "先选择项目" });
    expect(primary).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    expect(handlers.onChooseLocalSource).toHaveBeenCalledTimes(1);
  });

  it("仓库地址错误在字段旁提示，不伪造成待办", () => {
    const model = baseModel();
    model.source = {
      kind: "repository",
      name: null,
      repositoryUrl: "not-a-repository",
      repositoryUrlValid: false,
      identity: null,
      serviceCount: null,
    };
    const handlers = renderPage(model);
    const input = screen.getByRole("textbox", { name: "代码仓库地址" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "请输入完整的 Git 仓库地址",
    );
    expect(
      screen.queryByRole("list", { name: "完整待办" }),
    ).not.toBeInTheDocument();
    fireEvent.change(input, {
      target: { value: "https://code.example.com/team/app.git" },
    });
    expect(handlers.onRepositoryUrlChange).toHaveBeenCalledWith(
      "https://code.example.com/team/app.git",
    );
  });

  it("项目读取失败时在来源旁说明，不伪装成用户待办", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: null,
      serviceCount: null,
    };
    model.sourceResolutionState = "failed";
    model.sourceResolutionMessage =
      "无法读取这个项目；源文件没有改动，请重新选择。";
    renderPage(model);

    expect(screen.getByRole("alert")).toHaveTextContent("源文件没有改动");
    expect(screen.queryByRole("list", { name: "完整待办" })).toBeNull();
  });

  it("一次展示全部待办、准确完成数量和各自处理入口", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = { kind: "local" };
    model.checklist = {
      phase: "readiness",
      revisionId: "r1",
      state: "blocked",
      totalActionCount: 2,
      completedActionCount: 1,
      unresolvedActionCount: 1,
    };
    model.systemChecks = ["项目可以读取", "本机运行条件可用"];
    model.checklistItems = [
      {
        id: "config",
        title: "补充必要配置",
        reason: "项目声明的一个必填配置还没有值",
        status: "pending",
        actionLabel: "填写配置",
      },
      {
        id: "port",
        title: "确认访问端口",
        reason: "已经验证新的可用端口",
        status: "completed",
        actionLabel: null,
      },
    ];
    const handlers = renderPage(model);
    const list = screen.getByRole("list", { name: "完整待办" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("1/2 已完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "填写配置" }));
    expect(handlers.onResolveAction).toHaveBeenCalledWith("config");
    expect(
      screen.getByRole("button", { name: "完成 1 项待办后可以运行" }),
    ).toBeDisabled();
  });

  it("检查 ready 后根据运行位置显示明确动词", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = {
      kind: "server",
      serverId: "server-1",
      servers: [
        {
          id: "server-1",
          name: "云服务器 A",
          detail: "203.0.113.24 · 已验证",
          verified: true,
        },
      ],
    };
    model.checklist = {
      phase: "readiness",
      revisionId: "r1",
      state: "ready",
      totalActionCount: 0,
      completedActionCount: 0,
      unresolvedActionCount: 0,
    };
    const handlers = renderPage(model);
    const primary = screen.getByRole("button", { name: "上线到服务器" });
    expect(primary).toBeEnabled();
    fireEvent.click(primary);
    expect(handlers.onPrimaryAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "start_server" }),
    );
  });

  it("运行中显示不可点击的状态而不是假操作按钮", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = {
      kind: "server",
      serverId: "server-1",
      servers: [],
    };
    model.run = {
      state: "running",
      message: "服务器没有完成本次更新",
      canCloseClient: true,
      steps: [
        {
          id: "start",
          label: "启动服务",
          status: "running",
          detail: "正在处理",
        },
      ],
    };

    const handlers = renderPage(model);

    expect(screen.getByRole("status")).toHaveTextContent("正在上线");
    expect(
      screen.queryByRole("heading", { name: "自动检查与待办" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("等待检查")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "查看运行进度" }),
    ).not.toBeInTheDocument();
    expect(handlers.onPrimaryAction).not.toHaveBeenCalled();
  });

  it("运行完成后只保留运行结果，不再展示上线前检查状态", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = { kind: "server", serverId: "server-1", servers: [] };
    model.run = {
      state: "completed",
      message: "上线完成，2 个运行服务和 1 个访问地址均已验证",
      canCloseClient: true,
      steps: [],
    };

    renderPage(model);

    expect(
      screen.getByRole("heading", { name: "运行过程" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "自动检查与待办" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("等待检查")).not.toBeInTheDocument();
  });

  it("长时间上线时展示真实阶段、完成比例、活跃时间和可展开详情", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = {
      kind: "server",
      serverId: "server-1",
      servers: [],
    };
    model.run = {
      state: "running",
      message: "版本已经安全保存，正在更新运行服务器",
      canCloseClient: true,
      steps: [
        {
          id: "source",
          label: "读取源码",
          status: "completed",
          detail: "已完成",
        },
        {
          id: "build",
          label: "准备运行版本",
          status: "completed",
          detail: "已完成",
        },
        {
          id: "deploy",
          label: "启动服务",
          status: "running",
          detail: "正在更新运行服务器",
        },
        {
          id: "verify",
          label: "验证结果",
          status: "pending",
          detail: "等待开始",
        },
      ],
      progress: {
        completed: 2,
        total: 4,
        currentLabel: "启动服务",
        elapsedLabel: "已运行 1 分 30 秒",
        updatedLabel: "刚刚有新进展",
      },
      details: [
        { label: "构建编号", value: "cnb-build-42" },
        { label: "代码版本", value: "3111dcaa1abf" },
      ],
    };

    renderPage(model);

    expect(screen.getByText("第 3/4 步 · 启动服务")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByText("已运行 1 分 30 秒")).toBeInTheDocument();
    expect(screen.getByText("刚刚有新进展")).toBeInTheDocument();
    fireEvent.click(screen.getByText("查看部署详情"));
    expect(screen.getByText("cnb-build-42")).toBeInTheDocument();
    expect(screen.getByText("3111dcaa1abf")).toBeInTheDocument();
  });

  it("服务器失败时在技术详情前展示可执行的修正指引", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = {
      kind: "server",
      serverId: "server-1",
      servers: [],
    };
    model.run = {
      state: "failed",
      message: "服务器没有完成本次更新，已经完成的步骤仍然保留",
      canCloseClient: true,
      steps: [],
      recovery: {
        title: "服务器状态还没有确认完成",
        message: "系统暂时无法确认本次版本是否已经在服务器正常运行。",
        preserved: "已生成的 2 个服务镜像和前两步结果都已保留，无需重新构建。",
        nextSteps: [
          "点击“核对服务器状态并继续”，系统会核对服务器上正在运行的服务和本次镜像版本。",
          "如果本次版本已经正常运行，系统会跳过重复部署，直接继续配置访问地址；否则只重试启动服务。",
        ],
        action: "retry",
        actionLabel: "核对服务器状态并继续",
      },
      details: [{ label: "问题编号", value: "AD-DEP-201" }],
    };

    const handlers = renderPage(model);

    expect(
      screen.getByRole("heading", { name: "服务器状态还没有确认完成" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 个服务镜像/)).toBeInTheDocument();
    expect(screen.getByText(/核对服务器上正在运行的服务/)).toBeInTheDocument();
    const recoveryAction = screen.getByRole("button", {
      name: "核对服务器状态并继续",
    });
    fireEvent.click(recoveryAction);
    expect(handlers.onPrimaryAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "retry_run" }),
    );
    expect(
      screen.queryByRole("button", { name: "重试运行" }),
    ).not.toBeInTheDocument();
  });

  it("公网失败保留运行事实并只提供重新检查访问", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.sourceResolutionState = "resolved";
    model.environment = { kind: "server", serverId: "server-1", servers: [] };
    model.checklist = {
      phase: "verification",
      revisionId: "r1",
      state: "blocked",
      totalActionCount: 1,
      completedActionCount: 0,
      unresolvedActionCount: 1,
    };
    model.evidence = {
      projection: {
        status: "service_running_public_access_blocked",
        canShowCurrentSuccess: false,
        continuation: "verification",
        preserveEstablishedRuntime: true,
        consecutivePassCount: 0,
        stabilityWindowMs: 0,
        verifiedAtMs: null,
        freshUntilMs: null,
        establishedCheckIds: ["runtime"],
        failedCheckIds: ["address"],
      },
      sourceIdentity: "3111dcaa1abfb421e5da7ffcb24c6e46ba6bd131",
      runtimeIdentity: "sha256:abc",
      runtimeVersions: [
        {
          service: "api",
          image: "registry.example.com/sample/api",
          digest:
            "sha256:3ea44c55703f841386dcbb0d4cc1097f867049ea266d455780637d41654f8c18",
        },
        {
          service: "web",
          image: "registry.example.com/sample/web",
          digest:
            "sha256:d301e162eb4d152e32957d287b12f65c6dfd210cdf480897498a89affe5d072d",
        },
      ],
      environmentLabel: "云服务器 A",
      serviceSummary: "2/2 服务健康",
      primaryAddress: "https://shop.example.com",
      addresses: ["https://shop.example.com"],
      checkedAtLabel: "刚刚",
    };
    renderPage(model);
    expect(
      screen.queryByRole("heading", { name: "自动检查与待办" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "服务已运行，访问地址仍需处理" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("sha256:abc")).not.toBeInTheDocument();
    expect(screen.getByText("源码版本")).toBeInTheDocument();
    expect(screen.getByText("Commit 3111dcaa1abf")).toHaveAttribute(
      "title",
      "3111dcaa1abfb421e5da7ffcb24c6e46ba6bd131",
    );
    expect(screen.getByText(/运行版本/)).toBeInTheDocument();
    expect(screen.getByText(/2 个服务镜像已核验/)).toBeInTheDocument();
    const runtimeDetails = screen
      .getByText(/2 个服务镜像已核验/)
      .closest("details");
    expect(runtimeDetails).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(/2 个服务镜像已核验/));
    expect(runtimeDetails).toHaveAttribute("open");
    expect(screen.getByText("api")).toBeInTheDocument();
    expect(screen.getByText("3ea44c55703f…654f8c18")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检查访问" })).toBeEnabled();
  });

  it("已有服务器部署时提供低频部署设置入口", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.environment = { kind: "server", serverId: "server-1", servers: [] };
    model.evidence = {
      projection: {
        status: "verified_current",
        canShowCurrentSuccess: true,
        continuation: "none",
        preserveEstablishedRuntime: true,
        consecutivePassCount: 3,
        stabilityWindowMs: 30_000,
        verifiedAtMs: 1,
        freshUntilMs: 2,
        establishedCheckIds: ["runtime", "address"],
        failedCheckIds: [],
      },
      sourceIdentity: "3111dcaa1abfb421e5da7ffcb24c6e46ba6bd131",
      runtimeIdentity: "sha256:abc",
      runtimeVersions: [],
      environmentLabel: "云服务器 A",
      serviceSummary: "2/2 服务健康",
      primaryAddress: "https://shop.example.com",
      addresses: ["https://shop.example.com"],
      checkedAtLabel: "刚刚",
    };

    const handlers = renderPage(model);
    fireEvent.click(screen.getByRole("button", { name: "上线设置" }));
    expect(handlers.onOpenDeploymentSettings).toHaveBeenCalledTimes(1);
  });

  it("更新已有部署时复用项目和服务器，只保留设置与更新操作", () => {
    const model = baseModel();
    model.source = {
      kind: "local",
      name: "sample-store",
      path: "/project",
      identity: "local-1",
      serviceCount: 2,
    };
    model.environment = {
      kind: "server",
      serverId: "server-1",
      servers: [
        {
          id: "server-1",
          name: "运行服务器",
          detail: "119.91.112.80 · ubuntu",
          verified: true,
        },
      ],
    };
    model.checklist = {
      phase: "readiness",
      revisionId: "revision-1",
      state: "ready",
      totalActionCount: 0,
      completedActionCount: 0,
      unresolvedActionCount: 0,
    };

    const handlers = renderPage(model, "update");

    expect(screen.getByText("更新上线")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "本次更新" }),
    ).toBeInTheDocument();
    expect(screen.getByText("sample-store")).toBeInTheDocument();
    expect(screen.getByText("运行服务器")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "选择项目" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "选择运行位置" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上线设置" }));
    expect(handlers.onOpenDeploymentSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "更新上线" }));
    expect(handlers.onPrimaryAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "start_server", label: "更新上线" }),
    );
  });
});
