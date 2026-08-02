import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CnbProjectSetup,
  CnbAccount,
  CnbSecretBundle,
  ApplyResult,
  ConnectionKind,
  ConnectionResource,
  DeploymentPath,
  DeploymentPathInput,
  DeploymentRun,
  LocalPreviewStatus,
  ManagedSourceSnapshot,
  ManagedLocalRunWorkspace,
  ManagedLocalEvidenceRound,
  ManagedServerEnvironment,
  PreparedManagedServerDeployment,
  ManagedEvidenceProjection,
  ProviderCheck,
  PublicRouteStatus,
  PipelineIdentityResult,
  RecentProject,
  RelinkProjectResult,
  ServerForm,
  ServerResource,
  RuntimeConfigFile,
  RuntimeConfigStatus,
  SourceSyncResult,
  GeneratedSshIdentity,
  WorkspacePreview,
} from "./types";
import { getAppSetting, setAppSetting } from "./api/settings";
export {
  checkSavedRegistryCredentials,
  replaceRegistryCredentials,
} from "./api/secrets";

export { getAppSetting, setAppSetting } from "./api/settings";

export async function selectProjectDirectory(
  title = "选择 AI 生成的整个项目文件夹（不要只选前端或后端）",
): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function generateSshIdentity(): Promise<GeneratedSshIdentity> {
  if (!isTauri()) {
    return {
      identity: {
        name: "abcdeploy_ed25519",
        path: "/Users/demo/.ssh/abcdeploy_ed25519",
        source: "ABCDeploy 专用身份",
        fingerprint: "SHA256:ABCDeployDemoIdentity",
        managed: true,
      },
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemo abcdeploy",
      created: true,
    };
  }
  return invoke<GeneratedSshIdentity>("generate_ssh_identity");
}

export async function openProject(path: string): Promise<WorkspacePreview> {
  if (!isTauri()) {
    const workspace = demoWorkspace(path);
    const adoption = readDemoWorkspaceAdoption(path);
    if (adoption) workspace.adoption = adoption;
    const manifestYaml = localStorage.getItem(demoManifestKey(path));
    if (manifestYaml) {
      workspace.manifestExists = true;
      workspace.manifestYaml = manifestYaml;
    }
    rememberDemoProject(path, workspace);
    return workspace;
  }
  return invoke<WorkspacePreview>("open_project", { path });
}

export async function resolveLocalFolderSource(
  path: string,
): Promise<ManagedSourceSnapshot> {
  if (!isTauri()) {
    const workspace = await openProject(path);
    return {
      sourcePath: path,
      managedPath: `/tmp/abcdeploy-demo/${workspace.plan.id}`,
      snapshotId: workspace.plan.id,
      projectName: workspace.inspection.project_name,
      serviceCount: workspace.inspection.services.length,
      httpServiceCount: workspace.inspection.services.filter((service) =>
        ["api", "web", "static"].includes(service.kind),
      ).length,
    };
  }
  return invoke<ManagedSourceSnapshot>("resolve_local_folder_source", { path });
}

export async function createManagedLocalRunWorkspace(
  snapshotId: string,
): Promise<ManagedLocalRunWorkspace> {
  if (!isTauri()) {
    return {
      runId: `demo-${snapshotId}`,
      snapshotId,
      workspacePath: `/tmp/abcdeploy-demo-runs/${snapshotId}`,
    };
  }
  return invoke<ManagedLocalRunWorkspace>(
    "create_managed_local_run_workspace",
    {
      snapshotId,
    },
  );
}

export async function verifyManagedLocalRun(
  runId: string,
): Promise<ManagedLocalEvidenceRound> {
  if (!isTauri()) {
    return {
      runId,
      snapshotId: runId.replace(/^demo-/, ""),
      checkedAtMs: Date.now(),
      services: [
        {
          id: "web",
          running: true,
          url: "http://127.0.0.1:3000",
          reachable: true,
          httpStatus: 200,
        },
      ],
    };
  }
  return invoke<ManagedLocalEvidenceRound>("verify_managed_local_run", {
    runId,
  });
}

export async function continueExistingDeployment(
  path: string,
): Promise<WorkspacePreview> {
  if (!isTauri()) {
    const current = await openProject(path);
    const adoption: WorkspacePreview["adoption"] = {
      ...current.adoption,
      mode: "managed",
      detected: true,
      freshDraft: false,
    };
    writeDemoWorkspaceAdoption(path, adoption);
    return { ...current, adoption };
  }
  return invoke<WorkspacePreview>("continue_existing_deployment", { path });
}

export async function resetProjectDeployment(
  path: string,
): Promise<WorkspacePreview> {
  if (!isTauri()) {
    const current = await openProject(path);
    const adoption: WorkspacePreview["adoption"] = {
      ...current.adoption,
      mode: "fresh",
      detected: current.adoption.detected,
      historyImportAfter: new Date().toISOString(),
      freshDraft: true,
    };
    writeDemoWorkspaceAdoption(path, adoption);
    localStorage.setItem(
      DEMO_RUNS_KEY,
      JSON.stringify(readDemoRuns().filter((run) => run.projectPath !== path)),
    );
    const bindings = readDemoServerBindings();
    delete bindings[demoServerBindingKey(path, "staging")];
    delete bindings[demoServerBindingKey(path, "production")];
    localStorage.setItem(DEMO_SERVER_BINDINGS_KEY, JSON.stringify(bindings));
    return { ...current, adoption };
  }
  return invoke<WorkspacePreview>("reset_project_deployment", { path });
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  if (!isTauri()) return readDemoProjects();
  return invoke<RecentProject[]>("list_recent_projects");
}

