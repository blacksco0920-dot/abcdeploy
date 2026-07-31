import { describe, expect, it } from "vitest";
import type { DeploymentPath } from "../../types";
import {
  deploymentReadinessChecklist,
  serverDeploymentSetupIssue,
  serverDeploymentSetupItemView,
} from "./server-deployment-setup";

const revision = {
  id: "revision-1",
  sourceVersion: "source-1",
  environmentVersion: "server-1",
  configurationVersion: "configuration-1",
};

function path(overrides: Partial<DeploymentPath> = {}): DeploymentPath {
  return {
    id: "path-1",
    projectPath: "/projects/sample",
    name: "上线",
    sourceConnectionId: "source-1",
    registryConnectionId: "registry-1",
    serverId: "server-1",
    configProfileIds: [],
    address: "",
    routes: [],
    state: "ready",
    lastRunId: null,
    currentRunId: null,
    lastSuccessfulRevision: null,
    createdAt: "2026-07-24T00:00:00Z",
    updatedAt: "2026-07-24T00:00:00Z",
    ...overrides,
  };
}

describe("server deployment setup readiness", () => {
  it("区分未设置、未完成、多套冲突和唯一可复用设置", () => {
    expect(serverDeploymentSetupIssue([])).toBe("missing");
    expect(serverDeploymentSetupIssue([path({ state: "draft" })])).toBe(
      "incomplete",
    );
    expect(
      serverDeploymentSetupIssue([path({ registryConnectionId: null })]),
    ).toBe("incomplete");
    expect(serverDeploymentSetupIssue([path(), path({ id: "path-2" })])).toBe(
      "ambiguous",
    );
    expect(serverDeploymentSetupIssue([path()])).toBe("incomplete");
    expect(
      serverDeploymentSetupIssue([
        path({
          address: "https://app.example.com",
          routes: [{ service: "web", host: "app.example.com", path: "/" }],
        }),
      ]),
    ).toBeNull();
  });

  it("把首次设置缺口投影成可操作待办，不伪装为系统已就绪", () => {
    const checklist = deploymentReadinessChecklist(revision, true, []);
    expect(checklist.checks).toContainEqual({
      id: "server-deployment-setup",
      status: "needs_user_action",
    });
    const view = serverDeploymentSetupItemView(checklist.items[0]);
    expect(view).toMatchObject({
      title: "完成首次上线设置",
      actionLabel: "检查上线服务",
    });
  });

  it("把只差访问地址的状态说明为设置地址，而不是重复检查上线服务", () => {
    const checklist = deploymentReadinessChecklist(
      revision,
      true,
      [],
      "missing_address",
    );
    const view = serverDeploymentSetupItemView(checklist.items[0]);
    expect(view).toMatchObject({
      title: "设置项目访问地址",
      actionLabel: "设置访问地址",
    });
  });
});
