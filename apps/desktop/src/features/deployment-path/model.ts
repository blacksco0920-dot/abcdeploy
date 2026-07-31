import { parseDocument } from "yaml";
import type {
  ConnectionResource,
  DeploymentPath,
  DeploymentPathRoute,
  DeploymentRun,
  ServerResource,
  WorkspacePreview,
} from "../../types";

export type PathNode = "local" | "build" | "registry" | "server";
export type NodeTone = "ready" | "waiting" | "working" | "error";

export const PATH_NODE_ORDER: PathNode[] = [
  "local",
  "build",
  "registry",
  "server",
];

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isPreparedDeploymentRetry(run?: DeploymentRun) {
  return Boolean(
    run?.status === "needs_action" &&
    run.actionKind === "deployment-path-retry" &&
    !run.issueCode,
  );
}

export function isResumableDeploymentRetry(run?: DeploymentRun) {
  return (
    run?.status === "needs_action" &&
    run.actionKind === "deployment-path-retry" &&
    run.currentStage === "deploy" &&
    run.artifacts.length > 0
  );
}

export function manifestValue(
  yaml: string,
  path: Array<string | number>,
): string {
  try {
    const value = parseDocument(yaml).getIn(path);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function updateManifestRepository(yaml: string, repository: string) {
  const document = parseDocument(yaml);
  document.setIn(["source", "repository"], repository);
  document.setIn(["providers", "build", "repository"], repository);
  return document.toString();
}

export function updateManifestRegistry(
  yaml: string,
  endpoint: string,
  namespace: string,
) {
  const document = parseDocument(yaml);
  document.setIn(["providers", "registry", "registry"], endpoint);
  document.setIn(["providers", "registry", "namespace"], namespace);
  return document.toString();
}

export function updateManifestSecretRepository(
  yaml: string,
  repository: string,
) {
  const document = parseDocument(yaml);
  const projectName = String(
    document.getIn(["project", "name"]) || "project",
  ).trim();
  for (const environment of ["staging", "production"] as const) {
    document.setIn(
      ["environments", environment, "secrets_ref"],
      `https://cnb.cool/${repository}/-/blob/main/env.${projectName}.${environment}.yml`,
    );
  }
  return document.toString();
}

export function repositoryConfigured(value: string) {
  const repository = value.trim();
  return (
    repository.includes("/") &&
    !repository.includes("replace-me") &&
    !repository.startsWith("owner/")
  );
}

export function firstManifestDomain(yaml: string) {
  try {
    const document = parseDocument(yaml);
    for (const environment of ["production", "staging"]) {
      const domains = document.getIn(["environments", environment, "domains"]);
      if (Array.isArray(domains)) {
        const first = domains.find((domain) => typeof domain === "string");
        if (typeof first === "string") return first;
      }
    }
  } catch {
    // The local-project node owns malformed manifest reporting.
  }
  return "";
}

export function manifestRoutes(yaml: string): DeploymentPathRoute[] {
  try {
    const value = parseDocument(yaml).toJS() as {
      environments?: Record<string, { domains?: unknown }>;
    };
    for (const environment of ["production", "staging"]) {
      const domains = value.environments?.[environment]?.domains;
      if (!Array.isArray(domains) || domains.length === 0) continue;
      return domains.flatMap((route) => {
        if (!route || typeof route !== "object") return [];
        const record = route as Record<string, unknown>;
        if (
          typeof record.service !== "string" ||
          typeof record.host !== "string"
        ) {
          return [];
        }
        return [
          {
            service: record.service,
            host: record.host,
            path: typeof record.path === "string" ? record.path : "/",
          },
        ];
      });
    }
  } catch {
    // Manifest validation owns malformed YAML reporting.
  }
  return [];
}

export function normalizedAddress(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function deploymentSlug(value: string, fallback: string, maxLength: number) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength) || fallback
  );
}

export function automaticRouteDrafts(
  routes: DeploymentPathRoute[],
  workspace: WorkspacePreview,
  server: Pick<ServerResource, "host"> | undefined,
) {
  const octets = server?.host.trim().split(".").map(Number);
  if (
    !octets ||
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return routes;
  }
  const project = deploymentSlug(
    workspace.inspection.project_name,
    "project",
    30,
  );
  const address = octets.join("-");
  return routes.map((route) => ({
    ...route,
    host:
      route.host.trim() ||
      `${project}-${deploymentSlug(route.service, "app", 20)}.${address}.sslip.io`,
  }));
}

export function connectionReady(connection: ConnectionResource | undefined) {
  return Boolean(
    connection && ["ready", "configured"].includes(connection.status),
  );
}

export function connectionNeedsRepair(
  connection: ConnectionResource | undefined,
) {
  return Boolean(
    connection && ["needs_authorization", "error"].includes(connection.status),
  );
}

export function connectionProviderLabel(connection: ConnectionResource) {
  if (connection.provider.toLowerCase() === "cnb") return "CNB";
  if (connection.provider.toLowerCase() === "tcr") return "腾讯云 TCR";
  return connection.provider.toUpperCase();
}