export async function relinkProject(
  oldPath: string,
  newPath: string,
): Promise<RelinkProjectResult> {
  if (!isTauri()) {
    const projects = readDemoProjects();
    const project = projects.find((item) => item.path === oldPath);
    if (!project) throw new Error("原项目记录不存在，请重新添加");
    const now = new Date().toISOString();
    localStorage.setItem(
      DEMO_PROJECTS_KEY,
      JSON.stringify(
        projects.map((item) =>
          item.path === oldPath
            ? { ...item, path: newPath, pathExists: true, lastOpenedAt: now }
            : item,
        ),
      ),
    );
    const runs = readDemoRuns().map((run) =>
      run.projectPath === oldPath ? { ...run, projectPath: newPath } : run,
    );
    localStorage.setItem(DEMO_RUNS_KEY, JSON.stringify(runs));
    const oldPrefix = `abcdeploy.setting.project.${encodeURIComponent(oldPath)}.`;
    const newPrefix = `abcdeploy.setting.project.${encodeURIComponent(newPath)}.`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(oldPrefix)) continue;
      const value = localStorage.getItem(key);
      localStorage.removeItem(key);
      index -= 1;
      if (value !== null) {
        localStorage.setItem(
          `${newPrefix}${key.slice(oldPrefix.length)}`,
          value,
        );
      }
    }
    if (localStorage.getItem("abcdeploy.setting.active-project") === oldPath) {
      localStorage.setItem("abcdeploy.setting.active-project", newPath);
    }
    return { path: newPath, name: project.name };
  }
  return invoke<RelinkProjectResult>("relink_project", { oldPath, newPath });
}

export async function listConnections(
  kind?: ConnectionKind,
): Promise<ConnectionResource[]> {
  if (!isTauri()) {
    const cnb = readDemoCnbAccount();
    const cnbCheckedAt = localStorage.getItem(
      "abcdeploy.demo.connection.checked.cnb",
    );
    const tcrCheckedAt = localStorage.getItem(
      "abcdeploy.demo.connection.checked.tcr",
    );
    const namespace = await getAppSetting("registry.tcr.namespace");
    const verifiedEndpoint = await getAppSetting(
      "registry.tcr.v2.verified-endpoint",
    );
    const connections: ConnectionResource[] = [
      {
        id: "connection-cnb-default",
        kind: "source",
        provider: "cnb",
        name: cnb?.connected ? `CNB · ${cnb.displayName}` : "CNB",
        status: cnbCheckedAt
          ? "ready"
          : cnb?.connected
            ? "configured"
            : "needs_authorization",
        lastCheckedAt: cnbCheckedAt,
        capabilities: ["repositories", "builds", "automation"],
        metadata: {
          endpoint: "https://cnb.cool",
          ...(cnb?.username ? { username: cnb.username } : {}),
          ...(cnb?.defaultNamespace ? { namespace: cnb.defaultNamespace } : {}),
        },
      },
      {
        id: "connection-tcr-default",
        kind: "registry",
        provider: "tcr",
        name: "腾讯云 TCR",
        status: tcrCheckedAt
          ? "ready"
          : verifiedEndpoint
            ? "configured"
            : "unknown",
        lastCheckedAt: tcrCheckedAt,
        capabilities: ["push", "pull"],
        metadata: {
          endpoint: verifiedEndpoint || "ccr.ccs.tencentyun.com",
          ...(namespace ? { namespace } : {}),
        },
      },
      ...Array.from(
        new Map(
          Object.values(readDemoServerBindings()).map((server) => [
            server.id,
            server,
          ]),
        ).values(),
      ).map((server): ConnectionResource => ({
        id: `legacy-server:${server.id}`,
        kind: "server",
        provider: "ssh",
        name: server.name,
        status: "configured",
        lastCheckedAt: server.lastCheckedAt,
        capabilities: ["deploy", "healthcheck", "reverse-proxy"],
        metadata: {
          host: server.host,
          user: server.user,
          port: String(server.port),
          ...(server.hostFingerprint
            ? { hostFingerprint: server.hostFingerprint }
            : {}),
        },
      })),
    ];
    return kind
      ? connections.filter((connection) => connection.kind === kind)
      : connections;
  }
  return invoke<ConnectionResource[]>("list_connections", {
    kind: kind ?? null,
  });
}

function deploymentPathsSettingKey(path: string) {
  return `project.${encodeURIComponent(path)}.deployment-paths.v1`;
}

function parseDeploymentPaths(
  value: string | null,
  projectPath: string,
): DeploymentPath[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (candidate): candidate is DeploymentPath =>
          Boolean(candidate) &&
          typeof candidate === "object" &&
          typeof (candidate as DeploymentPath).id === "string" &&
          typeof (candidate as DeploymentPath).name === "string",
      )
      .map((candidate) => ({
        ...candidate,
        projectPath,
        sourceConnectionId: candidate.sourceConnectionId ?? null,
        registryConnectionId: candidate.registryConnectionId ?? null,
        serverId: candidate.serverId ?? null,
        configProfileIds: Array.isArray(candidate.configProfileIds)
          ? candidate.configProfileIds.filter(
              (profileId): profileId is string => typeof profileId === "string",
            )
          : [],
        address: typeof candidate.address === "string" ? candidate.address : "",
        routes: Array.isArray(candidate.routes)
          ? candidate.routes.filter(
              (route): route is DeploymentPath["routes"][number] =>
                Boolean(route) &&
                typeof route === "object" &&
                typeof route.service === "string" &&
                typeof route.host === "string" &&
                typeof route.path === "string",
            )
          : [],
        state: [
          "draft",
          "ready",
          "deploying",
          "online",
          "needs_action",
        ].includes(candidate.state)
          ? candidate.state
          : "draft",
        lastRunId: candidate.lastRunId ?? null,
        currentRunId: candidate.currentRunId ?? null,
        lastSuccessfulRevision: candidate.lastSuccessfulRevision ?? null,
      }));
  } catch {
    return [];
  }
}

/**
 * Deployment paths deliberately live in application state rather than the
 * user's source tree. Only reusable connection ids and project-scoped values
 * are persisted; credentials remain in their existing secure stores.
 */
export async function listDeploymentPaths(
  path: string,
): Promise<DeploymentPath[]> {
  if (isTauri()) {
    return invoke<DeploymentPath[]>("list_deployment_paths", { path });
  }
  return parseDeploymentPaths(
    await getAppSetting(deploymentPathsSettingKey(path)),
    path,
  );
}

