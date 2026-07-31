import { describe, expect, it, vi } from "vitest";
import {
  authorizeServerDeploymentServices,
  completeServerDeploymentAuthorization,
  type ServerDeploymentAuthorizationDependencies,
} from "./server-deployment-authorization";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";

describe("authorizeServerDeploymentServices", () => {
  it("首次授权时自动创建私有代码仓库并补齐约定值", async () => {
    const readyInspection = { issue: null } as ServerDeploymentSetupInspection;
    const dependencies: ServerDeploymentAuthorizationDependencies = {
      connectCnb: vi.fn().mockResolvedValue({
        connected: true,
        defaultNamespace: "owner",
        namespaces: [
          {
            path: "owner",
            canCreateRepository: true,
          },
        ],
      }),
      getCnbAccount: vi.fn().mockResolvedValue({
        connected: true,
        displayName: "测试用户",
        username: "tester",
        defaultNamespace: "owner",
        namespaces: [
          {
            path: "owner",
            displayName: "测试团队",
            accessRole: "Owner",
            canCreateRepository: true,
          },
        ],
      }),
      ensureCnbRepository: vi.fn().mockResolvedValue({
        repository: "owner/sample-store",
        created: true,
      }),
      replaceRegistryCredentials: vi.fn().mockResolvedValue({
        provider: "registry",
        ok: true,
        summary: "可用",
        details: [],
        nextSteps: [],
        retryable: false,
      }),
      setAppSetting: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue({
        manifestYaml:
          "project:\n  name: sample\nenvironments:\n  staging:\n    secrets_ref: https://cnb.cool/replace-me/secret/-/blob/main/env.staging.yml\n  production:\n    secrets_ref: https://cnb.cool/replace-me/secret/-/blob/main/env.production.yml\nproviders:\n  build:\n    repository: owner/replace-me\n  registry:\n    registry: ''\n    namespace: ''\n",
      }),
      saveManifestDraft: vi.fn().mockResolvedValue({}),
      inspectServerDeploymentSetup: vi.fn().mockResolvedValue(readyInspection),
      listServers: vi.fn().mockResolvedValue([
        {
          id: "server-1",
          name: "运行服务器",
          host: "119.91.112.80",
          user: "ubuntu",
          port: 22,
          keyPath: "/tmp/id_ed25519",
        },
      ]),
      preparePipelineIdentity: vi.fn().mockResolvedValue({
        created: true,
        fingerprint: "SHA256:test",
      }),
      prepareCnbSecretBundle: vi.fn().mockResolvedValue({
        environment: "staging",
        filename: "env.sample.staging.yml",
        fileUrl:
          "https://cnb.cool/owner/deploy-secrets/-/blob/main/env.sample.staging.yml",
        content: "STAGING_SERVER_HOST: 119.91.112.80",
        missingVariables: [],
        deployKeyFingerprint: "SHA256:test",
      }),
      checkCnbSecretRepositoryAccess: vi.fn().mockResolvedValue({
        provider: "cnb-secret-repository",
        ok: true,
        summary: "可用",
        details: [],
      }),
    } as never;
    const inspection = {
      projectPath: "/projects/sample",
      projectName: "Sample Store",
      serverId: "server-1",
      needsSourceAuthorization: true,
      needsRegistryAuthorization: true,
    } as ServerDeploymentSetupInspection;

    const result = await authorizeServerDeploymentServices(
      inspection,
      {
        repository: "",
        cnbToken: "secret-cnb-token",
        registryEndpoint: "",
        registryNamespace: "",
        registryUsername: "100000000000",
        registryPassword: "secret-registry-password",
        secretRepository: "",
      },
      dependencies,
    );

    expect(result.inspection).toBe(readyInspection);
    expect(result.repositoryAccessible).toBe(true);
    expect(result.secretHandoffRequired).toBe(true);
    expect(result.bundle.filename).toBe("env.sample.staging.yml");
    expect(dependencies.connectCnb).toHaveBeenCalledWith(
      "secret-cnb-token",
      true,
      undefined,
    );
    expect(dependencies.ensureCnbRepository).toHaveBeenCalledWith(
      "owner",
      "sample-store",
    );
    expect(dependencies.replaceRegistryCredentials).toHaveBeenCalledWith(
      "ccr.ccs.tencentyun.com",
      "registry.tcr.v2",
      "100000000000",
      "secret-registry-password",
      "abcdeploy",
    );
    expect(dependencies.setAppSetting).toHaveBeenCalledWith(
      "cnb.secret-repository",
      "owner/abcdeploy-secrets",
    );
    const savedManifest = vi.mocked(dependencies.saveManifestDraft).mock
      .calls[0]?.[1];
    expect(savedManifest).toContain("repository: owner/sample-store");
    expect(savedManifest).toContain("registry: 'ccr.ccs.tencentyun.com'");
    expect(savedManifest).toContain("namespace: 'abcdeploy'");
    expect(savedManifest).not.toContain("owner/deploy-secrets/-/blob");
    expect(savedManifest).not.toContain("secret-cnb-token");
    expect(savedManifest).not.toContain("secret-registry-password");
  });

  it("已有全局 CNB 连接但项目未配置仓库时自动补齐且不再索要令牌", async () => {
    const dependencies = {
      connectCnb: vi.fn(),
      getCnbAccount: vi.fn().mockResolvedValue({
        connected: true,
        defaultNamespace: "team",
        namespaces: [{ path: "team", canCreateRepository: true }],
      }),
      ensureCnbRepository: vi.fn().mockResolvedValue({
        repository: "team/finagentcrm",
        created: false,
      }),
      replaceRegistryCredentials: vi.fn(),
      setAppSetting: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue({
        manifestYaml:
          "project:\n  name: finagentcrm\nenvironments:\n  staging: {}\n  production: {}\nproviders:\n  build:\n    repository: owner/replace-me\n  registry:\n    registry: ccr.ccs.tencentyun.com\n    namespace: shared\n",
      }),
      saveManifestDraft: vi.fn().mockResolvedValue({}),
      inspectServerDeploymentSetup: vi.fn().mockResolvedValue({ issue: null }),
      listServers: vi
        .fn()
        .mockResolvedValue([
          { id: "server-1", host: "1.2.3.4", user: "ubuntu", port: 22 },
        ]),
      preparePipelineIdentity: vi.fn().mockResolvedValue({}),
      prepareCnbSecretBundle: vi
        .fn()
        .mockResolvedValue({ filename: "env.yml" }),
      checkCnbSecretRepositoryAccess: vi.fn().mockResolvedValue({ ok: false }),
    } as unknown as ServerDeploymentAuthorizationDependencies;

    await authorizeServerDeploymentServices(
      {
        projectPath: "/projects/finagentcrm",
        projectName: "FinAgentCRM",
        serverId: "server-1",
        repository: "owner/replace-me",
        registryEndpoint: "ccr.ccs.tencentyun.com",
        registryNamespace: "shared",
        needsSourceAuthorization: false,
        needsRegistryAuthorization: false,
      } as ServerDeploymentSetupInspection,
      {
        repository: "",
        cnbToken: "",
        registryEndpoint: "",
        registryNamespace: "",
        registryUsername: "",
        registryPassword: "",
        secretRepository: "",
      },
      dependencies,
    );

    expect(dependencies.connectCnb).not.toHaveBeenCalled();
    expect(dependencies.ensureCnbRepository).toHaveBeenCalledWith(
      "team",
      "finagentcrm",
    );
  });

  it("复用连接时会替换项目里的仓库与命名空间占位值，且不重复确认已保存的安全配置", async () => {
    const saveManifestDraft = vi.fn().mockResolvedValue({});
    const dependencies = {
      connectCnb: vi.fn(),
      getCnbAccount: vi.fn().mockResolvedValue({
        connected: true,
        defaultNamespace: "team",
        namespaces: [{ path: "team", canCreateRepository: true }],
      }),
      ensureCnbRepository: vi.fn().mockResolvedValue({
        repository: "team/wxseo",
        created: true,
      }),
      replaceRegistryCredentials: vi.fn(),
      setAppSetting: vi.fn().mockResolvedValue(undefined),
      openProject: vi.fn().mockResolvedValue({
        manifestYaml:
          "project:\n  name: wxseo\nenvironments:\n  staging:\n    secrets_ref: https://cnb.cool/team/abcdeploy-secrets/-/blob/main/env.wxseo.staging.yml\n  production:\n    secrets_ref: https://cnb.cool/team/abcdeploy-secrets/-/blob/main/env.wxseo.production.yml\nproviders:\n  build:\n    repository: owner/wxseo\n  registry:\n    registry: ccr.ccs.tencentyun.com\n    namespace: replace-me\n",
      }),
      saveManifestDraft,
      inspectServerDeploymentSetup: vi.fn().mockResolvedValue({ issue: null }),
      listServers: vi
        .fn()
        .mockResolvedValue([
          { id: "server-1", host: "1.2.3.4", user: "ubuntu", port: 22 },
        ]),
      preparePipelineIdentity: vi.fn().mockResolvedValue({}),
      prepareCnbSecretBundle: vi
        .fn()
        .mockResolvedValue({ filename: "env.wxseo.staging.yml" }),
      checkCnbSecretRepositoryAccess: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as ServerDeploymentAuthorizationDependencies;

    const result = await authorizeServerDeploymentServices(
      {
        projectPath: "/projects/wxseo",
        projectName: "wxseo",
        serverId: "server-1",
        repository: "owner/wxseo",
        registryEndpoint: "ccr.ccs.tencentyun.com",
        registryNamespace: "replace-me",
        secretRepository: "team/abcdeploy-secrets",
        secretReferenceConfigured: true,
        needsSourceAuthorization: false,
        needsRegistryAuthorization: false,
      } as ServerDeploymentSetupInspection,
      {
        repository: "owner/wxseo",
        cnbToken: "",
        registryEndpoint: "ccr.ccs.tencentyun.com",
        registryNamespace: "replace-me",
        registryUsername: "",
        registryPassword: "",
        secretRepository: "team/abcdeploy-secrets",
      },
      dependencies,
    );

    expect(dependencies.ensureCnbRepository).toHaveBeenCalledWith(
      "team",
      "wxseo",
    );
    const savedManifest = saveManifestDraft.mock.calls[0]?.[1];
    expect(savedManifest).toContain("repository: team/wxseo");
    expect(savedManifest).toContain("namespace: abcdeploy");
    expect(savedManifest).not.toContain("owner/wxseo");
    expect(savedManifest).not.toContain("replace-me");
    expect(result.secretHandoffRequired).toBe(false);
  });

  it("仅在用户确认已保存 CNB 安全配置后写入项目引用", async () => {
    const inspectServerDeploymentSetup = vi.fn().mockResolvedValue({
      issue: null,
    });
    const saveManifestDraft = vi.fn().mockResolvedValue({});
    await completeServerDeploymentAuthorization(
      {
        projectPath: "/projects/sample",
        serverId: "server-1",
      } as ServerDeploymentSetupInspection,
      "owner/deploy-secrets",
      {
        openProject: vi.fn().mockResolvedValue({
          manifestYaml:
            "project:\n  name: sample\nenvironments:\n  staging: {}\n  production: {}\n",
        }),
        saveManifestDraft,
        inspectServerDeploymentSetup,
        checkCnbSecretRepositoryAccess: vi.fn().mockResolvedValue({
          provider: "cnb-secret-repository",
          ok: true,
          summary: "可用",
          details: [],
        }),
      },
    );

    const savedManifest = saveManifestDraft.mock.calls[0]?.[1];
    expect(savedManifest).toContain("env.sample.staging.yml");
    expect(savedManifest).toContain("env.sample.production.yml");
    expect(inspectServerDeploymentSetup).toHaveBeenCalledWith(
      "/projects/sample",
      "server-1",
    );
  });

  it("用户确认已保存后不因 CNB 仓库列表延迟而重复进入交接", async () => {
    const inspectServerDeploymentSetup = vi.fn().mockResolvedValue({
      issue: null,
    });
    const saveManifestDraft = vi.fn().mockResolvedValue({});
    const delayedRepositoryCheck = vi.fn().mockResolvedValue({
      provider: "cnb-secret-repository",
      ok: false,
      summary: "列表尚未刷新",
      details: [],
    });

    const result = await completeServerDeploymentAuthorization(
      {
        projectPath: "/projects/sample",
        serverId: "server-1",
      } as ServerDeploymentSetupInspection,
      "owner/deploy-secrets",
      {
        openProject: vi.fn().mockResolvedValue({
          manifestYaml:
            "project:\n  name: sample\nenvironments:\n  staging: {}\n  production: {}\n",
        }),
        saveManifestDraft,
        inspectServerDeploymentSetup,
        checkCnbSecretRepositoryAccess: delayedRepositoryCheck,
      },
    );

    expect(result).toEqual({ issue: null });
    expect(saveManifestDraft).toHaveBeenCalledTimes(1);
    expect(delayedRepositoryCheck).not.toHaveBeenCalled();
  });
});
