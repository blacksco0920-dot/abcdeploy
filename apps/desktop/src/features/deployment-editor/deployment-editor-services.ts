import { openUrl } from "@tauri-apps/plugin-opener";
import {
  checkDeploymentRoutes,
  continueExistingDeployment,
  createManagedLocalRunWorkspace,
  listDeploymentPaths,
  listDeploymentRuns,
  loadRuntimeConfig,
  listServers,
  openProject,
  prepareManagedServerDeployment,
  prepareManagedServerEnvironment,
  projectManagedDeploymentEvidence,
  refreshDeployment,
  resolveLocalFolderSource,
  resolveManagedServerEnvironment,
  resetProjectDeployment as resetExistingProjectDeployment,
  selectProjectDirectory,
  startLocalPreview,
  storeRuntimeConfig,
  syncProjectToCnb,
  verifyManagedLocalRun,
} from "../../api";
import type {
  DeploymentPath,
  DeploymentRun,
  LocalPreviewStatus,
  ManagedEvidenceProjection,
  ManagedLocalEvidenceRound,
  ManagedLocalRunWorkspace,
  ManagedServerEnvironment,
  ManagedSourceSnapshot,
  PublicRouteStatus,
  PreparedManagedServerDeployment,
  RuntimeConfigFile,
  RuntimeConfigStatus,
  ServerResource,
  WorkspaceAdoption,
} from "../../types";
import type { DeploymentEvidenceSnapshot } from "../deployment-evidence/model";
import {
  ensureServerDeploymentSetup,
  inspectServerDeploymentSetup,
  saveServerDeploymentAddress,
  saveServerDeploymentSetup,
  type ServerDeploymentSetupInspection,
} from "./server-deployment-setup-service";
import {
  confirmNewServerConnection,
  prepareNewServerConnection,
  type NewServerInput,
  type PreparedServerConnection,
} from "./server-connection";
import {
  authorizeServerDeploymentServices,
  completeServerDeploymentAuthorization,
  type ServerDeploymentAuthorizationInput,
  type ServerDeploymentAuthorizationResult,
} from "./server-deployment-authorization";

export interface RestoredServerDeployment {
  path: DeploymentPath;
  run: DeploymentRun;
  server: ServerResource;
}

export interface DeploymentEditorServices {
  chooseLocalFolder: () => Promise<string | null>;
  resolveLocalFolder: (path: string) => Promise<ManagedSourceSnapshot>;
  resolveRepository: (repositoryUrl: string) => Promise<{
    identity: string;
    name: string;
    serviceCount: number;
  }>;
  listSavedServers: () => Promise<ServerResource[]>;
  loadLatestServerDeployment?: (
    projectPath: string,
  ) => Promise<RestoredServerDeployment | null>;
  loadProjectAdoption?: (projectPath: string) => Promise<WorkspaceAdoption>;
  continueProjectDeployment?: (projectPath: string) => Promise<void>;
  resetProjectDeployment?: (projectPath: string) => Promise<void>;
  ensureServerDeploymentSetup: (
    projectPath: string,
    serverId: string,
  ) => Promise<ServerDeploymentSetupInspection>;
  inspectServerDeploymentSetup?: (
    projectPath: string,
    serverId: string,
  ) => Promise<ServerDeploymentSetupInspection>;
  authorizeServerDeploymentServices?: (
    inspection: ServerDeploymentSetupInspection,
    input: ServerDeploymentAuthorizationInput,
  ) => Promise<ServerDeploymentAuthorizationResult>;
  completeServerDeploymentAuthorization?: (
    inspection: ServerDeploymentSetupInspection,
    secretRepository: string,
  ) => Promise<ServerDeploymentSetupInspection>;
  saveServerDeploymentSetup: (
    inspection: ServerDeploymentSetupInspection,
    sourceConnectionId: string,
    registryConnectionId: string,
    serverId: string,
  ) => Promise<DeploymentPath>;
  saveServerDeploymentAddress: (
    inspection: ServerDeploymentSetupInspection,
    routes: DeploymentPath["routes"],
  ) => Promise<DeploymentPath>;
  resolveServerEnvironment: (
    serverId: string,
  ) => Promise<ManagedServerEnvironment>;
  prepareServerRuntime: (serverId: string) => Promise<ManagedServerEnvironment>;
  projectEvidence: (
    evidence: DeploymentEvidenceSnapshot,
    nowMs: number,
    online: boolean,
  ) => Promise<ManagedEvidenceProjection>;
  prepareServerConnection: (
    input: NewServerInput,
  ) => Promise<PreparedServerConnection>;
  confirmServerConnection: (
    sourcePath: string,
    prepared: PreparedServerConnection,
    password: string,
  ) => Promise<ServerResource>;
  prepareServerDeployment?: (
    projectPath: string,
    serverId: string,
    snapshotId: string,
  ) => Promise<PreparedManagedServerDeployment>;
  startServerDeployment?: (runId: string) => Promise<DeploymentRun>;
  getServerDeploymentRun?: (
    projectPath: string,
    runId: string,
  ) => Promise<DeploymentRun | null>;
  checkServerDeploymentRoutes?: (runId: string) => Promise<PublicRouteStatus[]>;
  waitForServerProgressInterval?: () => Promise<void>;
  loadRuntimeConfig?: (
    projectPath: string,
    environment: RuntimeConfigFile["environment"],
  ) => Promise<RuntimeConfigFile>;
  storeRuntimeConfig?: (
    projectPath: string,
    environment: RuntimeConfigFile["environment"],
    content: string,
  ) => Promise<RuntimeConfigStatus>;
  syncServerSource?: (
    projectPath: string,
    repository: string,
    branch: string,
    allowUncommitted: boolean,
    taskId: string,
  ) => Promise<unknown>;
  createLocalRunWorkspace: (
    snapshotId: string,
  ) => Promise<ManagedLocalRunWorkspace>;
  startLocalRun: (workspacePath: string) => Promise<LocalPreviewStatus>;
  verifyLocalRun: (runId: string) => Promise<ManagedLocalEvidenceRound>;
  waitForEvidenceInterval: () => Promise<void>;
  now: () => number;
  openAddress: (address: string) => Promise<void>;
}

