import { describe, expect, it, vi } from "vitest";
import type {
  ConnectionResource,
  DeploymentPath,
  ServerResource,
  WorkspacePreview,
} from "../../types";
import {
  ensureServerDeploymentSetup,
  inspectServerDeploymentSetup,
  saveServerDeploymentAddress,
} from "./server-deployment-setup-service";

function connection(
  id: string,
  kind: ConnectionResource["kind"],
): ConnectionResource {
  return {
    id,
    kind,
    provider: kind === "source" ? "cnb" : "tcr",
    name: kind === "source" ? "我的构建服务" : "我的版本仓库",
    status: "ready",
    lastCheckedAt: "2026-07-24T00:00:00Z",
    capabilities: [],
    metadata: {},
  };
}

function workspace(): WorkspacePreview {
  return {
    inspection: {
      project_name: "sample-store",
      services: [
        { id: "api", package_name: "api", kind: "api" },
        { id: "web", package_name: "web", kind: "web" },
        { id: "jobs", package_name: "jobs", kind: "worker" },
      ],
    },
    validation: { valid: true, issues: [] },
    manifestYaml: `
providers:
  build:
    repository: team/sample
  registry:
    registry: ccr.ccs.tencentyun.com
    namespace: sample
environments:
  production:
    domains:
      - app.example.com
`,
  } as unknown as WorkspacePreview;
}

function server(host = "119.91.112.80", id = "server-1"): ServerResource {
  return { id, host } as ServerResource;
}

function path(overrides: Partial<DeploymentPath> = {}): DeploymentPath {
  return {
    id: "path-1",
    projectPath: "/projects/sample",
    name: "上线",
    sourceConnectionId: "source-1",
    registryConnectionId: "registry-1",
    serverId: null,
    configProfileIds: [],
    address: "",
    routes: [],
    state: "draft",
    lastRunId: null,
    currentRunId: null,
    lastSuccessfulRevision: null,
    createdAt: "2026-07-24T00:00:00Z",
    updatedAt: "2026-07-24T00:00:00Z",
    ...overrides,
  };
}

