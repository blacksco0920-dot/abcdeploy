import { vi } from "vitest";
import type { ManagedLocalEvidenceRound } from "../../types";
import { projectDeploymentEvidence } from "../deployment-evidence/model";
import type { DeploymentEditorServices } from "./deployment-editor-services";

/** Creates an isolated service boundary for deployment editor tests. */
export function services(
  overrides: Partial<DeploymentEditorServices> = {},
): DeploymentEditorServices {
  const rounds: ManagedLocalEvidenceRound[] = [0, 5_000, 10_000].map(
    (checkedAtMs) => ({
      runId: "managed-run-1",
      snapshotId: "snapshot-1",
      checkedAtMs,
      services: [
        {
          id: "web",
          running: true,
          url: "http://127.0.0.1:3000",
          reachable: true,
          httpStatus: 200,
        },
      ],
    }),
  );
  return {
    chooseLocalFolder: vi.fn().mockResolvedValue("/projects/sample-store"),
    resolveLocalFolder: vi.fn().mockResolvedValue({
      sourcePath: "/projects/sample-store",
      managedPath: "/managed/snapshot-1",
      snapshotId: "snapshot-1",
      projectName: "sample-store",
      serviceCount: 1,
      httpServiceCount: 1,
    }),
    resolveRepository: vi
      .fn()
      .mockRejectedValue(new Error("代码仓库读取能力尚未接入")),
    listSavedServers: vi.fn().mockResolvedValue([]),
    ensureServerDeploymentSetup: vi.fn().mockResolvedValue({
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
          state: "ready",
          lastRunId: null,
          currentRunId: null,
          lastSuccessfulRevision: null,
          createdAt: "2026-07-24T00:00:00Z",
          updatedAt: "2026-07-24T00:00:00Z",
        },
      ],
      autoCompleted: false,
      issue: null,
      sourceOptions: [],
      registryOptions: [],
      selectedSourceConnectionId: "source-1",
      selectedRegistryConnectionId: "registry-1",
    }),
    saveServerDeploymentAddress: vi.fn(),
    saveServerDeploymentSetup: vi.fn(),
    prepareServerConnection: vi
      .fn()
      .mockRejectedValue(new Error("未连接服务器")),
    confirmServerConnection: vi
      .fn()
      .mockRejectedValue(new Error("未连接服务器")),
    syncServerSource: vi.fn().mockResolvedValue({}),
    resolveServerEnvironment: vi.fn().mockResolvedValue({
      id: "server-env-test",
      version: "server-version-test",
      connectionId: "server-1",
      name: "测试服务器",
      host: "127.0.0.1",
      user: "ubuntu",
      port: 22,
      platform: "Linux",
      architecture: "x86_64",
      dockerVersion: "test",
      composeVersion: "test",
      verifiedAtMs: 1,
    }),
    prepareServerRuntime: vi.fn().mockResolvedValue({
      id: "server-env-test",
      version: "server-version-test",
      connectionId: "server-1",
      name: "测试服务器",
      host: "127.0.0.1",
      user: "ubuntu",
      port: 22,
      platform: "Linux",
      architecture: "x86_64",
      dockerVersion: "test",
      composeVersion: "test",
      verifiedAtMs: 1,
    }),
    projectEvidence: vi.fn().mockImplementation(async (evidence, nowMs) => ({
      ...projectDeploymentEvidence(evidence, nowMs),
      missingCheckIds: [],
      missingRequirementKinds: [],
    })),
    createLocalRunWorkspace: vi.fn().mockResolvedValue({
      runId: "managed-run-1",
      snapshotId: "snapshot-1",
      workspacePath: "/managed/runs/managed-run-1/project",
    }),
    startLocalRun: vi.fn().mockResolvedValue({
      state: "running",
      message: "服务已启动",
      composePath: "/managed/compose.yaml",
      envReady: true,
      services: [],
      writtenFiles: [],
    }),
    verifyLocalRun: vi
      .fn()
      .mockImplementation(async () => rounds.shift() ?? rounds[0]),
    waitForEvidenceInterval: vi.fn().mockResolvedValue(undefined),
    waitForServerProgressInterval: vi.fn().mockResolvedValue(undefined),
    getServerDeploymentRun: vi.fn().mockResolvedValue(null),
    checkServerDeploymentRoutes: vi.fn().mockResolvedValue([]),
    now: vi.fn(() => 10_000),
    openAddress: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
