import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeploymentEditorController } from "./DeploymentEditorController";
import { services } from "./deployment-editor-services.test.data";

describe("DeploymentEditorController source refresh", () => {
  it("没有 HTTP 服务时明确停止，不进入无法产生访问证据的运行", async () => {
    const api = services({
      resolveLocalFolder: vi.fn().mockResolvedValue({
        sourcePath: "/projects/worker",
        managedPath: "/managed/worker",
        snapshotId: "snapshot-worker",
        projectName: "worker",
        serviceCount: 1,
        httpServiceCount: 0,
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "当前版本只支持至少包含一个网页或 HTTP 服务的项目",
    );
    expect(screen.getByRole("button", { name: /这台电脑/ })).toBeDisabled();
  });

  it("上线前项目内容变化时自动重新读取并使用新快照继续", async () => {
    const resolveLocalFolder = vi
      .fn()
      .mockResolvedValueOnce({
        sourcePath: "/projects/sample-store",
        managedPath: "/managed/snapshot-1",
        snapshotId: "snapshot-1",
        projectName: "sample-store",
        serviceCount: 1,
        httpServiceCount: 1,
      })
      .mockResolvedValue({
        sourcePath: "/projects/sample-store",
        managedPath: "/managed/snapshot-2",
        snapshotId: "snapshot-2",
        projectName: "sample-store",
        serviceCount: 1,
        httpServiceCount: 1,
      });
    const prepareServerDeployment = vi.fn().mockResolvedValue({
      environment: {
        id: "server-env-test",
        version: "server-version-test",
        connectionId: "server-1",
      },
      deploymentPath: { id: "path-1" },
      run: { id: "run-1", repository: "owner/sample-store", branch: "main" },
    });
    const api = services({
      resolveLocalFolder,
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
      startServerDeployment: vi.fn().mockResolvedValue({
        id: "run-1",
        status: "running",
        message: "CNB 已开始构建",
      }),
      // This case verifies the snapshot handoff, not long-running progress polling.
      // Leaving the default immediate polling interval enabled would create an
      // intentional endless deployment loop in the test process.
      waitForServerProgressInterval: undefined,
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

    expect(await screen.findByText("CNB 已开始构建")).toBeInTheDocument();
    expect(resolveLocalFolder).toHaveBeenCalledTimes(3);
    expect(api.ensureServerDeploymentSetup).toHaveBeenCalledTimes(2);
    expect(prepareServerDeployment).toHaveBeenCalledWith(
      "/projects/sample-store",
      "server-1",
      "snapshot-2",
    );
    expect(screen.queryByText(/项目文件在检查后发生变化/)).toBeNull();
  });
});
