import {
  checkSavedRegistryCredentials,
  listConnections,
  listDeploymentPaths,
  listServers,
  openProject,
  saveDeploymentPath,
} from "../../api";
import { getAppSetting } from "../../api/settings";
import type {
  ConnectionResource,
  DeploymentPath,
  DeploymentPathInput,
  DeploymentPathRoute,
  ServerResource,
  ProviderCheck,
  WorkspacePreview,
} from "../../types";
import {
  automaticRouteDrafts,
  connectionReady,
  firstManifestDomain,
  manifestRoutes,
  manifestValue,
  normalizedAddress,
  repositoryConfigured,
} from "../deployment-path/model";
import { secretRepositoryFromManifest } from "../../lib/workspace";

export type ServerDeploymentSetupIssue =
  | "multiple_paths"
  | "incomplete_project"
  | "missing_connections"
  | "choose_connections"
  | "missing_address";

export interface ServerDeploymentSetupOption {
  id: string;
  name: string;
  detail: string;
}

export interface ServerDeploymentSetupInspection {
  paths: DeploymentPath[];
  autoCompleted: boolean;
  issue: ServerDeploymentSetupIssue | null;
  sourceOptions: ServerDeploymentSetupOption[];
  registryOptions: ServerDeploymentSetupOption[];
  serverOptions?: ServerDeploymentSetupOption[];
  selectedSourceConnectionId: string | null;
  selectedRegistryConnectionId: string | null;
  projectPath: string;
  projectName: string;
  serverId: string;
  defaultAddress: string;
  defaultRoutes: DeploymentPathRoute[];
  publicServices: ServerDeploymentSetupOption[];
  repository?: string;
  registryEndpoint?: string;
  registryNamespace?: string;
  secretRepository?: string;
  secretReferenceConfigured?: boolean;
  needsSourceAuthorization?: boolean;
  needsRegistryAuthorization?: boolean;
  requiresRegisteredDomain?: boolean;
}

export function registeredDomainRequirementKey(serverId: string) {
  return `server.${serverId}.requires-registered-domain`;
}

export interface ServerDeploymentSetupDependencies {
  listPaths: (projectPath: string) => Promise<DeploymentPath[]>;
  listConnections: () => Promise<ConnectionResource[]>;
  listServers: () => Promise<ServerResource[]>;
  openProject: (projectPath: string) => Promise<WorkspacePreview>;
  savePath: (input: DeploymentPathInput) => Promise<DeploymentPath>;
  getSetting?: (key: string) => Promise<string | null>;
  checkRegistryCredentials?: (
    registry: string,
    secretPrefix: string,
    namespace?: string,
  ) => Promise<ProviderCheck>;
}

const defaultDependencies: ServerDeploymentSetupDependencies = {
  listPaths: listDeploymentPaths,
  listConnections: () => listConnections(),
  listServers,
  openProject,
  savePath: saveDeploymentPath,
  getSetting: getAppSetting,
  checkRegistryCredentials: checkSavedRegistryCredentials,
};

