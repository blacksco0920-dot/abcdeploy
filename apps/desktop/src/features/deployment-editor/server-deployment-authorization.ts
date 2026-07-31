import {
  checkCnbSecretRepositoryAccess,
  connectCnb,
  ensureCnbRepository,
  getCnbAccount,
  listServers,
  openProject,
  prepareCnbSecretBundle,
  preparePipelineIdentity,
  saveManifestDraft,
} from "../../api";
import { replaceRegistryCredentials } from "../../api/secrets";
import { setAppSetting } from "../../api/settings";
import {
  updateManifestRegistry,
  updateManifestRepository,
  updateManifestSecretRepository,
} from "../deployment-path/model";
import {
  inspectServerDeploymentSetup,
  type ServerDeploymentSetupInspection,
} from "./server-deployment-setup-service";
import type { CnbSecretBundle } from "../../types";

export interface ServerDeploymentAuthorizationInput {
  repository: string;
  cnbToken: string;
  registryEndpoint: string;
  registryNamespace: string;
  registryUsername: string;
  registryPassword: string;
  secretRepository: string;
}

export interface ServerDeploymentAuthorizationDependencies {
  connectCnb: typeof connectCnb;
  getCnbAccount: typeof getCnbAccount;
  ensureCnbRepository: typeof ensureCnbRepository;
  replaceRegistryCredentials: typeof replaceRegistryCredentials;
  setAppSetting: typeof setAppSetting;
  openProject: typeof openProject;
  saveManifestDraft: typeof saveManifestDraft;
  inspectServerDeploymentSetup: typeof inspectServerDeploymentSetup;
  listServers: typeof listServers;
  preparePipelineIdentity: typeof preparePipelineIdentity;
  prepareCnbSecretBundle: typeof prepareCnbSecretBundle;
  checkCnbSecretRepositoryAccess: typeof checkCnbSecretRepositoryAccess;
}

export interface ServerDeploymentAuthorizationResult {
  inspection: ServerDeploymentSetupInspection;
  bundle: CnbSecretBundle;
  secretRepository: string;
  repositoryAccessible: boolean;
  secretHandoffRequired: boolean;
}

const defaultDependencies: ServerDeploymentAuthorizationDependencies = {
  connectCnb,
  getCnbAccount,
  ensureCnbRepository,
  replaceRegistryCredentials,
  setAppSetting,
  openProject,
  saveManifestDraft,
  inspectServerDeploymentSetup,
  listServers,
  preparePipelineIdentity,
  prepareCnbSecretBundle,
  checkCnbSecretRepositoryAccess,
};

function isRepositoryPath(value: string) {
  return (
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value) &&
    value !== "owner/replace-me"
  );
}

