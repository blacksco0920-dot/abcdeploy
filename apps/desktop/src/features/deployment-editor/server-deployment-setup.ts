import type { DeploymentPath, ServerResource } from "../../types";
import type {
  ActionChecklistItem,
  ActionChecklistRevision,
  ActionChecklistSnapshot,
} from "../action-checklist/model";
import type { ActionChecklistItemView, SavedServerOption } from "./model";

export const SERVER_DEPLOYMENT_SETUP_CHECK_ID = "server-deployment-setup";
const BASE_READINESS_CHECKS = ["source", "environment"] as const;

export type ServerDeploymentSetupIssue =
  "missing" | "incomplete" | "ambiguous" | "address";

export function serverDeploymentSetupIssue(
  paths: readonly DeploymentPath[],
): ServerDeploymentSetupIssue | null {
  if (paths.length === 0) return "missing";
  if (paths.length > 1) return "ambiguous";
  const [path] = paths;
  return path.state === "draft" ||
    !path.sourceConnectionId ||
    !path.registryConnectionId ||
    path.routes.length === 0 ||
    path.routes.some((route) => !route.host.trim())
    ? "incomplete"
    : null;
}

export function serverDeploymentSetupItem(
  issue: ServerDeploymentSetupIssue,
): ActionChecklistItem {
  return {
    id: `${SERVER_DEPLOYMENT_SETUP_CHECK_ID}:${issue}`,
    status: "pending",
  };
}

export function serverDeploymentSetupItemView(
  item: ActionChecklistItem,
): ActionChecklistItemView | null {
  if (!item.id.startsWith(`${SERVER_DEPLOYMENT_SETUP_CHECK_ID}:`)) return null;
  const issue = item.id.slice(SERVER_DEPLOYMENT_SETUP_CHECK_ID.length + 1);
  if (issue === "ambiguous") {
    return {
      id: item.id,
      title: "选择本次使用的上线设置",
      reason:
        "这个项目保存了多套上线方式，系统不能替你猜测。请在当前页面确认本次使用的服务。",
      status: item.status,
      actionLabel: "选择本次上线服务",
    };
  }
  if (issue === "address") {
    return {
      id: item.id,
      title: "设置项目访问地址",
      reason: "上线服务已经准备好，还需要确认项目对外使用的访问地址。",
      status: item.status,
      actionLabel: "设置访问地址",
    };
  }
  return {
    id: item.id,
    title: issue === "incomplete" ? "补全首次上线设置" : "完成首次上线设置",
    reason:
      "系统会优先复用已经保存的上线服务；只有缺失或存在多个选择时才需要你确认。",
    status: item.status,
    actionLabel: "检查上线服务",
  };
}

export function readinessCheckIds(server: boolean) {
  return server
    ? [...BASE_READINESS_CHECKS, SERVER_DEPLOYMENT_SETUP_CHECK_ID]
    : [...BASE_READINESS_CHECKS];
}

export function deploymentReadinessChecklist(
  revision: ActionChecklistRevision,
  server: boolean,
  paths: readonly DeploymentPath[] = [],
  inspectionIssue?: string | null,
): ActionChecklistSnapshot {
  const requiredCheckIds = readinessCheckIds(server);
  const setupIssue = server
    ? inspectionIssue
      ? inspectionIssue === "multiple_paths"
        ? "ambiguous"
        : inspectionIssue === "missing_address"
          ? "address"
          : inspectionIssue === "missing_connections"
            ? "missing"
            : "incomplete"
      : serverDeploymentSetupIssue(paths)
    : null;
  return {
    phase: "readiness",
    revision,
    requiredCheckIds,
    checks: requiredCheckIds.map((id) => ({
      id,
      status:
        id === SERVER_DEPLOYMENT_SETUP_CHECK_ID && setupIssue
          ? "needs_user_action"
          : "passed",
    })),
    items: setupIssue ? [serverDeploymentSetupItem(setupIssue)] : [],
  };
}

export function failedDeploymentReadinessChecklist(
  revision: ActionChecklistRevision,
): ActionChecklistSnapshot {
  const requiredCheckIds = readinessCheckIds(true);
  return {
    phase: "readiness",
    revision,
    requiredCheckIds,
    checks: requiredCheckIds.map((id) => ({
      id,
      status:
        id === SERVER_DEPLOYMENT_SETUP_CHECK_ID ? "system_failed" : "passed",
    })),
    items: [],
  };
}

export function serverOption(server: ServerResource): SavedServerOption {
  return {
    id: server.id,
    name: server.name || server.host,
    detail: `${server.host} · ${server.user}`,
    verified: Boolean(
      server.keyPathExists && server.hostFingerprint && server.lastCheckedAt,
    ),
  };
}

export function inferredFolderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "未命名项目";
}
