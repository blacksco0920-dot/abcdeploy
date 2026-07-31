import { describe, expect, it } from "vitest";
import type {
  DeploymentPathRoute,
  DeploymentRun,
  ManagedServerEnvironment,
  ManagedSourceSnapshot,
} from "../../types";
import { serverEvidenceView } from "./server-evidence";

const snapshot: ManagedSourceSnapshot = {
  sourcePath: "/project",
  managedPath: "/managed/project",
  snapshotId: "snapshot-1",
  projectName: "sample-store",
  serviceCount: 2,
  httpServiceCount: 2,
};

const environment: ManagedServerEnvironment = {
  id: "server-1",
  version: "1",
  connectionId: "connection-1",
  name: "运行服务器",
  host: "203.0.113.10",
  user: "ubuntu",
  port: 22,
  platform: "linux",
  architecture: "amd64",
  dockerVersion: "28.0.0",
  composeVersion: "2.38.0",
  verifiedAtMs: 1,
};

function deploymentRun(overrides: Partial<DeploymentRun> = {}): DeploymentRun {
  return {
    id: "task-id-must-not-be-runtime-version",
    projectPath: "/project",
    projectName: "sample-store",
    environment: "deployment",
    status: "success",
    currentStage: "complete",
    buildSerial: "build-1",
    commitSha: "3111dcaa1abfb421e5da7ffcb24c6e46ba6bd131",
    sourceRunId: null,
    candidateTag: null,
    artifacts: [
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
    actionKind: null,
    actionUrl: "https://sample.example.com",
    issueCode: null,
    repository: "team/sample-store",
    branch: "main",
    message: "上线完成",
    completedSteps: [],
    routeChecks: [
      {
        host: "sample.example.com",
        url: "https://sample.example.com",
        phase: "ready",
        reachable: true,
        httpStatus: 200,
        message: "可访问",
      },
    ],
    startedAt: "2026-07-25T00:00:00Z",
    updatedAt: "2026-07-25T00:01:00Z",
    ...overrides,
  };
}

describe("serverEvidenceView", () => {
  it("使用每个服务的不可变镜像摘要作为实际运行版本", () => {
    const evidence = serverEvidenceView(
      deploymentRun(),
      environment,
      snapshot,
      1_000,
    );

    expect(evidence.projection.status).toBe("verified_current");
    expect(evidence.runtimeIdentity).not.toContain(
      "task-id-must-not-be-runtime-version",
    );
    expect(evidence.runtimeVersions).toEqual([
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
    ]);
  });

  it("按线路中的网页服务选择主要地址，而不是机械打开第一个接口地址", () => {
    const routes: DeploymentPathRoute[] = [
      { service: "api", host: "api.example.com", path: "/" },
      { service: "h5", host: "h5.example.com", path: "/" },
    ];
    const evidence = serverEvidenceView(
      deploymentRun({
        routeChecks: [
          {
            host: "api.example.com",
            url: "https://api.example.com",
            phase: "ready",
            reachable: true,
            httpStatus: 200,
            message: "可访问",
          },
          {
            host: "h5.example.com",
            url: "https://h5.example.com",
            phase: "ready",
            reachable: true,
            httpStatus: 200,
            message: "可访问",
          },
        ],
      }),
      environment,
      snapshot,
      1_000,
      routes,
    );

    expect(evidence.primaryAddress).toBe("https://h5.example.com");
    expect(evidence.addresses).toEqual([
      "https://h5.example.com",
      "https://api.example.com",
    ]);
  });

  it("缺少有效镜像摘要时不声称当前运行成功", () => {
    const evidence = serverEvidenceView(
      deploymentRun({
        artifacts: [
          {
            service: "api",
            image: "registry.example.com/sample/api",
            digest: "unknown",
          },
        ],
      }),
      environment,
      snapshot,
      1_000,
    );

    expect(evidence.projection.status).toBe("verification_failed");
    expect(evidence.projection.canShowCurrentSuccess).toBe(false);
    expect(evidence.projection.failedCheckIds).toContain("runtime");
  });
});