export const defaultDeploymentEditorServices: DeploymentEditorServices = {
  chooseLocalFolder: () => selectProjectDirectory("选择要运行的项目文件夹"),
  resolveLocalFolder: resolveLocalFolderSource,
  resolveRepository: async () => {
    throw new Error(
      "代码仓库读取能力尚未接入当前客户端；地址已经保留，请改用本地文件夹继续验证。",
    );
  },
  listSavedServers: listServers,
  loadLatestServerDeployment: async (projectPath) => {
    const [paths, runs, servers] = await Promise.all([
      listDeploymentPaths(projectPath),
      listDeploymentRuns(projectPath),
      listServers(),
    ]);
    const successfulRuns = runs
      .filter((run) => run.status === "success")
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    for (const run of successfulRuns) {
      const path =
        paths.find((candidate) => candidate.lastRunId === run.id) ??
        (paths.length === 1 ? paths[0] : undefined);
      const server = servers.find(
        (candidate) => candidate.id === path?.serverId,
      );
      if (path && server) return { path, run, server };
    }
    return null;
  },
  loadProjectAdoption: async (projectPath) =>
    (await openProject(projectPath)).adoption,
  continueProjectDeployment: async (projectPath) => {
    await continueExistingDeployment(projectPath);
  },
  resetProjectDeployment: async (projectPath) => {
    await resetExistingProjectDeployment(projectPath);
  },
  ensureServerDeploymentSetup,
  inspectServerDeploymentSetup,
  authorizeServerDeploymentServices,
  completeServerDeploymentAuthorization,
  saveServerDeploymentAddress,
  saveServerDeploymentSetup,
  projectEvidence: projectManagedDeploymentEvidence,
  prepareServerConnection: prepareNewServerConnection,
  confirmServerConnection: confirmNewServerConnection,
  prepareServerDeployment: prepareManagedServerDeployment,
  startServerDeployment: refreshDeployment,
  getServerDeploymentRun: async (projectPath, runId) =>
    (await listDeploymentRuns(projectPath)).find((run) => run.id === runId) ??
    null,
  checkServerDeploymentRoutes: checkDeploymentRoutes,
  waitForServerProgressInterval: () =>
    new Promise((resolve) => window.setTimeout(resolve, 1_200)),
  loadRuntimeConfig,
  storeRuntimeConfig,
  syncServerSource: syncProjectToCnb,
  createLocalRunWorkspace: createManagedLocalRunWorkspace,
  startLocalRun: (workspacePath) => startLocalPreview(workspacePath),
  verifyLocalRun: verifyManagedLocalRun,
  resolveServerEnvironment: resolveManagedServerEnvironment,
  prepareServerRuntime: prepareManagedServerEnvironment,
  waitForEvidenceInterval: () =>
    new Promise((resolve) => window.setTimeout(resolve, 5_000)),
  now: () => Date.now(),
  openAddress: openUrl,
};