export function runProblemNode(
  run: DeploymentRun | undefined,
): PathNode | null {
  if (!run || !["failed", "needs_action"].includes(run.status)) return null;
  if (["local", "prepare", "sync-source"].includes(run.currentStage)) {
    return "local";
  }
  if (["build", "trigger-build"].includes(run.currentStage)) return "build";
  if (run.currentStage === "registry") return "registry";
  return "server";
}

const STAGE_NODE: Record<string, PathNode> = {
  local: "local",
  prepare: "local",
  "prepare-config": "local",
  "sync-source": "local",
  "snapshot-source": "local",
  "write-config": "local",
  build: "build",
  "cloud-setup": "build",
  "trigger-build": "build",
  "verify-build": "build",
  publish: "registry",
  "publish-images": "registry",
  registry: "registry",
  complete: "server",
  deploy: "server",
  healthcheck: "server",
  "prepare-server": "server",
  server: "server",
  "verify-release": "server",
};

export function taskNode(run: DeploymentRun | undefined): PathNode | null {
  if (!run) return null;
  return STAGE_NODE[run.currentStage] ?? null;
}

export function projectedTaskTone(
  run: DeploymentRun | undefined,
  node: PathNode,
): NodeTone | null {
  if (!run || run.status === "success") return null;
  if (
    !["queued", "running", "needs_action", "failed", "cancelled"].includes(
      run.status,
    )
  ) {
    return null;
  }
  const current = taskNode(run);
  if (!current) return null;
  const currentIndex = PATH_NODE_ORDER.indexOf(current);
  const nodeIndex = PATH_NODE_ORDER.indexOf(node);
  if (nodeIndex < currentIndex) return "ready";
  if (nodeIndex > currentIndex) return "waiting";
  return ["queued", "running"].includes(run.status) ? "working" : "error";
}

export function taskStatusLabel(node: PathNode, tone: NodeTone) {
  if (tone === "working") {
    return {
      local: "正在读取项目",
      build: "正在构建版本",
      registry: "正在保存版本",
      server: "正在部署服务",
    }[node];
  }
  if (tone === "error") {
    return {
      local: "项目读取受阻",
      build: "版本构建受阻",
      registry: "版本保存受阻",
      server: "服务部署受阻",
    }[node];
  }
  if (tone === "ready") return "本阶段已完成";
  return {
    local: "等待读取项目",
    build: "等待构建版本",
    registry: "等待保存版本",
    server: "等待部署服务",
  }[node];
}

export function deploymentPathStateLabel(state: DeploymentPath["state"]) {
  return {
    deploying: "上线中",
    draft: "尚未配置",
    needs_action: "需要处理",
    online: "已上线",
    ready: "可以上线",
  }[state];
}

export function displayedDeploymentPathState(
  state: DeploymentPath["state"],
  run: Pick<DeploymentRun, "status"> | undefined,
  allReady: boolean,
): DeploymentPath["state"] {
  if (run && ["queued", "running"].includes(run.status)) return "deploying";
  if (state === "deploying" && run?.status === "success") return "online";
  if (
    state === "deploying" &&
    run &&
    ["failed", "needs_action", "cancelled"].includes(run.status)
  ) {
    return "needs_action";
  }
  if (state === "draft" && allReady && !run) return "ready";
  return state;
}

export function deploymentRunStatusLabel(status: DeploymentRun["status"]) {
  return {
    cancelled: "已取消",
    failed: "上线失败",
    needs_action: "等待处理",
    queued: "等待上线",
    running: "正在上线",
    success: "上线成功",
  }[status];
}

export function deploymentStageLabel(stage: string) {
  if (
    [
      "local",
      "prepare",
      "prepare-config",
      "snapshot-source",
      "sync-source",
      "write-config",
    ].includes(stage)
  ) {
    return "读取本地项目";
  }
  if (
    ["build", "cloud-setup", "trigger-build", "verify-build"].includes(stage)
  ) {
    return "生成可运行版本";
  }
  if (["publish", "publish-images", "registry"].includes(stage)) {
    return "保存上线版本";
  }
  if (["prepare-server", "server"].includes(stage)) {
    return "准备运行服务器";
  }
  if (stage === "deploy") return "启动项目服务";
  if (["healthcheck", "verify-release"].includes(stage)) {
    return "检查服务可用性";
  }
  if (["complete", "completed"].includes(stage)) return "已完成";
  return "处理中";
}

export function needsFreshLocalSnapshot(run: DeploymentRun | undefined) {
  if (!run || run.status !== "needs_action") return false;
  if (
    !["local", "prepare", "sync-source", "build", "trigger-build"].includes(
      run.currentStage,
    )
  ) {
    return false;
  }
  return (
    run.issueCode === "AD-GIT-102" ||
    run.actionKind === "deployment-path-source-retry" ||
    run.message.includes("本地项目快照") ||
    run.message.includes("重新开始上线")
  );
}