export async function inspectServerDeploymentSetup(
  projectPath: string,
  serverId: string,
  dependencies: ServerDeploymentSetupDependencies = defaultDependencies,
): Promise<ServerDeploymentSetupInspection> {
  const [
    paths,
    connections,
    workspace,
    servers,
    savedSecretRepository,
    registeredDomainRequirement,
  ] = await Promise.all([
    dependencies.listPaths(projectPath),
    dependencies.listConnections(),
    dependencies.openProject(projectPath),
    dependencies.listServers(),
    dependencies.getSetting?.("cnb.secret-repository") ?? Promise.resolve(null),
    dependencies.getSetting?.(registeredDomainRequirementKey(serverId)) ??
      Promise.resolve(null),
  ]);
  const requiresRegisteredDomain = registeredDomainRequirement === "true";
  const effectivePaths = requiresRegisteredDomain
    ? paths.map(removeTemporaryRoutes)
    : paths;
  const sources = connections.filter(
    (connection) => connection.kind === "source" && connectionReady(connection),
  );
  const registries = connections.filter(
    (connection) =>
      connection.kind === "registry" && connectionReady(connection),
  );
  const current = effectivePaths.length === 1 ? effectivePaths[0] : null;
  const selectedSourceConnectionId = selectedConnectionId(
    current?.sourceConnectionId ?? null,
    sources,
  );
  const selectedRegistryConnectionId = selectedConnectionId(
    current?.registryConnectionId ?? null,
    registries,
  );
  const manifestSecretRepository =
    secretRepositoryFromManifest(workspace, "staging") ||
    secretRepositoryFromManifest(workspace, "production");
  const secretRepository =
    manifestSecretRepository || savedSecretRepository || "";
  const projectReady = deploymentProvidersConfigured(
    workspace,
    secretRepository,
    Boolean(
      manifestValue(workspace.manifestYaml, [
        "environments",
        "staging",
        "secrets_ref",
      ]) ||
      manifestValue(workspace.manifestYaml, [
        "environments",
        "production",
        "secrets_ref",
      ]),
    ),
  );
  const repository = manifestValue(workspace.manifestYaml, [
    "providers",
    "build",
    "repository",
  ]);
  const registryEndpoint = manifestValue(workspace.manifestYaml, [
    "providers",
    "registry",
    "registry",
  ]);
  const registryNamespace = manifestValue(workspace.manifestYaml, [
    "providers",
    "registry",
    "namespace",
  ]);
  const publicServices = workspace.inspection.services
    .filter((service) => service.kind !== "worker")
    .sort(
      (left, right) => servicePriority(left.kind) - servicePriority(right.kind),
    );
  const routeCandidates = routeDrafts(
    workspace,
    publicServices.map((service) => service.id),
  );
  const defaultRoutes = requiresRegisteredDomain
    ? routeCandidates.map(removeTemporaryRoute)
    : automaticRouteDrafts(
        routeCandidates,
        workspace,
        servers.find((server) => server.id === serverId),
      );

  let issue: ServerDeploymentSetupIssue | null = null;
  if (effectivePaths.length > 1) issue = "multiple_paths";
  else if (!projectReady) issue = "incomplete_project";
  else if (sources.length === 0 || registries.length === 0)
    issue = "missing_connections";
  else if (!selectedSourceConnectionId || !selectedRegistryConnectionId)
    issue = "choose_connections";
  else if (
    !routesReady(current?.routes.length ? current.routes : defaultRoutes)
  )
    issue = "missing_address";

  return {
    paths: effectivePaths,
    autoCompleted: false,
    issue,
    sourceOptions: sources.map(connectionOption),
    registryOptions: registries.map(connectionOption),
    serverOptions: servers.map(serverOption),
    selectedSourceConnectionId,
    selectedRegistryConnectionId,
    projectPath,
    projectName: workspace.inspection.project_name,
    serverId,
    defaultAddress: normalizedAddress(
      current?.routes[0]?.host ||
        defaultRoutes[0]?.host ||
        firstManifestDomain(workspace.manifestYaml),
    ),
    defaultRoutes,
    publicServices: publicServices.map((service) => ({
      id: service.id,
      name: service.package_name || service.id,
      detail: service.kind === "api" ? "接口服务" : "网页服务",
    })),
    repository: repositoryConfigured(repository) ? repository : "",
    registryEndpoint:
      registryEndpoint || registries[0]?.metadata.endpoint || "",
    registryNamespace: registryNamespaceConfigured(registryNamespace)
      ? registryNamespace
      : registryNamespaceConfigured(registries[0]?.metadata.namespace || "")
        ? registries[0].metadata.namespace
        : "abcdeploy",
    secretRepository,
    secretReferenceConfigured: Boolean(manifestSecretRepository),
    needsSourceAuthorization: sources.length === 0,
    needsRegistryAuthorization: registries.length === 0,
    requiresRegisteredDomain,
  };
}

function registryNamespaceConfigured(value: string) {
  const namespace = value.trim();
  return Boolean(namespace && namespace !== "replace-me");
}

