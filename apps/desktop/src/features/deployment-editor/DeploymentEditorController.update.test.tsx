import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentEditorController } from "./DeploymentEditorController";
import { services } from "./deployment-editor-services.test.data";
import { successfulServerRun } from "./test-fixtures.test.data";

describe("DeploymentEditorController 更新上线", () => {
  it("复用已有部署设置，只有明确更新上线后才创建新任务", async () => {
    const prepareServerDeployment = vi.fn().mockResolvedValue({
      environment: {
        id: "server-env-test",
        version: "server-version-test",
        connectionId: "server-1",
      },
      deploymentPath: {
        id: "path-1",
        routes: [
          { service: "api", host: "api.example.com", path: "/" },
          { service: "h5", host: "h5.example.com", path: "/" },
        ],
      },
      run: {
        id: "run-update",
        repository: "owner/sample-store",
        branch: "main",
      },
    });
    const startServerDeployment = vi
      .fn()
      .mockResolvedValueOnce({
        id: "run-update",
        status: "running",
        message: "CNB 已开始构建",
      })
      .mockResolvedValueOnce({
        ...successfulServerRun(),
        id: "run-update",
      });
    const api = services({
      now: vi.fn(() => Date.parse("2026-07-24T02:04:00Z")),
      prepareServerDeployment,
      startServerDeployment,
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
        mode="update"
        onBack={vi.fn()}
        onError={vi.fn()}
        services={api}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "本次更新" }),
    ).toBeInTheDocument();
    expect(screen.getByText("云服务器 A")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运行成功" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "选择运行位置" })).toBeNull();
    expect(
      await screen.findByRole("button", { name: "更新上线" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "上线设置" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "更新上线" }));

    await waitFor(() => {
      expect(startServerDeployment).toHaveBeenCalledTimes(2);
    });
    expect(prepareServerDeployment).toHaveBeenCalledWith(
      "/projects/sample-store",
      "server-1",
      "snapshot-1",
    );
    expect(api.syncServerSource).toHaveBeenCalledWith(
      "/projects/sample-store",
      "owner/sample-store",
      "main",
      true,
      "run-update",
    );
  });
});
