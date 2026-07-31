import type {
  ActionChecklistProjection,
  ActionChecklistItemStatus,
} from "../action-checklist/model";
import type { DeploymentEvidenceProjection } from "../deployment-evidence/model";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { DeploymentRun } from "../../types";

export interface CompletedDeployment {
  projectPath: string;
  projectName: string;
  run: DeploymentRun;
}

export type DeploymentEditorMode = "initial" | "update";

export interface DeploymentEditorControllerProps {
  initialLocalPath?: string | null;
  mode?: DeploymentEditorMode;
  onBack: () => void;
  onDeploymentChanged?: (deployment: CompletedDeployment) => void;
  onError: (message: string) => void;
  services?: DeploymentEditorServices;
}

export type ProjectSourceSelection =
  | { kind: "none" }
  | {
      kind: "local";
      name: string;
      path: string;
      identity: string | null;
      serviceCount: number | null;
    }
  | {
      kind: "repository";
      name: string | null;
      repositoryUrl: string;
      repositoryUrlValid: boolean;
      identity: string | null;
      serviceCount: number | null;
    };

export interface SavedServerOption {
  id: string;
  name: string;
  detail: string;
  verified: boolean;
}

export type DeploymentEnvironmentSelection =
  | { kind: "none" }
  | { kind: "local" }
  | {
      kind: "server";
      serverId: string | null;
      servers: readonly SavedServerOption[];
    };

export interface ActionChecklistItemView {
  id: string;
  title: string;
  reason: string;
  status: ActionChecklistItemStatus;
  actionLabel: string | null;
}

export interface DeploymentRunStepView {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  detail: string;
}

export interface DeploymentRunView {
  state: "idle" | "running" | "prepared" | "failed" | "completed";
  message: string;
  canCloseClient: boolean;
  steps: readonly DeploymentRunStepView[];
  progress?: {
    completed: number;
    total: number;
    currentLabel: string;
    elapsedLabel: string;
    updatedLabel: string;
    waitingHint?: string | null;
  } | null;
  details?: readonly { label: string; value: string }[];
  recovery?: {
    title: string;
    message: string;
    preserved: string;
    nextSteps: readonly string[];
    action:
      | "retry"
      | "configure_runtime"
      | "configure_registry"
      | "configure_address"
      | "recheck_address";
    actionLabel: string;
    missingConfigurationVariables?: readonly string[];
  } | null;
}

export interface DeploymentEvidenceView {
  projection: DeploymentEvidenceProjection;
  sourceIdentity: string;
  runtimeIdentity: string;
  runtimeVersions?: readonly {
    service: string;
    image: string;
    digest: string;
  }[];
  environmentLabel: string;
  serviceSummary: string;
  primaryAddress: string | null;
  addresses: readonly string[];
  checkedAtLabel: string;
}

export interface DeploymentAdoptionDecisionView {
  repository: string | null;
  pipelineExists: boolean;
  action: "continue" | "reset" | null;
}

export interface DeploymentEditorViewModel {
  source: ProjectSourceSelection;
  sourceResolutionState?: "idle" | "resolving" | "resolved" | "failed";
  sourceResolutionMessage?: string | null;
  environment: DeploymentEnvironmentSelection;
  checklist: ActionChecklistProjection;
  checklistItems: readonly ActionChecklistItemView[];
  systemChecks: readonly string[];
  systemFailure?: {
    action: "choose_server" | "prepare_runtime" | "reconnect" | "retry";
    actionLabel: string;
    title: string;
    message: string;
  } | null;
  run: DeploymentRunView;
  evidence: DeploymentEvidenceView | null;
  adoptionDecision?: DeploymentAdoptionDecisionView | null;
  serverDeploymentAvailable?: boolean;
}

export type EditorSystemFailure = DeploymentEditorViewModel["systemFailure"];

export type DeploymentEditorActionKind =
  | "none"
  | "start_local"
  | "start_server"
  | "running_status"
  | "retry_checks"
  | "retry_run"
  | "configure_runtime"
  | "configure_registry"
  | "configure_address"
  | "recheck_address"
  | "recheck_evidence"
  | "open_result";

export interface DeploymentEditorAction {
  kind: DeploymentEditorActionKind;
  label: string;
  enabled: boolean;
  explanation: string;
}