export async function saveDeploymentPath(
  input: DeploymentPathInput,
): Promise<DeploymentPath> {
  if (isTauri()) {
    return invoke<DeploymentPath>("save_deployment_path", { input });
  }
  const paths = await listDeploymentPaths(input.projectPath);
  const previous = input.id
    ? paths.find((candidate) => candidate.id === input.id)
    : undefined;
  const now = new Date().toISOString();
  const path: DeploymentPath = {
    id:
      input.id ??
      `path-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    projectPath: input.projectPath,
    name: input.name.trim() || "上线",
    sourceConnectionId: input.sourceConnectionId,
    registryConnectionId: input.registryConnectionId,
    serverId: input.serverId,
    configProfileIds: Array.from(new Set(input.configProfileIds)),
    address: input.address.trim(),
    routes: input.routes.map((route) => ({
      service: route.service.trim(),
      host: route.host.trim(),
      path: route.path.trim() || "/",
    })),
    state: input.state ?? previous?.state ?? "draft",
    lastRunId: input.lastRunId ?? previous?.lastRunId ?? null,
    currentRunId:
      input.state === "online" && input.lastRunId
        ? input.lastRunId
        : (previous?.currentRunId ?? null),
    lastSuccessfulRevision:
      input.lastSuccessfulRevision ?? previous?.lastSuccessfulRevision ?? null,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const next = [...paths.filter((candidate) => candidate.id !== path.id), path];
  next.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await setAppSetting(
    deploymentPathsSettingKey(input.projectPath),
    JSON.stringify(next),
  );
  return path;
}

export async function startLocalPreview(
  path: string,
  developmentMode = false,
): Promise<LocalPreviewStatus> {
  if (!isTauri()) {
    localStorage.setItem(`abcdeploy.demo.local.${path}`, "running");
    localStorage.removeItem(`abcdeploy.demo.local-services.${path}`);
    return demoLocalPreview(path, "running");
  }
  return invoke<LocalPreviewStatus>("start_local_preview", {
    path,
    developmentMode,
  });
}

export async function forgetProject(path: string): Promise<boolean> {
  if (!isTauri()) {
    const projects = readDemoProjects();
    const remaining = projects.filter((project) => project.path !== path);
    localStorage.setItem(DEMO_PROJECTS_KEY, JSON.stringify(remaining));
    return remaining.length !== projects.length;
  }
  return invoke<boolean>("forget_project", { path });
}

export async function saveManifestDraft(
  path: string,
  manifestYaml: string,
): Promise<ApplyResult> {
  if (!isTauri()) {
    localStorage.setItem(demoManifestKey(path), manifestYaml);
    const adoption = readDemoWorkspaceAdoption(path);
    if (adoption?.mode === "fresh" && adoption.freshDraft) {
      writeDemoWorkspaceAdoption(path, { ...adoption, freshDraft: false });
    }
    return {
      planId: "demo-draft-plan",
      writtenFiles: ["deploy.yaml"],
      backupDirectory: `${path}/.deploydesk/backups/demo-draft-plan`,
    };
  }
  return invoke<ApplyResult>("save_manifest_draft", {
    path,
    manifestYaml,
  });
}

export async function checkServer(form: ServerForm): Promise<ProviderCheck> {
  if (!isTauri()) {
    if (form.host && form.user && form.keyPath && !form.hostFingerprint) {
      return {
        provider: "ssh-host-key",
        ok: false,
        summary: "请确认这台服务器的身份指纹",
        details: ["SHA256:ABCDeployDemoServerFingerprint"],
      };
    }
    return {
      provider: "ssh",
      ok: Boolean(form.host && form.user && form.keyPath),
      summary: form.host ? "服务器连接正常" : "请填写服务器信息",
      details: ["未执行远程写操作"],
    };
  }
  return invoke<ProviderCheck>("check_server", {
    name: form.name,
    host: form.host,
    user: form.user,
    keyPath: form.keyPath,
    port: form.port,
    hostFingerprint: form.hostFingerprint,
  });
}

export async function installServerKeyWithPassword(
  form: ServerForm,
  password: string,
): Promise<ProviderCheck> {
  if (!isTauri()) {
    return {
      provider: "ssh",
      ok: Boolean(form.host && form.user && form.keyPath && password),
      summary: password ? "服务器已建立安全连接" : "请填写服务器登录密码",
      details: ["公钥已幂等安装；服务器密码未保存"],
      code: password ? null : "AD-SSH-105",
      nextSteps: password ? [] : ["填写服务器登录密码后重试"],
      retryable: !password,
    };
  }
  return invoke<ProviderCheck>("install_server_key_with_password", {
    name: form.name,
    host: form.host,
    user: form.user,
    keyPath: form.keyPath,
    port: form.port,
    hostFingerprint: form.hostFingerprint,
    password,
  });
}

export async function listServers(): Promise<ServerResource[]> {
  if (!isTauri()) return Object.values(readDemoServerBindings());
  return invoke<ServerResource[]>("list_servers");
}

export async function resolveManagedServerEnvironment(
  serverId: string,
): Promise<ManagedServerEnvironment> {
  if (!isTauri()) {
    const server = Object.values(readDemoServerBindings()).find(
      (candidate) => candidate.id === serverId,
    );
    if (!server) throw new Error("找不到所选服务器");
    return {
      id: `server-env:${server.id}`,
      version: `demo-${server.id}`,
      connectionId: server.id,
      name: server.name,
      host: server.host,
      user: server.user,
      port: server.port,
      platform: "Linux",
      architecture: "x86_64",
      dockerVersion: "demo",
      composeVersion: "demo",
      verifiedAtMs: Date.now(),
    };
  }
  return invoke<ManagedServerEnvironment>(
    "resolve_managed_server_environment",
    {
      serverId,
    },
  );
}

export async function prepareManagedServerEnvironment(
  serverId: string,
): Promise<ManagedServerEnvironment> {
  if (!isTauri()) return resolveManagedServerEnvironment(serverId);
  return invoke<ManagedServerEnvironment>(
    "prepare_managed_server_environment",
    {
      serverId,
    },
  );
}

export async function prepareManagedServerDeployment(
  projectPath: string,
  serverId: string,
  snapshotId: string,
): Promise<PreparedManagedServerDeployment> {
  if (!isTauri()) {
    throw new Error("服务器上线任务只能在桌面客户端中准备");
  }
  return invoke<PreparedManagedServerDeployment>(
    "prepare_managed_server_deployment",
    { projectPath, serverId, snapshotId },
  );
}

export async function projectManagedDeploymentEvidence(
  evidence: unknown,
  nowMs: number,
  online = true,
): Promise<ManagedEvidenceProjection> {
  if (!isTauri()) {
    throw new Error("运行证据只能由桌面客户端验证");
  }
  return invoke<ManagedEvidenceProjection>(
    "project_managed_deployment_evidence",
    {
      evidence,
      nowMs,
      online,
    },
  );
}

export async function bindProjectServer(
  path: string,
  environment: "staging" | "production",
  server: ServerForm,
): Promise<ServerResource> {
  if (!isTauri()) {
    const resource = {
      ...server,
      id: `demo-${server.user}@${server.host}:${server.port}`,
      keyPathExists: true,
      lastCheckedAt: new Date().toISOString(),
    };
    const bindings = readDemoServerBindings();
    bindings[demoServerBindingKey(path, environment)] = resource;
    localStorage.setItem(DEMO_SERVER_BINDINGS_KEY, JSON.stringify(bindings));
    return resource;
  }
  return invoke<ServerResource>("bind_project_server", {
    path,
    environment,
    server,
  });
}

export async function refreshDeployment(runId: string): Promise<DeploymentRun> {
  if (!isTauri()) {
    const runs = readDemoRuns();
    const run = runs.find((item) => item.id === runId);
    if (!run) throw new Error("找不到这次部署记录");
    if (run.status === "running" || run.status === "queued") {
      const updated: DeploymentRun = {
        ...run,
        status: "success",
        currentStage: "complete",
        message:
          run.environment === "production"
            ? "生产环境已按测试通过的同一镜像摘要发布"
            : run.environment === "deployment"
              ? "项目已经上线并通过公网检查"
              : "运行服务器部署完成并通过健康检查",
        completedSteps: [
          "write-config",
          "verify-build",
          "publish-images",
          "prepare-server",
          "deploy",
          "healthcheck",
        ],
        updatedAt: new Date().toISOString(),
      };
      writeDemoRun(updated);
      return updated;
    }
    return run;
  }
  return invoke<DeploymentRun>("refresh_deployment", { runId });
}

export async function listDeploymentRuns(
  path: string,
): Promise<DeploymentRun[]> {
  if (!isTauri())
    return readDemoRuns().filter((run) => run.projectPath === path);
  return invoke<DeploymentRun[]>("list_deployment_runs", { path });
}

export async function listDeploymentPathRuns(
  pathId: string,
  projectPath?: string,
): Promise<DeploymentRun[]> {
  if (!isTauri()) {
    const runs = readDemoRuns();
    return projectPath
      ? runs.filter((run) => run.projectPath === projectPath)
      : runs;
  }
  return invoke<DeploymentRun[]>("list_deployment_path_runs", { pathId });
}

export async function redeployDeploymentPathVersion(
  pathId: string,
  sourceRunId: string,
  projectPath?: string,
): Promise<DeploymentRun> {
  if (isTauri()) {
    return invoke<DeploymentRun>("redeploy_deployment_path_version", {
      pathId,
      sourceRunId,
    });
  }
  if (!projectPath) {
    throw new Error(
      "无法恢复版本：缺少项目位置。当前在线版本没有改变，请重新打开项目后再试。",
    );
  }
  const paths = await listDeploymentPaths(projectPath);
  const path = paths.find((candidate) => candidate.id === pathId);
  const sourceRun = readDemoRuns().find((run) => run.id === sourceRunId);
  if (!path || !sourceRun || sourceRun.status !== "success") {
    throw new Error(
      "无法恢复版本：没有找到完整的历史版本。当前在线版本没有改变，请刷新记录后再试。",
    );
  }
  if (
    !sourceRun.commitSha ||
    sourceRun.artifacts.length === 0 ||
    sourceRun.artifacts.some((artifact) => !artifact.digest.trim())
  ) {
    throw new Error(
      "无法恢复版本：这条历史记录缺少不可变镜像信息。当前在线版本没有改变，请选择其他成功版本。",
    );
  }
  if (path.currentRunId === sourceRun.id) {
    throw new Error("这个版本已经在运行，无需重复恢复。当前在线版本没有改变。");
  }

  const now = new Date().toISOString();
  const restored: DeploymentRun = {
    ...sourceRun,
    id: `restore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    sourceRunId: sourceRun.id,
    sourceTitle: `恢复 ${sourceRun.commitSha.slice(0, 12)}`,
    status: "success",
    currentStage: "complete",
    actionKind: null,
    actionUrl: null,
    issueCode: null,
    message: "历史版本已经恢复并通过验证",
    completedSteps: ["verify-build", "prepare-server", "deploy", "healthcheck"],
    startedAt: now,
    updatedAt: now,
  };
  writeDemoRun(restored);
  await saveDeploymentPath({
    ...path,
    state: "online",
    lastRunId: restored.id,
    currentRunId: restored.id,
    lastSuccessfulRevision: restored.commitSha,
  });
  return restored;
}

