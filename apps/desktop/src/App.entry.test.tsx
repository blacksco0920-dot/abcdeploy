import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listDeploymentPathRuns: vi.fn(),
  listDeploymentPaths: vi.fn(),
  listRecentProjects: vi.fn(),
  resolveLocalFolderSource: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    listActiveDeploymentRuns: vi.fn().mockResolvedValue([]),
    listAttentionDeploymentRuns: vi.fn().mockResolvedValue([]),
    listCurrentDeploymentRuns: vi.fn().mockResolvedValue([]),
    listDeploymentPathRuns: api.listDeploymentPathRuns,
    listDeploymentPaths: api.listDeploymentPaths,
    listDeploymentRuns: vi.fn().mockResolvedValue([]),
    listRecentProjects: api.listRecentProjects,
    listRecentSuccessfulDeploymentRuns: vi.fn().mockResolvedValue([]),
    listServers: vi.fn().mockResolvedValue([]),
    resolveLocalFolderSource: api.resolveLocalFolderSource,
  };
});

import App from "./App";

describe("App MVP entry", () => {
  beforeEach(() => {
    api.listDeploymentPathRuns.mockReset();
    api.listDeploymentPathRuns.mockResolvedValue([]);
    api.listDeploymentPaths.mockReset();
    api.listDeploymentPaths.mockResolvedValue([]);
    api.listRecentProjects.mockReset();
    api.resolveLocalFolderSource.mockReset();
  });

  it("新建部署直接进入单页编辑器，不先打开文件夹或旧工作流", async () => {
    api.listRecentProjects.mockResolvedValue([]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "新建部署" }));

    expect(
      screen.getByRole("heading", { name: "选择项目" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "选择运行位置" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("部署线路")).not.toBeInTheDocument();
  });

  it("打开已有本地部署也进入同一个编辑器并读取保存的来源", async () => {
    api.listRecentProjects.mockResolvedValue([
      {
        id: "project-1",
        name: "sample-store",
        path: "/projects/sample-store",
        pathExists: true,
        activeRunCount: 0,
        latestStatus: null,
        latestEnvironment: null,
        lastOpenedAt: "2026-07-24T00:00:00Z",
        latestUpdatedAt: null,
      },
    ]);
    api.resolveLocalFolderSource.mockResolvedValue({
      sourcePath: "/projects/sample-store",
      managedPath: "/managed/snapshot-1",
      snapshotId: "snapshot-1",
      projectName: "sample-store",
      serviceCount: 1,
      httpServiceCount: 1,
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "打开 sample-store（尚未选择运行位置）",
      }),
    );

    expect(
      await screen.findByText("/projects/sample-store", { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "选择运行位置" }),
    ).toBeInTheDocument();
    expect(api.resolveLocalFolderSource).toHaveBeenCalledWith(
      "/projects/sample-store",
    );
    expect(screen.queryByText("部署线路")).not.toBeInTheDocument();
  });

  it("打开已有在线结果时进入项目详情，只有更新上线才进入运行页", async () => {
    api.listRecentProjects.mockResolvedValue([
      {
        id: "project-1",
        name: "sample-store",
        path: "/projects/sample-store",
        pathExists: true,
        activeRunCount: 0,
        latestRunId: "run-online",
        latestStatus: "success",
        latestEnvironment: "deployment",
        lastOpenedAt: "2026-07-24T00:00:00Z",
        latestUpdatedAt: "2026-07-24T00:10:00Z",
      },
    ]);
    api.listDeploymentPaths.mockResolvedValue([
      {
        id: "path-1",
        projectPath: "/projects/sample-store",
        name: "上线",
        sourceConnectionId: "source-1",
        registryConnectionId: "registry-1",
        serverId: "server-1",
        configProfileIds: [],
        address: "shop.example.com",
        routes: [{ service: "web", host: "shop.example.com", path: "/" }],
        state: "online",
        lastRunId: "run-online",
        currentRunId: "run-online",
        lastSuccessfulRevision: "abc123",
        createdAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:10:00Z",
      },
    ]);
    api.listDeploymentPathRuns.mockResolvedValue([
      {
        id: "run-online",
        projectPath: "/projects/sample-store",
        projectName: "sample-store",
        environment: "deployment",
        status: "success",
        currentStage: "complete",
        buildSerial: "build-1",
        commitSha: "abc123",
        sourceRunId: null,
        candidateTag: null,
        artifacts: [
          {
            service: "web",
            image: "registry.example.com/sample-store/web",
            digest: "sha256:123",
          },
        ],
        actionKind: null,
        actionUrl: null,
        issueCode: null,
        repository: "sample-store",
        branch: "main",
        message: "运行成功",
        completedSteps: ["source", "build", "deploy", "verify"],
        routeChecks: [
          {
            host: "shop.example.com",
            url: "https://shop.example.com/",
            phase: "ready",
            reachable: true,
            httpStatus: 200,
            message: "访问正常",
          },
        ],
        startedAt: "2026-07-24T00:00:00Z",
        updatedAt: "2026-07-24T00:10:00Z",
      },
    ]);
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: /打开 sample-store/ }),
    );

    expect(
      await screen.findByRole("heading", { name: "项目正在服务器运行" }),
    ).toBeInTheDocument();
    expect(screen.getByText("https://shop.example.com/")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "更新上线" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "选择运行位置" }),
    ).not.toBeInTheDocument();
  });
});