export function projectDeploymentEditorAction(
  model: DeploymentEditorViewModel,
): DeploymentEditorAction {
  if (model.evidence) {
    const { projection } = model.evidence;
    if (projection.status === "verified_current") {
      return action(
        "open_result",
        "打开网页",
        true,
        "打开本次部署的主要网页地址",
      );
    }
    if (projection.status === "verified_stale") {
      return action(
        model.environment.kind === "server"
          ? "recheck_address"
          : "recheck_evidence",
        "重新检查结果",
        true,
        "上次结果已经过期，需要重新验证",
      );
    }
    if (projection.status === "offline_historical") {
      return action(
        "recheck_evidence",
        "联网后重新检查",
        true,
        "当前只能显示历史结果，不能声称仍然成功",
      );
    }
    if (projection.status === "service_running_public_access_blocked") {
      return action(
        "recheck_evidence",
        "重新检查访问",
        true,
        "服务仍在运行，只继续检查访问地址",
      );
    }
    if (projection.status === "verification_failed") {
      return action(
        "recheck_evidence",
        "重新验证结果",
        true,
        "运行结果尚未通过验证",
      );
    }
  }

  if (model.run.state === "running") {
    return action(
      "running_status",
      model.environment.kind === "server" ? "正在上线" : "正在运行",
      false,
      model.run.canCloseClient
        ? "可以关闭客户端，稍后回来查看"
        : model.run.message,
    );
  }
  if (model.run.state === "prepared") {
    return action(
      "none",
      "上线任务已准备",
      false,
      "可恢复任务已经保存，但尚未执行，因此还没有上线结果",
    );
  }
  if (model.run.state === "failed") {
    if (
      model.run.recovery?.action === "configure_runtime" ||
      model.run.recovery?.action === "configure_registry" ||
      model.run.recovery?.action === "configure_address" ||
      model.run.recovery?.action === "recheck_address"
    ) {
      return action(
        model.run.recovery.action,
        model.run.recovery.actionLabel,
        true,
        model.run.recovery.message,
      );
    }
    return action(
      "retry_run",
      model.run.recovery?.actionLabel ?? "重试运行",
      true,
      model.run.recovery?.message ?? model.run.message,
    );
  }

  if (model.source.kind === "none") {
    return action("none", "先选择项目", false, "选择后才能检查运行条件");
  }
  if (
    model.source.kind === "repository" &&
    (!model.source.repositoryUrl || !model.source.repositoryUrlValid)
  ) {
    return action(
      "none",
      "填写有效的仓库地址",
      false,
      "地址有效后才能选择运行位置",
    );
  }
  if (model.environment.kind === "none") {
    return action("none", "再选择运行位置", false, "选好后系统会自动检查");
  }
  if (model.environment.kind === "server" && !model.environment.serverId) {
    return action("none", "选择一台服务器", false, "也可以连接一台新服务器");
  }
  if (
    model.environment.kind === "server" &&
    model.serverDeploymentAvailable === false
  ) {
    return action(
      "none",
      "服务器上线暂不可用",
      false,
      "服务器连接可以保存，但当前版本还没有可恢复的服务器上线命令",
    );
  }

  if (
    model.checklist.state === "idle" ||
    model.checklist.state === "scanning"
  ) {
    return action("none", "正在检查", false, "必要检查完成前不能开始");
  }
  if (model.checklist.state === "check_failed") {
    return action(
      "retry_checks",
      "重试自动检查",
      true,
      "系统准备没有完成，已填写的内容会保留",
    );
  }
  if (model.checklist.state === "blocked") {
    return action(
      "none",
      `完成 ${model.checklist.unresolvedActionCount} 项待办后可以${model.environment.kind === "local" ? "运行" : "上线"}`,
      false,
      "处理后系统会自动验证",
    );
  }

  return model.environment.kind === "local"
    ? action("start_local", "在本机运行", true, "运行前会再次确认项目内容")
    : action("start_server", "上线到服务器", true, "上线前会再次确认项目内容");
}

function action(
  kind: DeploymentEditorActionKind,
  label: string,
  enabled: boolean,
  explanation: string,
): DeploymentEditorAction {
  return { kind, label, enabled, explanation };
}