export async function listActiveDeploymentRuns(): Promise<DeploymentRun[]> {
  if (!isTauri()) {
    return readDemoRuns().filter((run) =>
      ["queued", "running"].includes(run.status),
    );
  }
  return invoke<DeploymentRun[]>("list_active_deployment_runs");
}

export async function listAttentionDeploymentRuns(): Promise<DeploymentRun[]> {
  if (!isTauri()) {
    const latestByEnvironment = new Map<string, DeploymentRun>();
    for (const run of readDemoRuns()) {
      const key = `${run.projectPath}:${run.environment}`;
      const current = latestByEnvironment.get(key);
      if (!current || run.startedAt > current.startedAt) {
        latestByEnvironment.set(key, run);
      }
    }
    return Array.from(latestByEnvironment.values())
      .filter((run) =>
        ["queued", "running", "needs_action", "failed"].includes(run.status),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  return invoke<DeploymentRun[]>("list_attention_deployment_runs");
}

export async function listRecentSuccessfulDeploymentRuns(): Promise<
  DeploymentRun[]
> {
  if (!isTauri()) {
    const latestByEnvironment = new Map<string, DeploymentRun>();
    for (const run of readDemoRuns()) {
      if (run.status !== "success") continue;
      const key = `${run.projectPath}:${run.environment}`;
      const current = latestByEnvironment.get(key);
      if (!current || run.startedAt > current.startedAt) {
        latestByEnvironment.set(key, run);
      }
    }
    return Array.from(latestByEnvironment.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20);
  }
  return invoke<DeploymentRun[]>("list_recent_successful_deployment_runs");
}

export async function listCurrentDeploymentRuns(): Promise<DeploymentRun[]> {
  if (!isTauri()) {
    const projects = readDemoProjects();
    const paths = (
      await Promise.all(
        projects.map((project) => listDeploymentPaths(project.path)),
      )
    ).flat();
    const currentRunIds = new Set(
      paths.flatMap((path) => (path.currentRunId ? [path.currentRunId] : [])),
    );
    return readDemoRuns()
      .filter((run) => currentRunIds.has(run.id) && run.status === "success")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  return invoke<DeploymentRun[]>("list_current_deployment_runs");
}

export async function checkDeploymentRoutes(
  runId: string,
): Promise<PublicRouteStatus[]> {
  if (!isTauri()) {
    return (
      readDemoRuns()
        .find((run) => run.id === runId)
        ?.routeChecks?.slice() ?? []
    );
  }
  return invoke<PublicRouteStatus[]>("check_deployment_routes", { runId });
}

export async function preparePipelineIdentity(
  path: string,
  server: ServerForm,
): Promise<PipelineIdentityResult> {
  if (!isTauri()) {
    return { created: true, fingerprint: "SHA256:DemoDeployIdentity" };
  }
  return invoke<PipelineIdentityResult>("prepare_pipeline_identity", {
    path,
    server,
  });
}

export async function loadRuntimeConfig(
  path: string,
  environment: RuntimeConfigFile["environment"],
  authorize = false,
): Promise<RuntimeConfigFile> {
  if (!isTauri()) {
    const templateContent = demoRuntimeTemplate(environment);
    const content = readDemoRuntimeConfig(path, environment);
    return {
      environment,
      filename: `.env.${environment}`,
      sourceFiles: [".env.example"],
      content: content ?? templateContent,
      templateContent,
      requiredVariables: ["DATABASE_URL", "APP_SECRET"],
      stored: content !== null,
      authorizationRequired: false,
    };
  }
  return invoke<RuntimeConfigFile>("load_runtime_config", {
    path,
    environment,
    authorize,
  });
}

export async function storeRuntimeConfig(
  path: string,
  environment: RuntimeConfigFile["environment"],
  content: string,
): Promise<RuntimeConfigStatus> {
  if (!isTauri()) {
    writeDemoRuntimeConfig(path, environment, content);
    return { environment, filename: `.env.${environment}`, stored: true };
  }
  return invoke<RuntimeConfigStatus>("store_runtime_config", {
    path,
    environment,
    content,
  });
}

export async function prepareCnbSecretBundle(
  path: string,
  environment: CnbSecretBundle["environment"],
  secretRepository: string,
  server: ServerForm,
): Promise<CnbSecretBundle> {
  if (!isTauri()) {
    const runtimeConfig = readDemoRuntimeConfig(path, environment);
    const prefix = environment.toUpperCase();
    const runtimeLines = (runtimeConfig ?? "")
      .split("\n")
      .map((line) => `  ${line}`);
    return {
      environment,
      filename: `env.${environment}.yml`,
      fileUrl: `https://cnb.cool/${secretRepository}/-/blob/main/env.${environment}.yml`,
      content: [
        "# ABCDeploy demo",
        `${prefix}_SERVER_HOST: ${server.host}`,
        `${prefix}_RUNTIME_ENV_FILE: |-`,
        ...runtimeLines,
        "",
      ].join("\n"),
      missingVariables: runtimeConfig ? [] : ["RUNTIME_ENV_FILE"],
      deployKeyFingerprint: "SHA256:DemoDeployIdentity",
    };
  }
  return invoke<CnbSecretBundle>("prepare_cnb_secret_bundle", {
    path,
    environment,
    secretRepository,
    server,
  });
}

function safeDemoConnectionText(value: unknown, fallback = ""): string {
  return typeof value === "string" &&
    value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : fallback;
}

function readDemoCnbAccount(): CnbAccount | null {
  const stored = localStorage.getItem("abcdeploy.demo.cnb-account");
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Record<string, unknown>;
    const namespaces = Array.isArray(value.namespaces)
      ? value.namespaces.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const namespace = item as Record<string, unknown>;
          const path = safeDemoConnectionText(namespace.path);
          if (!path) return [];
          return [
            {
              path,
              displayName: safeDemoConnectionText(namespace.displayName, path),
              accessRole: safeDemoConnectionText(namespace.accessRole),
              canCreateRepository: namespace.canCreateRepository === true,
            },
          ];
        })
      : [];
    return {
      connected: value.connected === true,
      displayName: safeDemoConnectionText(value.displayName, "CNB"),
      username: safeDemoConnectionText(value.username),
      defaultNamespace: safeDemoConnectionText(value.defaultNamespace),
      namespaces,
    };
  } catch {
    return null;
  }
}