export async function ensureServerDeploymentSetup(
  projectPath: string,
  serverId: string,
  dependencies: ServerDeploymentSetupDependencies = defaultDependencies,
): Promise<ServerDeploymentSetupInspection> {
  const inspection = await inspectServerDeploymentSetup(
    projectPath,
    serverId,
    dependencies,
  );
  if (
    inspection.selectedRegistryConnectionId &&
    inspection.registryEndpoint &&
    inspection.registryNamespace &&
    dependencies.checkRegistryCredentials
  ) {
    const registryCheck = await dependencies.checkRegistryCredentials(
      inspection.registryEndpoint,
      "registry.tcr.v2",
      inspection.registryNamespace,
    );
    if (!registryCheck.ok) {
      if (
        registryCheck.code === "AD-REG-102" ||
        registryCheck.code === "AD-REG-201"
      ) {
        return {
          ...inspection,
          issue: "missing_connections",
          needsRegistryAuthorization: true,
        };
      }
      throw new Error(registryCheck.summary);
    }
  }
  if (
    inspection.issue ||
    !inspection.selectedSourceConnectionId ||
    !inspection.selectedRegistryConnectionId
  ) {
    return inspection;
  }
  const current = inspection.paths[0];
  const alreadyReady =
    current?.state !== "draft" &&
    current?.sourceConnectionId === inspection.selectedSourceConnectionId &&
    current?.registryConnectionId === inspection.selectedRegistryConnectionId &&
    current?.serverId === serverId &&
    routesReady(current?.routes ?? []);
  if (alreadyReady) return inspection;

  const saved = await saveServerDeploymentSetup(
    inspection,
    inspection.selectedSourceConnectionId,
    inspection.selectedRegistryConnectionId,
    serverId,
    dependencies,
  );
  return { ...inspection, paths: [saved], autoCompleted: true, issue: null };
}

export async function saveServerDeploymentAddress(
  inspection: ServerDeploymentSetupInspection,
  routes: DeploymentPathRoute[],
  dependencies: ServerDeploymentSetupDependencies = defaultDependencies,
): Promise<DeploymentPath> {
  if (!routesReady(routes)) {
    throw new Error("请为每个需要公网访问的服务填写地址");
  }
  const current = inspection.paths.length === 1 ? inspection.paths[0] : null;
  if (inspection.paths.length > 1) {
    throw new Error("当前上线设置已经变化，请重新检查后再试");
  }
  if (
    !inspection.selectedSourceConnectionId ||
    !inspection.selectedRegistryConnectionId
  ) {
    throw new Error("请先选择生成和保存运行版本的服务");
  }
  return dependencies.savePath({
    id: current?.id,
    projectPath: inspection.projectPath,
    name: current?.name || "上线",
    sourceConnectionId: inspection.selectedSourceConnectionId,
    registryConnectionId: inspection.selectedRegistryConnectionId,
    serverId: inspection.serverId,
    configProfileIds: current?.configProfileIds ?? [],
    address: normalizedAddress(routeHost(routes[0].host)),
    routes: routes.map((route) => ({ ...route, host: routeHost(route.host) })),
    state: "ready",
    lastRunId: current?.lastRunId ?? null,
    currentRunId: current?.currentRunId ?? null,
    lastSuccessfulRevision: current?.lastSuccessfulRevision ?? null,
  });
}

