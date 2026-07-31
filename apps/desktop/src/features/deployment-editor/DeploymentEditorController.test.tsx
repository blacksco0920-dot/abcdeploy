import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeploymentRun } from "../../types";
import { DeploymentEditorController } from "./DeploymentEditorController";
import { services } from "./deployment-editor-services.test.data";
import { successfulServerRun } from "./test-fixtures.test.data";

describe("DeploymentEditorController", () => {
  it("把本地文件夹到本机运行接成可验证的单页闭环", async () => {
    const api = services();
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    expect(
      await screen.findByText("/projects/sample-store", { exact: false }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /这台电脑/ }));
    const start = await screen.findByRole("button", { name: "在本机运行" });
    expect(start).toBeEnabled();
    fireEvent.click(start);

    expect(
      await screen.findByRole("heading", { name: "运行成功" }),
    ).toBeInTheDocument();
    expect(screen.getByText("http://127.0.0.1:3000")).toBeInTheDocument();
    expect(screen.getByText(/连续通过 3 次/)).toBeInTheDocument();
    expect(api.createLocalRunWorkspace).toHaveBeenCalledWith("snapshot-1");
    expect(api.startLocalRun).toHaveBeenCalledWith(
      "/managed/runs/managed-run-1/project",
    );
    expect(api.verifyLocalRun).toHaveBeenCalledTimes(3);
    expect(api.waitForEvidenceInterval).toHaveBeenCalledTimes(2);
  });

  it("打开已有本地部署时自动读取来源，但不替用户选择运行位置", async () => {
    const api = services();
    render(
      <DeploymentEditorController
        initialLocalPath="/projects/sample-store"
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    expect(
      await screen.findByText("/projects/sample-store", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /这台电脑/ })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "再选择运行位置" }),
    ).toBeDisabled();
  });

  it("打开已有服务器部署时恢复最近成功结果，不要求重新选择服务器", async () => {
    const openAddress = vi.fn().mockResolvedValue(undefined);
    const api = services({
      now: vi.fn(() => Date.parse("2026-07-24T02:04:00Z")),
      openAddress,
      loadLatestServerDeployment: vi.fn().mockResolvedValue({
        path: {
          id: "path-1",
          projectPath: "/projects/sample-store",
          name: "上线",
          sourceConnectionId: "source-1",
          registryConnectionId: "registry-1",
          serverId: "server-1",
          configProfileIds: [],
          address: "https://h5.example.com",
          routes: [
            { service: "api", host: "api.example.com", path: "/" },
            { service: "h5", host: "h5.example.com", path: "/" },
          ],
          state: "online",
          lastRunId: "run-success",
          currentRunId: "run-success",
          lastSuccessfulRevision: "3111dcaa1abf",
          createdAt: "2026-07-24T02:00:00Z",
          updatedAt: "2026-07-24T02:03:00Z",
        },
        run: successfulServerRun(),
        server: {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T02:03:00Z",
        },
      }),
    });
    render(
      <DeploymentEditorController
        initialLocalPath="/projects/sample-store"
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "运行成功" }),
    ).toBeInTheDocument();
    expect(screen.getByText("https://h5.example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开网页" }));
    expect(openAddress).toHaveBeenCalledWith("https://h5.example.com");
    expect(screen.queryByRole("button", { name: "上线到服务器" })).toBeNull();
  });

  it("后端尚未实现的仓库来源如实失败，不伪装为已解析", async () => {
    const onError = vi.fn();
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={onError}
        services={services()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /代码仓库地址/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "代码仓库地址" }), {
      target: { value: "https://code.example.com/team/private-app.git" },
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "代码仓库读取能力尚未接入",
      ),
    );
    expect(screen.getByRole("button", { name: /这台电脑/ })).toBeDisabled();
  });

  it("服务器只有经过真实环境解析后才允许准备上线任务", async () => {
    const prepareServerDeployment = vi.fn().mockResolvedValue({
      environment: {
        id: "server-env-test",
        version: "server-version-test",
        connectionId: "server-1",
      },
      deploymentPath: { id: "path-1" },
      run: { id: "run-1", repository: "owner/sample-store", branch: "main" },
    });
    const startServerDeployment = vi
      .fn()
      .mockResolvedValueOnce({
        id: "run-1",
        status: "running",
        message: "CNB 已开始构建",
      })
      .mockResolvedValueOnce({
        ...successfulServerRun(),
        id: "run-1",
      });
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      prepareServerDeployment,
      startServerDeployment,
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));

    const start = await screen.findByRole("button", {
      name: "上线到服务器",
    });
    expect(api.resolveServerEnvironment).toHaveBeenCalledWith("server-1");
    fireEvent.click(start);

    await waitFor(() => {
      expect(startServerDeployment).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByRole("heading", { name: "运行成功" }),
    ).toBeInTheDocument();
    expect(prepareServerDeployment).toHaveBeenCalledWith(
      "/projects/sample-store",
      "server-1",
      "snapshot-1",
    );
    expect(startServerDeployment).toHaveBeenCalledWith("run-1");
  });

  it("服务器上线执行期间持续读取后台事实，不把长任务显示成卡住", async () => {
    let finishDeployment: ((run: object) => void) | undefined;
    const startServerDeployment = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          finishDeployment = resolve;
        }),
    );
    const waitForServerProgressInterval = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => new Promise(() => undefined));
    const progressRun = {
      id: "run-1",
      projectPath: "/projects/sample-store",
      projectName: "sample-store",
      environment: "deployment",
      status: "running",
      currentStage: "deploy",
      buildSerial: "cnb-build-42",
      commitSha: "3111dcaa1abf",
      sourceRunId: null,
      candidateTag: null,
      artifacts: [
        { service: "web", image: "sample/web", digest: "sha256:web" },
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
    };
    const getServerDeploymentRun = vi.fn().mockResolvedValue(progressRun);
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      prepareServerDeployment: vi.fn().mockResolvedValue({
        environment: {
          id: "server-env-test",
          version: "server-version-test",
          connectionId: "server-1",
        },
        deploymentPath: { id: "path-1" },
        run: { id: "run-1", repository: "owner/sample-store", branch: "main" },
      }),
      startServerDeployment: startServerDeployment as never,
      waitForServerProgressInterval,
      getServerDeploymentRun,
      now: vi.fn(() => Date.parse("2026-07-24T13:43:30.000Z")),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "上线到服务器" }),
    );

    expect(
      (await screen.findAllByText("版本已经安全保存，正在更新运行服务器"))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("第 3/4 步 · 启动服务")).toBeInTheDocument();
    expect(getServerDeploymentRun).toHaveBeenCalledWith(
      "/projects/sample-store",
      "run-1",
    );

    finishDeployment?.({ ...progressRun, status: "needs_action" });
  });

  it("构建服务首次返回处理中时会继续推进，直到显示明确待办", async () => {
    const runningBuild: DeploymentRun = {
      id: "run-1",
      projectPath: "/projects/sample-store",
      projectName: "sample-store",
      environment: "deployment",
      status: "running",
      currentStage: "build",
      buildSerial: "cnb-build-42",
      commitSha: "3111dcaa1abf",
      sourceRunId: null,
      candidateTag: null,
      artifacts: [],
      actionKind: null,
      actionUrl: null,
      issueCode: null,
      repository: "owner/sample-store",
      branch: "main",
      message: "构建服务正在生成服务镜像",
      completedSteps: ["snapshot-source", "sync-source"],
      startedAt: "2026-07-24T13:42:00.000Z",
      updatedAt: "2026-07-24T13:42:30.000Z",
    };
    const needsConfiguration: DeploymentRun = {
      ...runningBuild,
      status: "needs_action",
      currentStage: "deploy",
      artifacts: [
        { service: "web", image: "sample/web", digest: "sha256:web" },
      ],
      actionKind: "deployment-path-runtime-config",
      issueCode: "AD-CFG-201",
      message: "运行服务器还缺少 2 项必要配置：COS_SECRET_ID、MINIMAX_API_KEY",
      completedSteps: ["snapshot-source", "sync-source", "build", "registry"],
      updatedAt: "2026-07-24T13:43:30.000Z",
    };
    const startServerDeployment = vi
      .fn()
      .mockResolvedValueOnce(runningBuild)
      .mockResolvedValueOnce(needsConfiguration);
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      prepareServerDeployment: vi.fn().mockResolvedValue({
        environment: {
          id: "server-env-test",
          version: "server-version-test",
          connectionId: "server-1",
        },
        deploymentPath: { id: "path-1" },
        run: {
          id: "run-1",
          repository: "owner/sample-store",
          branch: "main",
        },
      }),
      startServerDeployment,
      getServerDeploymentRun: undefined,
      waitForServerProgressInterval: vi.fn().mockResolvedValue(undefined),
      now: vi.fn(() => Date.parse("2026-07-24T13:43:30.000Z")),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "上线到服务器" }),
    );

    await waitFor(() => expect(startServerDeployment).toHaveBeenCalledTimes(2));
    expect(
      (
        await screen.findAllByText(
          "运行服务器还缺少 2 项必要配置：COS_SECRET_ID、MINIMAX_API_KEY",
          { exact: false },
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "补全运行配置" }),
    ).toBeInTheDocument();
  });

  it("首次上线设置可由唯一连接补齐时自动完成，不再跳转旧页面", async () => {
    const prepareServerDeployment = vi.fn();
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      ensureServerDeploymentSetup: vi.fn().mockResolvedValue({
        paths: [
          {
            id: "path-auto",
            projectPath: "/projects/sample-store",
            name: "上线",
            sourceConnectionId: "source-1",
            registryConnectionId: "registry-1",
            serverId: "server-1",
            configProfileIds: [],
            address: "https://sample.example.com",
            routes: [{ service: "web", host: "sample.example.com", path: "/" }],
            state: "ready",
            lastRunId: null,
            currentRunId: null,
            lastSuccessfulRevision: null,
            createdAt: "2026-07-24T00:00:00Z",
            updatedAt: "2026-07-24T00:00:00Z",
          },
        ],
        autoCompleted: true,
        issue: null,
        sourceOptions: [],
        registryOptions: [],
        selectedSourceConnectionId: "source-1",
        selectedRegistryConnectionId: "registry-1",
      }),
      prepareServerDeployment,
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));

    expect(
      await screen.findByText(/已自动复用保存的上线服务/),
    ).toBeInTheDocument();
    expect(screen.queryByText("完成首次上线设置")).toBeNull();
    expect(screen.getByRole("button", { name: "上线到服务器" })).toBeEnabled();
    expect(prepareServerDeployment).not.toHaveBeenCalled();
  });

  it("存在多个可用上线服务时留在当前页面，只要求选择已有连接", async () => {
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      ensureServerDeploymentSetup: vi.fn().mockResolvedValue({
        paths: [],
        autoCompleted: false,
        issue: "choose_connections",
        sourceOptions: [
          { id: "source-1", name: "构建服务 A", detail: "CNB" },
          { id: "source-2", name: "构建服务 B", detail: "CNB" },
        ],
        registryOptions: [
          { id: "registry-1", name: "版本仓库", detail: "TCR" },
        ],
        selectedSourceConnectionId: null,
        selectedRegistryConnectionId: "registry-1",
        projectPath: "/projects/sample-store",
        serverId: "server-1",
        defaultAddress: "",
        defaultRoutes: [],
      }),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "检查上线服务" }),
    );

    expect(
      screen.getByRole("heading", { name: "选择本次上线服务" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/不需要重新填写地址、账号或密码/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "准备并继续" })).toBeDisabled();
  });

  it("首次没有 CNB 和 TCR 连接时在当前流程完成一次授权", async () => {
    const missing = {
      paths: [],
      autoCompleted: false,
      issue: "missing_connections" as const,
      sourceOptions: [],
      registryOptions: [],
      selectedSourceConnectionId: null,
      selectedRegistryConnectionId: null,
      projectPath: "/projects/sample-store",
      serverId: "server-1",
      defaultAddress: "",
      defaultRoutes: [],
      publicServices: [],
      repository: "",
      registryEndpoint: "",
      registryNamespace: "",
      needsSourceAuthorization: true,
      needsRegistryAuthorization: true,
    };
    const ready = {
      ...missing,
      paths: [
        {
          id: "path-1",
          projectPath: "/projects/sample-store",
          name: "上线",
          sourceConnectionId: "source-1",
          registryConnectionId: "registry-1",
          serverId: "server-1",
          configProfileIds: [],
          address: "https://sample.example.com",
          routes: [{ service: "web", host: "sample.example.com", path: "/" }],
          state: "ready" as const,
          lastRunId: null,
          currentRunId: null,
          lastSuccessfulRevision: null,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:00Z",
        },
      ],
      issue: null,
      sourceOptions: [{ id: "source-1", name: "CNB", detail: "CNB" }],
      registryOptions: [
        { id: "registry-1", name: "腾讯云 TCR", detail: "TCR" },
      ],
      selectedSourceConnectionId: "source-1",
      selectedRegistryConnectionId: "registry-1",
      needsSourceAuthorization: false,
      needsRegistryAuthorization: false,
    };
    const addressMissing = {
      ...ready,
      paths: [],
      issue: "missing_address" as const,
      defaultAddress: "https://sample-store.203-0-113-24.sslip.io",
      defaultRoutes: [
        {
          service: "web",
          host: "sample-store.203-0-113-24.sslip.io",
          path: "/",
        },
      ],
      publicServices: [
        { id: "web", name: "网页服务", detail: "项目主要访问入口" },
      ],
    };
    const authorizeServerDeploymentServices = vi.fn().mockResolvedValue({
      inspection: addressMissing,
      secretRepository: "owner/deploy-secrets",
      repositoryAccessible: true,
      secretHandoffRequired: true,
      bundle: {
        environment: "staging",
        filename: "env.sample-store.staging.yml",
        fileUrl:
          "https://cnb.cool/owner/deploy-secrets/-/blob/main/env.sample-store.staging.yml",
        content: "STAGING_SERVER_HOST: 203.0.113.24",
        missingVariables: [],
        deployKeyFingerprint: "SHA256:test",
      },
    });
    const completeServerDeploymentAuthorization = vi
      .fn()
      .mockResolvedValue(addressMissing);
    const saveServerDeploymentAddress = vi.fn().mockResolvedValue(undefined);
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      ensureServerDeploymentSetup: vi
        .fn()
        .mockResolvedValueOnce(missing)
        .mockResolvedValue(ready),
      authorizeServerDeploymentServices,
      completeServerDeploymentAuthorization,
      saveServerDeploymentAddress,
      prepareServerDeployment: vi.fn(),
      startServerDeployment: vi.fn(),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "检查上线服务" }),
    );

    fireEvent.change(screen.getByLabelText("CNB 访问令牌"), {
      target: { value: "cnb-token" },
    });
    fireEvent.change(screen.getByLabelText("版本仓库命名空间"), {
      target: { value: "sample" },
    });
    fireEvent.change(screen.getByLabelText("版本仓库用户名"), {
      target: { value: "100000000000" },
    });
    fireEvent.change(screen.getByLabelText("版本仓库访问密码"), {
      target: { value: "registry-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "准备并继续" }));

    await waitFor(() =>
      expect(authorizeServerDeploymentServices).toHaveBeenCalledWith(
        missing,
        expect.objectContaining({
          repository: "",
          registryNamespace: "sample",
        }),
      ),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    expect(
      await screen.findByRole("heading", {
        name: "保存一次上线安全配置",
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "复制" })).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "复制" }));
    const confirmSecret = await screen.findByRole("button", {
      name: "我已在 CNB 保存，继续",
    });
    await waitFor(() => expect(confirmSecret).toBeEnabled());
    fireEvent.click(confirmSecret);
    await waitFor(() =>
      expect(completeServerDeploymentAuthorization).toHaveBeenCalledWith(
        addressMissing,
        "owner/deploy-secrets",
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "设置项目访问地址" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存并继续上线" }));
    await waitFor(() =>
      expect(saveServerDeploymentAddress).toHaveBeenCalledWith(
        addressMissing,
        addressMissing.defaultRoutes,
      ),
    );
    expect(
      await screen.findByRole("button", { name: "上线到服务器" }),
    ).toBeEnabled();
  });

  it("空服务器缺少 Docker 时自动准备运行环境并恢复上线入口", async () => {
    const resolvedEnvironment = {
      id: "server-env-test",
      version: "server-version-test",
      connectionId: "server-1",
      name: "云服务器 A",
      host: "203.0.113.24",
      user: "ubuntu",
      port: 22,
      platform: "Linux",
      architecture: "x86_64",
      dockerVersion: "28.0.0",
      composeVersion: "2.35.0",
      verifiedAtMs: 1,
    };
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      resolveServerEnvironment: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "AD-ENV-207：服务器尚未准备好运行项目；请安装 Docker 与 Docker Compose",
          ),
        )
        .mockResolvedValue(resolvedEnvironment),
      prepareServerRuntime: vi.fn().mockResolvedValue(resolvedEnvironment),
      prepareServerDeployment: vi.fn(),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));

    await waitFor(() =>
      expect(api.prepareServerRuntime).toHaveBeenCalledWith("server-1"),
    );
    expect(
      await screen.findByRole("button", { name: "上线到服务器" }),
    ).toBeEnabled();
  });

  it("服务器重装导致身份变化时提供预填信息的重新连接入口", async () => {
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:old-server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      resolveServerEnvironment: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "AD-ENV-205：服务器身份与上次确认的不一致，已停止连接；请确认服务器是否被重装或更换。",
          ),
        ),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));

    const reconnect = await screen.findByRole("button", {
      name: "重新连接服务器",
    });
    fireEvent.click(reconnect);
    expect(
      await screen.findByRole("heading", { name: "重新连接服务器" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("203.0.113.24")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ubuntu")).toBeInTheDocument();
  });

  it("服务器上线失败后重试仍使用服务器执行器，不会误触发本机运行", async () => {
    const prepareServerDeployment = vi.fn().mockResolvedValue({
      environment: {
        id: "server-env-test",
        version: "server-version-test",
        connectionId: "server-1",
      },
      deploymentPath: { id: "path-1" },
      run: { id: "run-1", repository: "owner/sample-store", branch: "main" },
    });
    const startServerDeployment = vi
      .fn()
      .mockRejectedValue(new Error("服务器上的服务启动失败"));
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      prepareServerDeployment,
      startServerDeployment,
      startLocalRun: vi.fn(),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "上线到服务器" }),
    );

    expect(
      await screen.findByRole("button", { name: "重试运行" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重试运行" }));
    await waitFor(() => expect(startServerDeployment).toHaveBeenCalledTimes(2));
    expect(api.startLocalRun).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/服务器上的服务启动失败/).length,
    ).toBeGreaterThan(0);
  });

  it("检测到已有部署时直接提供继续管理和重新设置，不让用户进入无效重试", async () => {
    const loadProjectAdoption = vi
      .fn()
      .mockResolvedValueOnce({
        mode: "pending",
        detected: true,
        repository: "owner/sample-store",
        pipelineExists: true,
        historyImportAfter: null,
        freshDraft: false,
      })
      .mockResolvedValue({
        mode: "managed",
        detected: true,
        repository: "owner/sample-store",
        pipelineExists: true,
        historyImportAfter: null,
        freshDraft: false,
      });
    const continueProjectDeployment = vi.fn().mockResolvedValue(undefined);
    const api = services({
      loadProjectAdoption,
      continueProjectDeployment,
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));

    expect(
      await screen.findByRole("heading", { name: "检测到已有上线设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "继续管理已有部署" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "重新设置部署" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /^服务器/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试运行" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "继续管理已有部署" }));

    await waitFor(() =>
      expect(continueProjectDeployment).toHaveBeenCalledWith(
        "/projects/sample-store",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "检测到已有上线设置" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^服务器/ })).toBeEnabled();
  });

  it("准备上线时才发现已有部署待确认，也会切换为可操作的处理选择", async () => {
    const loadProjectAdoption = vi
      .fn()
      .mockResolvedValueOnce({
        mode: "managed",
        detected: true,
        repository: "owner/sample-store",
        pipelineExists: true,
        historyImportAfter: null,
        freshDraft: false,
      })
      .mockResolvedValue({
        mode: "pending",
        detected: true,
        repository: "owner/sample-store",
        pipelineExists: true,
        historyImportAfter: null,
        freshDraft: false,
      });
    const api = services({
      loadProjectAdoption,
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      prepareServerDeployment: vi
        .fn()
        .mockRejectedValue(
          new Error("AD-ADOPT-101：请先选择继续管理已有部署或重新设置部署"),
        ),
      continueProjectDeployment: vi.fn().mockResolvedValue(undefined),
      resetProjectDeployment: vi.fn().mockResolvedValue(undefined),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "上线到服务器" }),
    );

    expect(
      await screen.findByRole("heading", { name: "检测到已有上线设置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "继续管理已有部署" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "重试运行" }),
    ).not.toBeInTheDocument();
  });

  it("缺少服务器运行配置时从失败指引直接打开必要配置并继续", async () => {
    const failedDeployment: DeploymentRun = {
      id: "run-1",
      projectPath: "/projects/sample-store",
      projectName: "sample-store",
      environment: "deployment",
      status: "needs_action",
      currentStage: "deploy",
      buildSerial: "build-1",
      commitSha: "3111dcaa1abf0000000000000000000000000000",
      sourceRunId: null,
      candidateTag: null,
      artifacts: [
        {
          service: "web",
          image: "registry.example/web",
          digest: `sha256:${"a".repeat(64)}`,
        },
      ],
      actionKind: "deployment-path-runtime-config",
      actionUrl: null,
      issueCode: "AD-CFG-201",
      repository: "owner/sample-store",
      branch: "main",
      message: "运行服务器还缺少 1 项必要配置：API_KEY",
      completedSteps: ["snapshot-source", "sync-source", "build", "registry"],
      startedAt: "2026-07-24T13:42:00.000Z",
      updatedAt: "2026-07-24T13:42:10.000Z",
    };
    const loadRuntimeConfig = vi.fn().mockResolvedValue({
      environment: "path-1",
      filename: ".env.path-1",
      sourceFiles: [".env.example"],
      content: [
        "# 数据库",
        "DATABASE_URL=",
        "REDIS_URL=",
        "# 服务授权",
        "API_KEY=",
        "AUTH_TOKEN_SECRET=",
      ].join("\n"),
      templateContent: "",
      requiredVariables: [
        "DATABASE_URL",
        "REDIS_URL",
        "API_KEY",
        "AUTH_TOKEN_SECRET",
      ],
      stored: false,
      authorizationRequired: false,
    });
    const storeRuntimeConfig = vi.fn().mockResolvedValue({
      environment: "path-1",
      filename: ".env.path-1",
      stored: true,
    });
    const api = services({
      listSavedServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "云服务器 A",
          host: "203.0.113.24",
          user: "ubuntu",
          port: 22,
          keyPath: "/managed/server-key",
          keyPathExists: true,
          hostFingerprint: "SHA256:server",
          lastCheckedAt: "2026-07-24T00:00:00Z",
        },
      ]),
      prepareServerDeployment: vi.fn().mockResolvedValue({
        environment: {
          id: "server-env-test",
          version: "server-version-test",
          connectionId: "server-1",
        },
        deploymentPath: { id: "path-1" },
        run: { id: "run-1", repository: "owner/sample-store", branch: "main" },
      }),
      startServerDeployment: vi.fn().mockResolvedValue(failedDeployment),
      loadRuntimeConfig,
      storeRuntimeConfig,
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /^服务器/ }));
    fireEvent.click(await screen.findByRole("button", { name: /云服务器 A/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "上线到服务器" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "补全运行配置" }),
    );
    expect(
      await screen.findByRole("heading", { name: "补全本次上线配置" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("本次上线还需填写 1 项；其他配置不会阻塞本次上线。"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("数据库")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("REDIS_URL")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("AUTH_TOKEN_SECRET"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("服务授权"), {
      target: { value: "saved-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并继续上线" }));

    await waitFor(() =>
      expect(storeRuntimeConfig).toHaveBeenCalledWith(
        "/projects/sample-store",
        "path-1",
        expect.stringContaining("API_KEY=saved-secret"),
      ),
    );
  });

  it("本机运行失败时说明已保留内容，并提供明确的重试入口", async () => {
    const api = services({
      startLocalRun: vi.fn().mockRejectedValue(new Error("端口 3000 已被占用")),
    });
    render(
      <DeploymentEditorController
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /本地文件夹/ }));
    await screen.findByText("/projects/sample-store", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: /这台电脑/ }));
    fireEvent.click(await screen.findByRole("button", { name: "在本机运行" }));

    expect(
      await screen.findByRole("heading", { name: "运行过程" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/端口 3000 已被占用/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重试运行" })).toBeEnabled();
    expect(
      screen.getAllByText(/项目快照和已填写内容已保留/).length,
    ).toBeGreaterThan(0);
  });
});
