import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeploymentRun } from "../../types";
import { DeploymentEditorController } from "./DeploymentEditorController";
import { services } from "./deployment-editor-services.test.data";

describe("DeploymentEditorController 地址恢复", () => {
  it("临时域名被云厂商拦截时可直接打开当前线路并更换访问地址", async () => {
    const failedDeployment: DeploymentRun = {
      id: "run-1",
      projectPath: "/projects/sample-store",
      projectName: "sample-store",
      environment: "deployment",
      status: "needs_action",
      currentStage: "server",
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
      actionKind: "deployment-path-route-check",
      actionUrl: null,
      issueCode: "AD-NET-201",
      repository: "owner/sample-store",
      branch: "main",
      message:
        "运行服务已经启动，访问地址还未就绪：sample.119-91-112-80.sslip.io 被云厂商的未备案域名策略拦截；请改用已备案的测试域名",
      completedSteps: ["snapshot-source", "sync-source", "build", "registry"],
      routeChecks: [
        {
          host: "sample.119-91-112-80.sslip.io",
          url: "https://sample.119-91-112-80.sslip.io/",
          phase: "https",
          reachable: false,
          httpStatus: 403,
          message: "被云厂商的未备案域名策略拦截",
        },
      ],
      startedAt: "2026-07-24T13:42:00.000Z",
      updatedAt: "2026-07-24T13:42:30.000Z",
    };
    const ensureServerDeploymentSetup = vi.fn().mockResolvedValue({
      paths: [
        {
          id: "path-1",
          projectPath: "/projects/sample-store",
          name: "上线",
          sourceConnectionId: "source-1",
          registryConnectionId: "registry-1",
          serverId: "server-1",
          configProfileIds: [],
          address: "https://sample.119-91-112-80.sslip.io",
          routes: [
            {
              service: "web",
              host: "sample.119-91-112-80.sslip.io",
              path: "/",
            },
          ],
          state: "ready",
          lastRunId: "run-1",
          currentRunId: null,
          lastSuccessfulRevision: null,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:00Z",
        },
      ],
      autoCompleted: false,
      issue: null,
      projectPath: "/projects/sample-store",
      serverId: "server-1",
      publicServices: [{ id: "web", name: "商城网页", detail: "网页服务" }],
      sourceOptions: [],
      registryOptions: [],
      selectedSourceConnectionId: "source-1",
      selectedRegistryConnectionId: "registry-1",
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
      ensureServerDeploymentSetup,
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
      await screen.findByRole("button", { name: "更换访问地址" }),
    );

    expect(
      await screen.findByRole("heading", { name: "设置项目访问地址" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("商城网页访问地址")).toHaveValue(
      "sample.119-91-112-80.sslip.io",
    );
    expect(ensureServerDeploymentSetup).toHaveBeenCalledTimes(2);
  });
});