describe("server deployment setup service", () => {
  it("复用版本仓库前验证当前命名空间写权限，失效时回到授权步骤", async () => {
    const savePath = vi.fn();
    const checkRegistryCredentials = vi.fn().mockResolvedValue({
      provider: "registry",
      ok: false,
      summary: "当前登录信息不能向 sample 命名空间保存运行版本",
      details: [],
      code: "AD-REG-201",
      nextSteps: ["更新版本仓库授权"],
      retryable: false,
    });

    const result = await ensureServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue(workspace()),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath,
        checkRegistryCredentials,
      },
    );

    expect(checkRegistryCredentials).toHaveBeenCalledWith(
      "ccr.ccs.tencentyun.com",
      "registry.tcr.v2",
      "sample",
    );
    expect(result.issue).toBe("missing_connections");
    expect(result.needsRegistryAuthorization).toBe(true);
    expect(savePath).not.toHaveBeenCalled();
  });

  it("唯一可用的构建与版本仓库连接会被自动复用，不要求用户重填", async () => {
    const saved = path({
      state: "ready",
      serverId: "server-1",
      address: "app.example.com",
    });
    const savePath = vi.fn().mockResolvedValue(saved);
    const result = await ensureServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue(workspace()),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath,
      },
    );

    expect(result.autoCompleted).toBe(true);
    expect(result.paths).toEqual([saved]);
    expect(savePath).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "/projects/sample",
        name: "上线",
        sourceConnectionId: "source-1",
        registryConnectionId: "registry-1",
        serverId: "server-1",
        state: "ready",
      }),
    );
  });

  it("不会把项目占位值当成完成，并记录安全配置已经由用户确认", async () => {
    const project = workspace();
    const result = await inspectServerDeploymentSetup(
      "/projects/wxseo",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([]),
        listConnections: vi.fn().mockResolvedValue([
          connection("source-1", "source"),
          {
            ...connection("registry-1", "registry"),
            metadata: {
              endpoint: "ccr.ccs.tencentyun.com",
              namespace: "abcdeploy",
            },
          },
        ]),
        openProject: vi.fn().mockResolvedValue({
          ...project,
          manifestYaml: `
providers:
  build:
    repository: owner/wxseo
  registry:
    registry: ccr.ccs.tencentyun.com
    namespace: replace-me
environments:
  staging:
    secrets_ref: https://cnb.cool/team/abcdeploy-secrets/-/blob/main/env.wxseo.staging.yml
`,
        }),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath: vi.fn(),
      },
    );

    expect(result.issue).toBe("incomplete_project");
    expect(result.repository).toBe("");
    expect(result.registryNamespace).toBe("abcdeploy");
    expect(result.secretReferenceConfigured).toBe(true);
  });

  it("已有未完成线路会在原记录上补齐，并保留用户已经设置的内容", async () => {
    const existing = path({
      sourceConnectionId: "source-1",
      registryConnectionId: null,
      address: "custom.example.com",
      configProfileIds: ["config-1"],
    });
    const savePath = vi.fn().mockImplementation(async (input) => ({
      ...existing,
      ...input,
      updatedAt: "2026-07-24T00:01:00Z",
    }));
    const result = await ensureServerDeploymentSetup(
      "/projects/sample",
      "server-2",
      {
        listPaths: vi.fn().mockResolvedValue([existing]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue(workspace()),
        listServers: vi.fn().mockResolvedValue([server(undefined, "server-2")]),
        savePath,
      },
    );

    expect(result.autoCompleted).toBe(true);
    expect(savePath).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "path-1",
        address: "custom.example.com",
        configProfileIds: ["config-1"],
        registryConnectionId: "registry-1",
        serverId: "server-2",
        state: "ready",
      }),
    );
  });

  it("存在多个候选连接时不擅自选择，并提供当前页所需的精简选项", async () => {
    const savePath = vi.fn();
    const result = await inspectServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("source-2", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue(workspace()),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath,
      },
    );

    expect(result.issue).toBe("choose_connections");
    expect(result.sourceOptions).toHaveLength(2);
    expect(result.registryOptions).toHaveLength(1);
    expect(savePath).not.toHaveBeenCalled();
  });

  it("为公网服务生成当前服务器可用的默认地址，后台任务不再因空路由中断", async () => {
    const savePath = vi.fn().mockImplementation(async (input) => ({
      ...path(),
      ...input,
    }));
    const project = workspace();

    const result = await ensureServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([path()]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue({
          ...project,
          manifestYaml: project.manifestYaml.replace(
            /environments:[\s\S]*/,
            "",
          ),
        }),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath,
      },
    );

    expect(result.autoCompleted).toBe(true);
    expect(savePath).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "https://sample-store-web.119-91-112-80.sslip.io",
        routes: [
          {
            service: "web",
            host: "sample-store-web.119-91-112-80.sslip.io",
            path: "/",
          },
          {
            service: "api",
            host: "sample-store-api.119-91-112-80.sslip.io",
            path: "/",
          },
        ],
      }),
    );
  });

  it("服务器已确认不接受临时域名时直接要求填写已备案域名", async () => {
    const savePath = vi.fn();
    const project = workspace();
    const getSetting = vi
      .fn()
      .mockImplementation(async (key: string) =>
        key === "server.server-1.requires-registered-domain" ? "true" : null,
      );

    const result = await inspectServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([path()]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue({
          ...project,
          manifestYaml: project.manifestYaml.replace(
            /environments:[\s\S]*/,
            "",
          ),
        }),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath,
        getSetting,
      },
    );

    expect(getSetting).toHaveBeenCalledWith(
      "server.server-1.requires-registered-domain",
    );
    expect(result.issue).toBe("missing_address");
    expect(result.requiresRegisteredDomain).toBe(true);
    expect(result.defaultRoutes).toEqual([
      { service: "web", host: "", path: "/" },
      { service: "api", host: "", path: "/" },
    ]);
    expect(savePath).not.toHaveBeenCalled();
  });

  it("服务器策略升级后不再复用之前生成的临时域名", async () => {
    const existing = path({
      state: "ready",
      serverId: "server-1",
      address: "https://sample-store-web.119-91-112-80.sslip.io",
      routes: [
        {
          service: "web",
          host: "sample-store-web.119-91-112-80.sslip.io",
          path: "/",
        },
        {
          service: "api",
          host: "sample-store-api.119-91-112-80.sslip.io",
          path: "/",
        },
      ],
    });
    const project = workspace();

    const result = await inspectServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([existing]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue({
          ...project,
          manifestYaml: project.manifestYaml.replace(
            /environments:[\s\S]*/,
            "",
          ),
        }),
        listServers: vi.fn().mockResolvedValue([server()]),
        savePath: vi.fn(),
        getSetting: vi.fn().mockResolvedValue("true"),
      },
    );

    expect(result.issue).toBe("missing_address");
    expect(result.defaultRoutes.every((route) => route.host === "")).toBe(true);
  });

  it("保存用户确认的访问地址时保留既有版本和线路事实", async () => {
    const existing = path({
      state: "needs_action",
      serverId: "server-1",
      lastRunId: "run-1",
      currentRunId: null,
    });
    const savePath = vi.fn().mockImplementation(async (input) => ({
      ...existing,
      ...input,
    }));
    const inspection = await inspectServerDeploymentSetup(
      "/projects/sample",
      "server-1",
      {
        listPaths: vi.fn().mockResolvedValue([existing]),
        listConnections: vi
          .fn()
          .mockResolvedValue([
            connection("source-1", "source"),
            connection("registry-1", "registry"),
          ]),
        openProject: vi.fn().mockResolvedValue(workspace()),
        listServers: vi.fn().mockResolvedValue([]),
        savePath,
      },
    );

    await saveServerDeploymentAddress(
      inspection,
      [{ service: "web", host: "https://app.example.com/path", path: "/" }],
      {
        listPaths: vi.fn(),
        listConnections: vi.fn(),
        openProject: vi.fn(),
        listServers: vi.fn(),
        savePath,
      },
    );

    expect(savePath).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "path-1",
        lastRunId: "run-1",
        currentRunId: null,
        address: "https://app.example.com",
        routes: [{ service: "web", host: "app.example.com", path: "/" }],
      }),
    );
  });
});