export async function connectCnb(
  token: string,
  persist: boolean,
  repository?: string,
): Promise<CnbAccount> {
  if (!isTauri()) {
    const account: CnbAccount = {
      connected: true,
      displayName: "示例用户",
      username: "cnb.demo-user",
      defaultNamespace: "demo",
      namespaces: [
        {
          path: "demo",
          displayName: "示例组织",
          accessRole: "Owner",
          canCreateRepository: true,
        },
      ],
    };
    if (persist) {
      localStorage.setItem(
        "abcdeploy.demo.cnb-account",
        JSON.stringify(account),
      );
    }
    localStorage.setItem(
      "abcdeploy.demo.connection.checked.cnb",
      new Date().toISOString(),
    );
    return account;
  }
  return invoke("connect_cnb", {
    token,
    persist,
    repository: repository?.trim() || null,
  });
}

export async function getCnbAccount(): Promise<CnbAccount> {
  if (!isTauri()) {
    const stored = readDemoCnbAccount();
    if (stored) return stored;
    return {
      connected: false,
      displayName: "尚未连接",
      username: "",
      defaultNamespace: "",
      namespaces: [],
    };
  }
  return invoke<CnbAccount>("get_cnb_account");
}

export async function ensureCnbRepository(
  slug: string,
  name: string,
): Promise<CnbProjectSetup> {
  if (!isTauri()) {
    return { repository: `${slug}/${name}`, created: true };
  }
  return invoke<CnbProjectSetup>("ensure_cnb_repository", { slug, name });
}

