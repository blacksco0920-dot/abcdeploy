import { describe, expect, it } from "vitest";
import type { DeploymentPath, DeploymentRun } from "../../types";
import { projectDeploymentDetail } from "./model";

const path = (overrides: Partial<DeploymentPath> = {}): DeploymentPath => ({
  id: "path-1",
  projectPath: "/projects/store",
  name: "上线",
  sourceConnectionId: "source-1",
  registryConnectionId: "registry-1",
  serverId: "server-1",
  configProfileIds: [],
  address: "https://store.example.com",
  routes: [
    { service: "web", host: "store.example.com", path: "/" },
    { service: "api", host: "api.example.com", path: "/" },
  ],
  state: "online",
  lastRunId: "run-current",
  currentRunId: "run-current",
  lastSuccessfulRevision: "commit-current",
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
  ...overrides,
});

const run = (
  id: string,
  commitSha: string,
  updatedAt: string,
  overrides: Partial<DeploymentRun> = {},
): DeploymentRun => ({
  id,
  projectPath: "/projects/store",
  projectName: "store",
  environment: "deployment",
  status: "success",
  currentStage: "complete",
  buildSerial: `build-${id}`,
  commitSha,
  sourceRunId: null,
  candidateTag: null,
  artifacts: [
    {
      service: "web",
      image: "registry.example.com/store/web",
      digest: `sha256:${id}-web`,
    },
    {
      service: "api",
      image: "registry.example.com/store/api",
      digest: `sha256:${id}-api`,
    },
  ],
  actionKind: null,
  actionUrl: null,
  issueCode: null,
  repository: "team/store",
  branch: "main",
  message: "上线成功",
  completedSteps: ["source", "build", "deploy", "verify"],
  routeChecks: [
    {
      host: "api.example.com",
      url: "https://api.example.com/",
      phase: "ready",
      reachable: true,
      httpStatus: 200,
      message: "正常",
    },
    {
      host: "store.example.com",
      url: "https://store.example.com/",
      phase: "ready",
      reachable: true,
      httpStatus: 200,
      message: "正常",
    },
  ],
  startedAt: updatedAt,
  updatedAt,
  ...overrides,
});

describe("projectDeploymentDetail", () => {
  it("只用线路明确记录的当前版本作为线上版本，并优先展示网页地址", () => {
    const older = run("run-old", "commit-old", "2026-07-20T00:00:00Z");
    const current = run(
      "run-current",
      "commit-current",
      "2026-07-25T00:00:00Z",
    );

    const result = projectDeploymentDetail(path(), [older, current]);

    expect(result.currentRun?.id).toBe("run-current");
    expect(result.primaryAddress).toBe("https://store.example.com/");
    expect(result.addresses).toEqual([
      "https://store.example.com/",
      "https://api.example.com/",
    ]);
  });

  it("更新失败不会覆盖当前在线版本，但会明确投射最近一次失败", () => {
    const current = run(
      "run-current",
      "commit-current",
      "2026-07-25T00:00:00Z",
    );
    const failed = run("run-failed", "commit-next", "2026-07-27T00:00:00Z", {
      status: "failed",
      currentStage: "deploy",
      message: "服务器启动失败",
    });

    const result = projectDeploymentDetail(
      path({ lastRunId: "run-failed", currentRunId: "run-current" }),
      [current, failed],
    );

    expect(result.currentRun?.id).toBe("run-current");
    expect(result.latestRun?.id).toBe("run-failed");
    expect(result.failedUpdate?.id).toBe("run-failed");
  });

  it("没有当前线上指针时不会把历史成功任务猜成线上版本", () => {
    const historical = run("run-old", "commit-old", "2026-07-20T00:00:00Z");

    const result = projectDeploymentDetail(
      path({
        state: "needs_action",
        lastRunId: "run-failed",
        currentRunId: null,
        lastSuccessfulRevision: null,
      }),
      [historical],
    );

    expect(result.currentRun).toBeNull();
    expect(result.history[0]?.current).toBe(false);
  });

  it("只有具备不可变镜像摘要的旧成功版本可以恢复", () => {
    const current = run(
      "run-current",
      "commit-current",
      "2026-07-25T00:00:00Z",
    );
    const restorable = run("run-old", "commit-old", "2026-07-20T00:00:00Z");
    const incomplete = run(
      "run-incomplete",
      "commit-incomplete",
      "2026-07-18T00:00:00Z",
      { artifacts: [] },
    );

    const result = projectDeploymentDetail(path(), [
      incomplete,
      restorable,
      current,
    ]);

    expect(
      result.history.find((item) => item.run.id === "run-current"),
    ).toMatchObject({
      current: true,
      canRestore: false,
    });
    expect(
      result.history.find((item) => item.run.id === "run-old"),
    ).toMatchObject({
      current: false,
      canRestore: true,
    });
    expect(
      result.history.find((item) => item.run.id === "run-incomplete"),
    ).toMatchObject({ current: false, canRestore: false });
  });
});