export async function saveServerDeploymentSetup(
  inspection: ServerDeploymentSetupInspection,
  sourceConnectionId: string,
  registryConnectionId: string,
  serverId: string,
  dependencies: ServerDeploymentSetupDependencies = defaultDependencies,
): Promise<DeploymentPath> {
  if (
    !inspection.sourceOptions.some(
      (option) => option.id === sourceConnectionId,
    ) ||
    !inspection.registryOptions.some(
      (option) => option.id === registryConnectionId,
    )
  ) {
    throw new Error("所选上线服务已经失效，请重新检查后再试");
  }
  const current = inspection.paths.length === 1 ? inspection.paths[0] : null;
  if (inspection.paths.length > 1) {
    throw new Error("项目存在多套旧上线设置，暂时不能自动合并");
  }
  const serverOptions = inspection.serverOptions ?? [];
  if (
    !serverId ||
    (serverOptions.length > 0 &&
      !serverOptions.some((option) => option.id === serverId))
  ) {
    throw new Error("所选运行服务器已经失效，请重新检查后再试");
  }
  const serverChanged = Boolean(
    current?.serverId && current.serverId !== serverId,
  );
  const retainedRoutes = serverChanged
    ? (current?.routes.filter((route) => !temporaryRouteHost(route.host)) ?? [])
    : (current?.routes ?? []);
  return dependencies.savePath({
    id: current?.id,
    projectPath: inspection.projectPath,
    name: current?.name || "上线",
    sourceConnectionId,
    registryConnectionId,
    serverId,
    configProfileIds: current?.configProfileIds ?? [],
    address: serverChanged
      ? normalizedAddress(retainedRoutes[0]?.host || "")
      : current?.address || inspection.defaultAddress,
    routes: retainedRoutes.length ? retainedRoutes : inspection.defaultRoutes,
    state: "ready",
    lastRunId: current?.lastRunId ?? null,
    currentRunId: current?.currentRunId ?? null,
    lastSuccessfulRevision: current?.lastSuccessfulRevision ?? null,
  });
}

function routeDrafts(workspace: WorkspacePreview, serviceIds: string[]) {
  const declared = manifestRoutes(workspace.manifestYaml);
  if (declared.length > 0) return declared;
  const domain = firstManifestDomain(workspace.manifestYaml);
  return serviceIds.map((service, index) => ({
    service,
    host: index === 0 ? domain : "",
    path: "/",
  }));
}

function routesReady(routes: readonly DeploymentPathRoute[]) {
  return (
    routes.length > 0 && routes.every((route) => Boolean(routeHost(route.host)))
  );
}

function removeTemporaryRoutes(path: DeploymentPath): DeploymentPath {
  const routes = path.routes.map(removeTemporaryRoute);
  return {
    ...path,
    address: temporaryRouteHost(path.address) ? "" : path.address,
    routes,
  };
}

function removeTemporaryRoute(route: DeploymentPathRoute): DeploymentPathRoute {
  return temporaryRouteHost(route.host) ? { ...route, host: "" } : route;
}

function temporaryRouteHost(value: string) {
  const host = routeHost(value).toLowerCase();
  return /(?:^|\.)(?:sslip\.io|nip\.io)$/.test(host);
}

function serverOption(server: ServerResource): ServerDeploymentSetupOption {
  return {
    id: server.id,
    name: server.name,
    detail: `${server.host} · ${server.user}`,
  };
}

function servicePriority(kind: string) {
  if (kind === "web" || kind === "static") return 0;
  return kind === "api" ? 1 : 2;
}

export function routeHost(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

function selectedConnectionId(
  currentId: string | null,
  candidates: readonly ConnectionResource[],
) {
  if (currentId && candidates.some((candidate) => candidate.id === currentId)) {
    return currentId;
  }
  return candidates.length === 1 ? candidates[0].id : null;
}

function connectionOption(
  connection: ConnectionResource,
): ServerDeploymentSetupOption {
  return {
    id: connection.id,
    name: connection.name,
    detail: connection.provider.toUpperCase(),
  };
}

function deploymentProvidersConfigured(
  workspace: WorkspacePreview,
  secretRepository: string,
  declaresRemoteSecrets: boolean,
) {
  const repository = manifestValue(workspace.manifestYaml, [
    "providers",
    "build",
    "repository",
  ]);
  const registry = manifestValue(workspace.manifestYaml, [
    "providers",
    "registry",
    "registry",
  ]);
  const namespace = manifestValue(workspace.manifestYaml, [
    "providers",
    "registry",
    "namespace",
  ]);
  return (
    workspace.validation.valid &&
    repositoryConfigured(repository) &&
    Boolean(registry && namespace) &&
    (!declaresRemoteSecrets || repositoryConfigured(secretRepository))
  );
}