export async function checkCnbSecretRepositoryAccess(
  repository: string,
): Promise<ProviderCheck> {
  if (!isTauri()) {
    return {
      provider: "cnb-secret-repository",
      ok: true,
      summary: "CNB 安全位置可用",
      details: [],
    };
  }
  return invoke<ProviderCheck>("check_cnb_secret_repository_access", {
    repository,
  });
}

export async function syncProjectToCnb(
  path: string,
  repository: string,
  branch: string,
  allowUncommitted = false,
  taskId?: string,
): Promise<SourceSyncResult> {
  if (!isTauri()) {
    return {
      repository,
      branch,
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      committed: true,
    };
  }
  return invoke<SourceSyncResult>("sync_project_to_cnb", {
    path,
    repository,
    branch,
    allowUncommitted,
    taskId: taskId ?? null,
  });
}

const DEMO_PROJECTS_KEY = "abcdeploy.demo.projects";
const DEMO_RUNS_KEY = "abcdeploy.demo.runs";
const DEMO_RUNTIME_CONFIGS_KEY = "abcdeploy.demo.runtime-configs";
const DEMO_SERVER_BINDINGS_KEY = "abcdeploy.demo.server-bindings";
const DEMO_WORKSPACE_ADOPTION_PREFIX = "abcdeploy.demo.workspace-adoption.";

function demoManifestKey(path: string) {
  return `abcdeploy.demo.manifest.${encodeURIComponent(path)}`;
}

function demoWorkspaceAdoptionKey(path: string) {
  return `${DEMO_WORKSPACE_ADOPTION_PREFIX}${encodeURIComponent(path)}`;
}

function readDemoWorkspaceAdoption(
  path: string,
): WorkspacePreview["adoption"] | null {
  try {
    const value = localStorage.getItem(demoWorkspaceAdoptionKey(path));
    return value ? (JSON.parse(value) as WorkspacePreview["adoption"]) : null;
  } catch {
    return null;
  }
}

function writeDemoWorkspaceAdoption(
  path: string,
  adoption: WorkspacePreview["adoption"],
) {
  localStorage.setItem(
    demoWorkspaceAdoptionKey(path),
    JSON.stringify(adoption),
  );
}

function demoServerBindingKey(
  path: string,
  environment: "staging" | "production",
) {
  return `${encodeURIComponent(path)}:${environment}`;
}

function readDemoServerBindings(): Record<string, ServerResource> {
  try {
    const value = JSON.parse(
      localStorage.getItem(DEMO_SERVER_BINDINGS_KEY) ?? "{}",
    ) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, ServerResource>)
      : {};
  } catch {
    return {};
  }
}
function readDemoLocalServices(path: string) {
  try {
    return JSON.parse(
      localStorage.getItem(`abcdeploy.demo.local-services.${path}`) ?? "{}",
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function demoSecretId(path: string, environment: string, variable: string) {
  return `${path}:${environment}:${variable}`;
}

function demoRuntimeTemplate(environment: string) {
  return [
    "# 当前运行环境",
    `DEPLOYDESK_ENV=${environment}`,
    "# 数据库连接地址",
    "DATABASE_URL=",
    "# 应用内部安全密钥",
    "APP_SECRET=",
    "# 项目公开访问地址",
    "PUBLIC_SITE_URL=",
    "# 可选功能开关",
    "OPTIONAL_FEATURE_ENABLED=",
    "",
  ].join("\n");
}

function demoLocalPreview(
  path: string,
  state: LocalPreviewStatus["state"],
): LocalPreviewStatus {
  const running = state === "running";
  const individual = readDemoLocalServices(path);
  return {
    state,
    message: running ? "本地容器均已通过运行检查" : "本地容器预览尚未启动",
    composePath: `${path}/.deploydesk/generated/development/docker-compose.yml`,
    envReady: localStorage.getItem(`abcdeploy.demo.local-env.${path}`) !== null,
    writtenFiles: [],
    services: [
      {
        id: "api",
        kind: "api",
        buildStrategy: "existing",
        dockerfile: "apps/api/Dockerfile",
        hostPort: 3000,
        url: "http://127.0.0.1:3000",
        running: running || Boolean(individual.api),
      },
      {
        id: "admin",
        kind: "static",
        buildStrategy: "existing",
        dockerfile: "apps/admin/Dockerfile",
        hostPort: 4174,
        url: "http://127.0.0.1:4174",
        running: running || Boolean(individual.admin),
      },
    ],
  };
}

function readDemoRuntimeConfig(path: string, environment: string) {
  try {
    const values = JSON.parse(
      localStorage.getItem(DEMO_RUNTIME_CONFIGS_KEY) ?? "{}",
    ) as Record<string, string>;
    return values[demoSecretId(path, environment, "runtime-file")] ?? null;
  } catch {
    return null;
  }
}

function writeDemoRuntimeConfig(
  path: string,
  environment: string,
  content: string,
) {
  const values = JSON.parse(
    localStorage.getItem(DEMO_RUNTIME_CONFIGS_KEY) ?? "{}",
  ) as Record<string, string>;
  values[demoSecretId(path, environment, "runtime-file")] = content;
  localStorage.setItem(DEMO_RUNTIME_CONFIGS_KEY, JSON.stringify(values));
}

function readDemoProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(DEMO_PROJECTS_KEY);
    if (!raw) return [];
    const runs = readDemoRuns();
    return (JSON.parse(raw) as RecentProject[]).map((project) => {
      const projectRuns = runs
        .filter((run) => run.projectPath === project.path)
        .sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        );
      const latest = projectRuns[0];
      return {
        ...project,
        latestStatus: latest?.status ?? project.latestStatus ?? null,
        latestEnvironment:
          latest?.environment ?? project.latestEnvironment ?? null,
        latestMessage: latest?.message ?? project.latestMessage ?? null,
        latestRunId: latest?.id ?? project.latestRunId ?? null,
        latestSourceRunId:
          latest?.sourceRunId ?? project.latestSourceRunId ?? null,
        latestCurrentStage:
          latest?.currentStage ?? project.latestCurrentStage ?? null,
        latestActionKind:
          latest?.actionKind ?? project.latestActionKind ?? null,
        latestIssueCode: latest?.issueCode ?? project.latestIssueCode ?? null,
        latestCompletedSteps:
          latest?.completedSteps ?? project.latestCompletedSteps ?? [],
        latestUpdatedAt: latest?.updatedAt ?? project.latestUpdatedAt ?? null,
        activeRunCount: projectRuns.filter((run) =>
          ["queued", "running"].includes(run.status),
        ).length,
      };
    });
  } catch {
    return [];
  }
}