export async function authorizeServerDeploymentServices(
  inspection: ServerDeploymentSetupInspection,
  input: ServerDeploymentAuthorizationInput,
  dependencies: ServerDeploymentAuthorizationDependencies = defaultDependencies,
): Promise<ServerDeploymentAuthorizationResult> {
  const projectSlug = safeProjectSlug(inspection.projectName);
  let repository = input.repository.trim();
  const endpoint = input.registryEndpoint.trim() || "ccr.ccs.tencentyun.com";
  const requestedNamespace = input.registryNamespace.trim();
  const namespace =
    requestedNamespace && requestedNamespace !== "replace-me"
      ? requestedNamespace
      : "abcdeploy";
  let secretRepository = input.secretRepository.trim();
  if (!endpoint || !namespace) {
    throw new Error("请填写版本仓库地址和命名空间");
  }
  let account: Awaited<ReturnType<typeof getCnbAccount>> | undefined;
  if (inspection.needsSourceAuthorization) {
    if (!input.cnbToken.trim()) throw new Error("请填写 CNB 访问令牌");
    account = await dependencies.connectCnb(
      input.cnbToken.trim(),
      true,
      isRepositoryPath(repository) ? repository : undefined,
    );
  }
  if (!isConfiguredRepositoryPath(repository)) {
    account ??= await dependencies.getCnbAccount();
    const cnbNamespace = writableCnbNamespace(account);
    if (!cnbNamespace) {
      throw new Error(
        "当前 CNB 账号没有可创建仓库的团队，请在 CNB 新建团队或让管理员授予创建仓库权限后重试",
      );
    }
    repository = (
      await dependencies.ensureCnbRepository(cnbNamespace, projectSlug)
    ).repository;
    secretRepository ||= `${cnbNamespace}/abcdeploy-secrets`;
  }
  secretRepository ||= `${repository.split("/")[0]}/abcdeploy-secrets`;
  if (!isRepositoryPath(secretRepository)) {
    throw new Error("安全配置保存位置无法自动确定，请重新连接 CNB 后再试");
  }
  if (inspection.needsRegistryAuthorization) {
    if (!input.registryUsername.trim() || !input.registryPassword) {
      throw new Error("请填写版本仓库用户名和访问密码");
    }
    await Promise.all([
      dependencies.setAppSetting("registry.mode", "tcr"),
      dependencies.setAppSetting("registry.tcr.v2.verified-endpoint", endpoint),
      dependencies.setAppSetting("registry.tcr.namespace", namespace),
    ]);
    const checked = await dependencies.replaceRegistryCredentials(
      endpoint,
      "registry.tcr.v2",
      input.registryUsername.trim(),
      input.registryPassword,
      namespace,
    );
    if (!checked.ok) throw new Error(checked.summary);
  }

  await Promise.all([
    dependencies.setAppSetting("registry.mode", "tcr"),
    dependencies.setAppSetting("registry.tcr.v2.verified-endpoint", endpoint),
    dependencies.setAppSetting("registry.tcr.namespace", namespace),
    dependencies.setAppSetting("cnb.secret-repository", secretRepository),
  ]);
  const workspace = await dependencies.openProject(inspection.projectPath);
  const manifest = updateManifestRegistry(
    updateManifestRepository(workspace.manifestYaml, repository),
    endpoint,
    namespace,
  );
  await dependencies.saveManifestDraft(inspection.projectPath, manifest);
  const server = (await dependencies.listServers()).find(
    (candidate) => candidate.id === inspection.serverId,
  );
  if (!server) throw new Error("运行服务器已经变化，请重新选择后再试");
  await dependencies.preparePipelineIdentity(inspection.projectPath, server);
  const [bundle, repositoryCheck, nextInspection] = await Promise.all([
    dependencies.prepareCnbSecretBundle(
      inspection.projectPath,
      "staging",
      secretRepository,
      server,
    ),
    dependencies.checkCnbSecretRepositoryAccess(secretRepository),
    dependencies.inspectServerDeploymentSetup(
      inspection.projectPath,
      inspection.serverId,
    ),
  ]);
  return {
    inspection: nextInspection,
    bundle,
    secretRepository,
    repositoryAccessible: repositoryCheck.ok,
    secretHandoffRequired: !inspection.secretReferenceConfigured,
  };
}

function isConfiguredRepositoryPath(value: string) {
  return isRepositoryPath(value) && !value.startsWith("owner/");
}

function safeProjectSlug(value = "") {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "abcdeploy-project";
}

function writableCnbNamespace(
  account: Awaited<ReturnType<typeof getCnbAccount>>,
) {
  const writable = (account.namespaces ?? []).filter(
    (namespace) => namespace.canCreateRepository,
  );
  return (
    writable.find((namespace) => namespace.path === account.defaultNamespace)
      ?.path ?? writable[0]?.path
  );
}

export async function completeServerDeploymentAuthorization(
  inspection: ServerDeploymentSetupInspection,
  secretRepository: string,
  dependencies: Pick<
    ServerDeploymentAuthorizationDependencies,
    | "openProject"
    | "saveManifestDraft"
    | "inspectServerDeploymentSetup"
    | "checkCnbSecretRepositoryAccess"
  > = defaultDependencies,
) {
  // CNB 密钥仓库不提供文件读取接口，仓库列表在新建后也可能短暂延迟。
  // 用户明确确认网页保存后，只持久化安全配置引用；文件是否可用由真正的
  // CNB 构建验证。这里再次查询仓库既无法验证文件，也会把正确操作困在循环里。
  const workspace = await dependencies.openProject(inspection.projectPath);
  await dependencies.saveManifestDraft(
    inspection.projectPath,
    updateManifestSecretRepository(workspace.manifestYaml, secretRepository),
  );
  return dependencies.inspectServerDeploymentSetup(
    inspection.projectPath,
    inspection.serverId,
  );
}
