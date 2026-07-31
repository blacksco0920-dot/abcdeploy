import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeploymentRun } from "../../types";
import { DeploymentEditorController } from "./DeploymentEditorController";
import { services } from "./deployment-editor-services.test.data";

describe("DeploymentEditorController route recovery", () => {
  it("证书签发完成后可直接重新检查现有地址并完成上线", async () => {
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
        "运行服务已经启动，访问地址还未就绪：sample.example.com 的 TLS/HTTPS 尚未就绪",
      completedSteps: ["snapshot-source", "sync-source", "build", "registry"],
      routeChecks: [
        {
          host: "sample.example.com",
          url: "https://sample.example.com/",
          phase: "https",
          reachable: false,
          httpStatus: null,
          message: "sample.example.com 的 TLS/HTTPS 尚未就绪",
        },
      ],
      startedAt: "2026-07-24T13:42:00.000Z",
      updatedAt: "2026-07-24T13:42:30.000Z",
    };
    const completedDeployment: DeploymentRun = {
      ...failedDeployment,
      status: "success",
      currentStage: "complete",
      actionKind: null,
      actionUrl: "https://sample.example.com/",
      issueCode: null,
      message: "上线完成，1 个运行服务和 1 个访问地址均已验证",
      completedSteps: [...failedDeployment.completedSteps, "server", "public"],
      routeChecks: [
        {
          host: "sample.example.com",
          url: "https://sample.example.com/",
          phase: "ready",
          reachable: true,
          httpStatus: 200,
          message: "访问正常",
        },
      ],
      updatedAt: "2026-07-24T13:43:30.000Z",
    };
    const checkServerDeploymentRoutes = vi
      .fn()
      .mockResolvedValue(completedDeployment.routeChecks);
    const getServerDeploymentRun = vi
      .fn()
      .mockResolvedValue(completedDeployment);
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
      waitForServerProgressInterval: vi.fn(
        () => new Promise<void>(() => undefined),
      ),
      checkServerDeploymentRoutes,
      getServerDeploymentRun,
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
      await screen.findByRole("button", { name: "重新检查访问地址" }),
    );

    await waitFor(() =>
      expect(checkServerDeploymentRoutes).toHaveBeenCalledWith("run-1"),
    );
    expect(getServerDeploymentRun).toHaveBeenCalledWith(
      "/projects/sample-store",
      "run-1",
    );
    expect(
      await screen.findByRole("heading", { name: "运行成功" }),
    ).toBeInTheDocument();
    expect(screen.getByText("https://sample.example.com/")).toBeInTheDocument();
  });

  it("重新检查地址后仍按线路服务角色打开主要网页", async () => {
    const failedDeployment: DeploymentRun = {
      id: "run-route-order",
      projectPath: "/projects/sample-store",
      projectName: "sample-store",
      environment: "deployment",
      status: "needs_action",
      currentStage: "server",
      buildSerial: "build-route-order",
      commitSha: "3111dcaa1abf0000000000000000000000000000",
      sourceRunId: null,
      candidateTag: null,
      artifacts: [
        {
          service: "api",
          image: "registry.example/api",
          digest: `sha256:${"a".repeat(64)}`,
        },
        {
          service: "web",
          image: "registry.example/web",
          digest: `sha256:${"b".repeat(64)}`,
        },
      ],
      actionKind: "deployment-path-route-check",
      actionUrl: null,
      issueCode: "AD-NET-201",
      repository: "owner/sample-store",
      branch: "main",
      message: "访问地址的 TLS/HTTPS 尚未就绪",
      completedSteps: ["snapshot-source", "sync-source", "build", "registry"],
      routeChecks: [
        {
          host: "service.example.com",
          url: "https://service.example.com/",
          phase: "https",
          reachable: false,
          httpStatus: null,
          message: "接口地址的 TLS/HTTPS 尚未就绪",
        },
        {
          host: "customer.example.com",
          url: "https://customer.example.com/",
          phase: "https",
          reachable: false,
          httpStatus: null,
          message: "网页地址的 TLS/HTTPS 尚未就绪",
        },
      ],
      startedAt: "2026-07-24T13:42:00.000Z",
      updatedAt: "2026-07-24T13:42:30.000Z",
    };
    const completedDeployment: DeploymentRun = {
      ...failedDeployment,
      status: "success",
      currentStage: "complete",
      actionKind: null,
      actionUrl: "https://service.example.com/",
      issueCode: null,
      message: "上线完成，2 个运行服务和 2 个访问地址均已验证",
      completedSteps: [...failedDeployment.completedSteps, "server", "public"],
      routeChecks: (failedDeployment.routeChecks ?? []).map((check) => ({
        ...check,
        phase: "ready" as const,
        reachable: true,
        httpStatus: 200,
        message: "访问正常",
      })),
      updatedAt: "2026-07-24T13:43:30.000Z",
    };
    const openAddress = vi.fn().mockResolvedValue(undefined);
    const api = services({
      openAddress,
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
        deploymentPath: {
          id: "path-1",
          routes: [
            { service: "api", host: "service.example.com", path: "/" },
            { service: "web", host: "customer.example.com", path: "/" },
          ],
        },
        run: {
          id: "run-route-order",
          repository: "owner/sample-store",
          branch: "main",
        },
      }),
      startServerDeployment: vi.fn().mockResolvedValue(failedDeployment),
      waitForServerProgressInterval: vi.fn(
        () => new Promise<void>(() => undefined),
      ),
      checkServerDeploymentRoutes: vi
        .fn()
        .mockResolvedValue(completedDeployment.routeChecks),
      getServerDeploymentRun: vi.fn().mockResolvedValue(completedDeployment),
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
      await screen.findByRole("button", { name: "重新检查访问地址" }),
    );

    expect(
      await screen.findByRole("heading", { name: "运行成功" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开网页" }));
    expect(openAddress).toHaveBeenCalledWith("https://customer.example.com/");
  });
});
