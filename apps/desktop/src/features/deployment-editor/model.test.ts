import { describe, expect, it } from "vitest";
import type { ActionChecklistProjection } from "../action-checklist/model";
import type { DeploymentEvidenceProjection } from "../deployment-evidence/model";
import {
  projectDeploymentEditorAction,
  type DeploymentEditorViewModel,
} from "./model";

const checklist = (
  state: ActionChecklistProjection["state"],
  unresolvedActionCount = 0,
): ActionChecklistProjection => ({
  phase: "readiness",
  revisionId: "revision-1",
  state,
  totalActionCount: unresolvedActionCount,
  completedActionCount: 0,
  unresolvedActionCount,
});

const model = (
  overrides: Partial<DeploymentEditorViewModel> = {},
): DeploymentEditorViewModel => ({
  source: {
    kind: "local",
    name: "sample-store",
    path: "/Users/demo/sample-store",
    identity: "local-7f3a9c2",
    serviceCount: 2,
  },
  environment: { kind: "local" },
  checklist: checklist("ready"),
  checklistItems: [],
  systemChecks: [],
  run: { state: "idle", message: "", canCloseClient: false, steps: [] },
  evidence: null,
  ...overrides,
});

const evidence = (
  status: DeploymentEvidenceProjection["status"],
): DeploymentEvidenceProjection => ({
  status,
  canShowCurrentSuccess: status === "verified_current",
  continuation: status === "verified_current" ? "none" : "verification",
  preserveEstablishedRuntime: status !== "verification_failed",
  consecutivePassCount: status === "verified_current" ? 3 : 0,
  stabilityWindowMs: status === "verified_current" ? 10_000 : 0,
  verifiedAtMs: status === "verified_current" ? 20_000 : null,
  freshUntilMs: status === "verified_current" ? 320_000 : null,
  establishedCheckIds: [],
  failedCheckIds: [],
});

describe("projectDeploymentEditorAction", () => {
  it("项目和运行位置未确定时就近说明下一步", () => {
    expect(
      projectDeploymentEditorAction(model({ source: { kind: "none" } })),
    ).toMatchObject({ enabled: false, label: "先选择项目" });
    expect(
      projectDeploymentEditorAction(model({ environment: { kind: "none" } })),
    ).toMatchObject({ enabled: false, label: "再选择运行位置" });
  });

  it("只在完整检查 ready 后提供符合运行位置的主操作", () => {
    expect(
      projectDeploymentEditorAction(
        model({ checklist: checklist("scanning") }),
      ),
    ).toMatchObject({ enabled: false, label: "正在检查" });
    expect(
      projectDeploymentEditorAction(
        model({ checklist: checklist("blocked", 2) }),
      ),
    ).toMatchObject({
      enabled: false,
      label: "完成 2 项待办后可以运行",
    });
    expect(projectDeploymentEditorAction(model())).toMatchObject({
      enabled: true,
      kind: "start_local",
      label: "在本机运行",
    });
    expect(
      projectDeploymentEditorAction(
        model({
          environment: {
            kind: "server",
            serverId: "server-1",
            servers: [],
          },
        }),
      ),
    ).toMatchObject({
      enabled: true,
      kind: "start_server",
      label: "上线到服务器",
    });
  });

  it("系统准备失败提供重试而不是伪造用户待办", () => {
    expect(
      projectDeploymentEditorAction(
        model({ checklist: checklist("check_failed") }),
      ),
    ).toMatchObject({
      enabled: true,
      kind: "retry_checks",
      label: "重试自动检查",
    });
  });

  it("运行中只投射状态，不提供没有实际行为的按钮", () => {
    expect(
      projectDeploymentEditorAction(
        model({
          environment: {
            kind: "server",
            serverId: "server-1",
            servers: [],
          },
          run: {
            state: "running",
            message: "正在启动服务",
            canCloseClient: true,
            steps: [],
          },
        }),
      ),
    ).toMatchObject({
      enabled: false,
      kind: "running_status",
      label: "正在上线",
      explanation: "可以关闭客户端，稍后回来查看",
    });

    expect(
      projectDeploymentEditorAction(
        model({
          environment: { kind: "local" },
          run: {
            state: "running",
            message: "正在启动服务",
            canCloseClient: false,
            steps: [],
          },
        }),
      ),
    ).toMatchObject({
      enabled: false,
      kind: "running_status",
      label: "正在运行",
      explanation: "正在启动服务",
    });
  });

  it("服务已运行但访问失败时只继续验证", () => {
    expect(
      projectDeploymentEditorAction(
        model({
          evidence: {
            projection: evidence("service_running_public_access_blocked"),
            sourceIdentity: "local-7f3a9c2",
            runtimeIdentity: "sha256:abc",
            environmentLabel: "云服务器 A",
            serviceSummary: "2/2 服务健康",
            primaryAddress: "https://shop.example.com",
            addresses: ["https://shop.example.com"],
            checkedAtLabel: "刚刚",
          },
        }),
      ),
    ).toMatchObject({
      enabled: true,
      kind: "recheck_evidence",
      label: "重新检查访问",
    });
  });

  it("只有当前成功证据才能提供打开项目", () => {
    const shared = {
      sourceIdentity: "local-7f3a9c2",
      runtimeIdentity: "process-42",
      environmentLabel: "这台电脑",
      serviceSummary: "2/2 服务健康",
      primaryAddress: "http://127.0.0.1:3000",
      addresses: ["http://127.0.0.1:3000"],
      checkedAtLabel: "刚刚",
    };
    expect(
      projectDeploymentEditorAction(
        model({
          evidence: { ...shared, projection: evidence("verified_current") },
        }),
      ),
    ).toMatchObject({ enabled: true, kind: "open_result", label: "打开网页" });
    expect(
      projectDeploymentEditorAction(
        model({
          evidence: { ...shared, projection: evidence("verified_stale") },
        }),
      ),
    ).toMatchObject({
      enabled: true,
      kind: "recheck_evidence",
      label: "重新检查结果",
    });
  });
});