function rememberDemoProject(path: string, workspace: WorkspacePreview) {
  const projects = readDemoProjects();
  const previous = projects.find((project) => project.path === path);
  const recent: RecentProject = {
    id: previous?.id ?? `demo-${workspace.inspection.project_name}`,
    path,
    name: workspace.inspection.project_name,
    currentStep: previous?.currentStep ?? "inspection",
    manifestExists: workspace.manifestExists,
    serviceCount: workspace.inspection.services.length,
    lastOpenedAt: new Date().toISOString(),
    pathExists: true,
    latestStatus: previous?.latestStatus ?? null,
    latestEnvironment: previous?.latestEnvironment ?? null,
    latestMessage: previous?.latestMessage ?? null,
    latestRunId: previous?.latestRunId ?? null,
    latestSourceRunId: previous?.latestSourceRunId ?? null,
    latestCurrentStage: previous?.latestCurrentStage ?? null,
    latestActionKind: previous?.latestActionKind ?? null,
    latestIssueCode: previous?.latestIssueCode ?? null,
    latestCompletedSteps: previous?.latestCompletedSteps ?? [],
    latestUpdatedAt: previous?.latestUpdatedAt ?? null,
    activeRunCount: previous?.activeRunCount ?? 0,
  };
  localStorage.setItem(
    DEMO_PROJECTS_KEY,
    JSON.stringify([
      recent,
      ...projects.filter((project) => project.path !== path),
    ]),
  );
}

function readDemoRuns(): DeploymentRun[] {
  try {
    const raw = localStorage.getItem(DEMO_RUNS_KEY);
    return raw
      ? (JSON.parse(raw) as DeploymentRun[]).map((run) => ({
          ...run,
          candidateTag: run.candidateTag ?? null,
          artifacts: run.artifacts ?? [],
          issueCode: run.issueCode ?? null,
        }))
      : [];
  } catch {
    return [];
  }
}

function writeDemoRun(run: DeploymentRun) {
  const runs = readDemoRuns();
  const nextRuns = [run, ...runs.filter((item) => item.id !== run.id)];
  localStorage.setItem(DEMO_RUNS_KEY, JSON.stringify(nextRuns));
  const projects = readDemoProjects().map((project) => {
    if (project.path !== run.projectPath) return project;
    return {
      ...project,
      latestStatus: run.status,
      latestEnvironment: run.environment,
      latestMessage: run.message,
      latestRunId: run.id,
      latestSourceRunId: run.sourceRunId,
      latestCurrentStage: run.currentStage,
      latestActionKind: run.actionKind,
      latestIssueCode: run.issueCode,
      latestCompletedSteps: run.completedSteps,
      latestUpdatedAt: run.updatedAt,
      activeRunCount: nextRuns.filter(
        (item) =>
          item.projectPath === project.path &&
          ["queued", "running"].includes(item.status),
      ).length,
    };
  });
  localStorage.setItem(DEMO_PROJECTS_KEY, JSON.stringify(projects));
}

