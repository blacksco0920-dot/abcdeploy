import { beforeEach, describe, expect, it, vi } from "vitest";

describe("browser demo managed infrastructure", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("reads saved settings without inventing missing values", async () => {
    const { getAppSetting, setAppSetting } = await import("./api");
    await setAppSetting("project.demo.scene", "versions");
    await setAppSetting("project.demo.completed-progress", "");

    await expect(getAppSetting("project.demo.scene")).resolves.toBe("versions");
    await expect(getAppSetting("project.demo.completed-progress")).resolves.toBe(
      "",
    );
    await expect(getAppSetting("project.demo.missing")).resolves.toBeNull();
  });

  it("does not expose retired configuration and credential wrappers", async () => {
    const api = await import("./api");
    const retiredExports = [
      "bindConfigProfile",
      "checkRegistryCredentials",
      "deleteConfigProfile",
      "deleteSecret",
      "getAppSettings",
      "getSecretStatus",
      "listConfigProfileBindings",
      "listConfigProfiles",
      "saveConfigProfile",
      "setEnvironmentConfigBindings",
      "storeSecret",
    ];

    expect(
      Object.keys(api)
        .filter((name) => retiredExports.includes(name))
        .sort(),
    ).toEqual([]);
    expect(
      [
        api.replaceRegistryCredentials,
        api.checkSavedRegistryCredentials,
        api.getAppSetting,
        api.setAppSetting,
      ].map((candidate) => typeof candidate),
    ).toEqual(["function", "function", "function", "function"]);
  });

  it("lists stable connection resources and never returns stored credential material", async () => {
    const path = "/demo/connection-resources";
    localStorage.setItem(
      "abcdeploy.demo.cnb-account",
      JSON.stringify({
        connected: true,
        displayName: "示例账号",
        username: "safe-user",
        defaultNamespace: "safe-team",
        namespaces: [],
        token: "cnb-token-sentinel",
        password: "password-sentinel",
        privateKey: "private-key-sentinel",
      }),
    );
    localStorage.setItem(
      "abcdeploy.setting.registry.tcr.namespace",
      "safe-team",
    );
    localStorage.setItem(
      "abcdeploy.setting.registry.tcr.v2.verified-endpoint",
      "ccr.ccs.tencentyun.com",
    );
    localStorage.setItem(
      `abcdeploy.demo.manifest.${encodeURIComponent(path)}`,
      "providers:\n  build: { kind: cnb, repository: demo/sample }\n  registry: { kind: tcr, registry: ccr.ccs.tencentyun.com, namespace: safe-team }\n",
    );

    const { bindProjectServer, listConnections, replaceRegistryCredentials } =
      await import("./api");
    const server = await bindProjectServer(path, "staging", {
      name: "测试服务器",
      host: "203.0.113.51",
      user: "ubuntu",
      port: 22,
      keyPath: "/tmp/private-key-sentinel",
      hostFingerprint: "SHA256:safe-fingerprint",
    });

    const connections = await listConnections();
    expect(connections.map((connection) => connection.id)).toContain(
      `legacy-server:${server.id}`,
    );
    expect(
      connections.find(
        (connection) => connection.id === "connection-cnb-default",
      ),
    ).toMatchObject({
      kind: "source",
      provider: "cnb",
      status: "configured",
      lastCheckedAt: null,
      metadata: {
        endpoint: "https://cnb.cool",
        username: "safe-user",
        namespace: "safe-team",
      },
    });
    expect(
      connections.find(
        (connection) => connection.id === "connection-tcr-default",
      ),
    ).toMatchObject({
      kind: "registry",
      provider: "tcr",
      status: "configured",
      lastCheckedAt: null,
    });
    expect(await listConnections("server")).toHaveLength(1);

    const serialized = JSON.stringify(connections);
    for (const forbidden of [
      "cnb-token-sentinel",
      "password-sentinel",
      "private-key-sentinel",
      "secretRef",
      "keyPath",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await replaceRegistryCredentials(
      "ccr.ccs.tencentyun.com",
      "registry.tcr.v2",
      "safe-user",
      "runtime-password-sentinel",
    );
    expect((await listConnections("registry"))[0]).toMatchObject({
      status: "ready",
    });
    expect(JSON.stringify(await listConnections("registry"))).not.toContain(
      "runtime-password-sentinel",
    );
  });

  it("treats malformed historical connection cache as unconfigured", async () => {
    localStorage.setItem(
      "abcdeploy.demo.cnb-account",
      '{"connected":true,"token":"secret-sentinel"',
    );
    const { listConnections } = await import("./api");

    await expect(listConnections("source")).resolves.toEqual([
      expect.objectContaining({
        id: "connection-cnb-default",
        status: "needs_authorization",
      }),
    ]);
    expect(JSON.stringify(await listConnections())).not.toContain(
      "secret-sentinel",
    );
  });

  it("does not mark incomplete registry credentials as verified", async () => {
    const { replaceRegistryCredentials } = await import("./api");
    const verifiedAtKey = "abcdeploy.demo.connection.checked.tcr";

    await expect(
      replaceRegistryCredentials(
        "ccr.ccs.tencentyun.com",
        "registry.tcr.v2",
        "demo-user",
        "",
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "AD-IMG-201",
    });
    expect(localStorage.getItem(verifiedAtKey)).toBeNull();

    await expect(
      replaceRegistryCredentials(
        "ccr.ccs.tencentyun.com",
        "registry.tcr.v2",
        "demo-user",
        "demo-password",
      ),
    ).resolves.toMatchObject({
      ok: true,
      summary: "镜像仓库登录信息可用",
    });
    const verifiedAt = localStorage.getItem(verifiedAtKey);
    expect(verifiedAt).not.toBeNull();
    expect(new Date(verifiedAt!).toISOString()).toBe(verifiedAt);
    expect(verifiedAt).not.toContain("demo-password");
  });

  it("keeps one recent successful record for each project environment", async () => {
    const base = {
      projectPath: "/demo/history",
      projectName: "history",
      status: "success",
      currentStage: "complete",
      buildSerial: "10",
      commitSha: "0123456789abcdef",
      sourceTitle: "第一版",
      sourceRunId: null,
      candidateTag: null,
      artifacts: [],
      actionKind: null,
      actionUrl: null,
      issueCode: null,
      repository: "demo/history",
      branch: "main",
      message: "已经完成",
      completedSteps: ["healthcheck"],
    };
    localStorage.setItem(
      "abcdeploy.demo.runs",
      JSON.stringify([
        {
          ...base,
          id: "old-staging",
          environment: "staging",
          startedAt: "2026-07-10T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
        },
        {
          ...base,
          id: "new-staging",
          environment: "staging",
          sourceTitle: "第二版",
          startedAt: "2026-07-12T00:00:00Z",
          updatedAt: "2026-07-12T00:00:00Z",
        },
        {
          ...base,
          id: "production",
          environment: "production",
          sourceRunId: "new-staging",
          sourceTitle: "第二版",
          startedAt: "2026-07-13T00:00:00Z",
          updatedAt: "2026-07-13T00:00:00Z",
        },
      ]),
    );

    const { listRecentSuccessfulDeploymentRuns } = await import("./api");
    const runs = await listRecentSuccessfulDeploymentRuns();

    expect(runs.map((run) => run.id)).toEqual(["production", "new-staging"]);
  });

  it("lists the deployment path current run instead of a newer successful attempt", async () => {
    const projectPath = "/demo/current-version";
    const base = {
      projectPath,
      projectName: "current-version",
      environment: "deployment",
      status: "success",
      currentStage: "complete",
      buildSerial: "10",
      commitSha: "0123456789abcdef",
      sourceTitle: "已上线版本",
      sourceRunId: null,
      candidateTag: null,
      artifacts: [],
      actionKind: null,
      actionUrl: null,
      issueCode: null,
      repository: "demo/current-version",
      branch: "main",
      message: "已经完成",
      completedSteps: ["healthcheck"],
    };
    localStorage.setItem(
      "abcdeploy.demo.projects",
      JSON.stringify([
        {
          id: "project-current-version",
          path: projectPath,
          name: "current-version",
          currentStep: "workspace",
          manifestExists: true,
          serviceCount: 1,
          lastOpenedAt: "2026-07-14T00:00:00Z",
          pathExists: true,
          latestStatus: "success",
          latestEnvironment: "deployment",
          latestMessage: "已经完成",
          activeRunCount: 0,
        },
      ]),
    );
    localStorage.setItem(
      "abcdeploy.demo.runs",
      JSON.stringify([
        {
          ...base,
          id: "current-online",
          startedAt: "2026-07-12T00:00:00Z",
          updatedAt: "2026-07-12T00:00:00Z",
        },
        {
          ...base,
          id: "newer-successful-attempt",
          sourceTitle: "较新的成功尝试",
          startedAt: "2026-07-14T00:00:00Z",
          updatedAt: "2026-07-14T00:00:00Z",
        },
      ]),
    );

    const { listCurrentDeploymentRuns, saveDeploymentPath } =
      await import("./api");
    await saveDeploymentPath({
      projectPath,
      name: "上线",
      sourceConnectionId: null,
      registryConnectionId: null,
      serverId: null,
      configProfileIds: [],
      address: "app.example.com",
      routes: [],
      state: "online",
      lastRunId: "current-online",
      lastSuccessfulRevision: "0123456789abcdef",
    });

    const runs = await listCurrentDeploymentRuns();

    expect(runs.map((run) => run.id)).toEqual(["current-online"]);
  });
});
