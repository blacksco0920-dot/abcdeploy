import type { DeploymentRun } from "../../types";

export function successfulServerRun(): DeploymentRun {
  return {
    id: "run-success",
    projectPath: "/projects/sample-store",
    projectName: "sample-store",
    environment: "deployment",
    status: "success",
    currentStage: "complete",
    buildSerial: "cnb-42",
    commitSha: "3111dcaa1abf",
    sourceRunId: null,
    candidateTag: null,
    artifacts: [
      {
        service: "h5",
        image: "registry.example.com/sample/h5",
        digest:
          "sha256:d301e162eb4d152e32957d287b12f65c6dfd210cdf480897498a89affe5d072d",
      },
    ],
    actionKind: null,
    actionUrl: null,
    issueCode: null,
    repository: "owner/sample-store",
    branch: "main",
    message: "运行成功",
    completedSteps: ["build", "registry", "deploy", "healthcheck"],
    routeChecks: [
      {
        host: "api.example.com",
        url: "https://api.example.com",
        phase: "ready",
        reachable: true,
        httpStatus: 200,
        message: "ok",
      },
      {
        host: "h5.example.com",
        url: "https://h5.example.com",
        phase: "ready",
        reachable: true,
        httpStatus: 200,
        message: "ok",
      },
    ],
    startedAt: "2026-07-24T02:00:00Z",
    updatedAt: "2026-07-24T02:03:00Z",
  };
}