function demoWorkspace(path: string): WorkspacePreview {
  return {
    adoption: {
      mode: "fresh",
      detected: false,
      repository: null,
      pipelineExists: false,
      historyImportAfter: null,
      freshDraft: false,
    },
    manifestExists: false,
    manifestYaml: `version: 1
project:
  name: ecat-energy
source:
  release_branch: main
environments:
  staging:
    target:
      server: staging-server
    branch: null
    domains: []
    secrets_ref: https://cnb.cool/replace-me/secret/-/blob/main/env.staging.yml
  production:
    target:
      server: production-server
    branch: null
    domains: []
    secrets_ref: https://cnb.cool/replace-me/secret/-/blob/main/env.production.yml
providers:
  build:
    kind: cnb
    repository: owner/ecat-energy
  registry:
    kind: cnb
    repository: owner/ecat-energy
  reverse_proxy: caddy
release:
  production_mode: approval
`,
    validation: { valid: true, issues: [] },
    inspection: {
      project_root: path,
      project_name: "ecat-energy",
      package_manager: "pnpm",
      monorepo: true,
      frameworks: [
        {
          framework: "nest_js",
          path: "apps/api",
          confidence: 98,
          evidence: ["依赖 @nestjs/core", "包含构建脚本"],
        },
        {
          framework: "vite",
          path: "apps/admin",
          confidence: 98,
          evidence: ["依赖 vite", "包含构建脚本"],
        },
        {
          framework: "taro",
          path: "apps/miniapp",
          confidence: 98,
          evidence: ["依赖 @tarojs/taro", "包含构建脚本"],
        },
        {
          framework: "prisma",
          path: "prisma/schema.prisma",
          confidence: 100,
          evidence: ["检测到 schema.prisma"],
        },
      ],
      services: [
        {
          id: "api",
          package_name: "@ecat-energy/api",
          path: "apps/api",
          kind: "api",
          framework: "nest_js",
          dockerfile: "apps/api/Dockerfile",
          suggested_port: 3000,
          build_command: "corepack pnpm run build",
          start_command: "corepack pnpm run start:prod",
          dependency_file: "apps/api/package.json",
          confidence: 98,
        },
        {
          id: "admin",
          package_name: "@ecat-energy/admin",
          path: "apps/admin",
          kind: "static",
          framework: "vite",
          dockerfile: "apps/admin/Dockerfile",
          suggested_port: 80,
          build_command: "corepack pnpm run build",
          start_command: null,
          dependency_file: "apps/admin/package.json",
          confidence: 98,
        },
        {
          id: "miniapp",
          package_name: "@ecat-energy/miniapp",
          path: "apps/miniapp",
          kind: "static",
          framework: "taro",
          dockerfile: "apps/miniapp/Dockerfile",
          suggested_port: 80,
          build_command: "corepack pnpm run build",
          start_command: null,
          dependency_file: "apps/miniapp/package.json",
          confidence: 98,
        },
      ],
      prisma_schemas: ["prisma/schema.prisma"],
      dockerfiles: [
        "apps/api/Dockerfile",
        "apps/admin/Dockerfile",
        "apps/miniapp/Dockerfile",
      ],
      environment_files: [".env.example"],
      environment_variables: [
        { name: "DATABASE_URL", secret: true, source: ".env.example" },
        { name: "APP_SECRET", secret: true, source: ".env.example" },
        { name: "PUBLIC_SITE_URL", secret: false, source: ".env.example" },
      ],
      diagnostics: [],
    },
    plan: {
      id: "fb6cbe0ce86dc7ed",
      project: "ecat-energy",
      generated_at: new Date().toISOString(),
      environments: [
        {
          name: "development",
          branch: null,
          target: "本机",
          automatic: false,
          approval_required: false,
        },
        {
          name: "staging",
          branch: "test",
          target: "staging-server",
          automatic: true,
          approval_required: false,
        },
        {
          name: "production",
          branch: "main",
          target: "production-server",
          automatic: false,
          approval_required: true,
        },
      ],
      changes: [
        {
          path: "deploy.yaml",
          kind: "create",
          after: "version: 1\nproject:\n  name: ecat-energy\n",
          sensitive: false,
        },
        {
          path: ".cnb.yml",
          kind: "update",
          before: "main:\n  push: []\n",
          after: "test:\n  push: []\nmain:\n  push: []\n",
          sensitive: false,
        },
        {
          path: ".deploydesk/generated/production/docker-compose.yml",
          kind: "create",
          after:
            "name: ecat-energy-production\nservices:\n  api:\n    image: ${DEPLOYDESK_API_IMAGE}\n",
          sensitive: false,
        },
      ],
      steps: [
        {
          id: "write-config",
          title: "生成部署配置",
          detail: "写入 deploy.yaml、Compose、Caddy 和流水线配置",
          executor: "local",
          destructive: false,
        },
        {
          id: "verify-build",
          title: "验证并构建程序",
          detail: "在 CNB 标准 Linux 环境执行项目验证命令",
          executor: "cnb",
          destructive: false,
        },
        {
          id: "publish-images",
          title: "制作不可变镜像",
          detail: "镜像以提交版本标识",
          executor: "cnb",
          destructive: false,
        },
        {
          id: "deploy",
          title: "部署并验证测试候选",
          detail: "同步配置，按摘要启动容器并等待健康检查",
          executor: "server",
          destructive: false,
        },
        {
          id: "promote-release",
          title: "晋级已验证镜像",
          detail: "为通过测试的摘要创建提交唯一的验证标记",
          executor: "cnb",
          destructive: false,
        },
        {
          id: "healthcheck",
          title: "部署生产并验证访问",
          detail: "生产复用同一摘要；失败时恢复上一个健康版本",
          executor: "server",
          destructive: false,
        },
      ],
      user_actions: [
        {
          id: "connect-cnb",
          title: "连接 CNB",
          detail: "授权后创建或选择云原生构建仓库",
          category: "authorization",
          required: true,
        },
        {
          id: "server-staging",
          title: "连接测试服务器",
          detail: "验证 SSH 登录",
          category: "server",
          required: true,
        },
        {
          id: "domain-staging",
          title: "填写测试域名",
          detail: "生成 DNS 记录并检查解析",
          category: "dns",
          required: false,
        },
        {
          id: "secrets-staging",
          title: "配置运行环境密钥文件",
          detail: "按生成模板在 CNB Web 端填写",
          category: "secret",
          required: true,
        },
        {
          id: "server-production",
          title: "连接生产服务器",
          detail: "验证 SSH 登录",
          category: "server",
          required: true,
        },
        {
          id: "domain-production",
          title: "填写生产域名",
          detail: "生成 DNS 记录并检查解析",
          category: "dns",
          required: true,
        },
        {
          id: "secrets-production",
          title: "配置生产环境密钥文件",
          detail: "按生成模板在 CNB Web 端填写",
          category: "secret",
          required: true,
        },
        {
          id: "approve-production",
          title: "确认发布生产",
          detail: "生产只拉取测试通过的同一镜像摘要",
          category: "approval",
          required: true,
        },
      ],
      warnings: [],
    },
  };
}
