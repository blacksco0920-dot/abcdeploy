import { issueFromUnknown } from "../../lib/errors";
import type { ManagedServerEnvironment } from "../../types";

export type ServerRecoveryAction =
  "choose_server" | "prepare_runtime" | "reconnect" | "retry";

export interface ServerReadinessFailure {
  action: ServerRecoveryAction;
  actionLabel: string;
  message: string;
  title: string;
}

export function serverReadinessFailure(error: unknown): ServerReadinessFailure {
  const issue = issueFromUnknown(error, "服务器没有验证完成");
  const code = messageOf(error).match(/AD-ENV-\d{3}/)?.[0] ?? "";
  if (["AD-ENV-202", "AD-ENV-203", "AD-ENV-205"].includes(code)) {
    return {
      action: "reconnect",
      actionLabel: "重新连接服务器",
      title: "需要重新连接服务器",
      message: `${issue.message} 项目选择和其他配置已保留。`,
    };
  }
  if (code === "AD-ENV-207") {
    return {
      action: "prepare_runtime",
      actionLabel: "自动准备服务器",
      title: "服务器还没有运行环境",
      message: `${issue.message} ABCDeploy 可以自动安装并启动所需环境。`,
    };
  }
  if (messageOf(error).includes("AD-SRV-")) {
    return {
      action: "prepare_runtime",
      actionLabel: "重试自动准备",
      title: issue.title,
      message: `${issue.message} 已完成的连接和项目选择均已保留。`,
    };
  }
  if (code === "AD-ENV-201" || code === "AD-ENV-209") {
    return {
      action: "choose_server",
      actionLabel: "选择其他服务器",
      title: issue.title,
      message: `${issue.message} 项目选择和其他配置已保留。`,
    };
  }
  return {
    action: "retry",
    actionLabel: "重新检查服务器",
    title: issue.title,
    message: `${issue.message} 项目和服务器选择已保留，服务器没有改动。`,
  };
}

export async function resolveServerReadiness({
  onPreparing,
  prepareRuntime,
  resolveEnvironment,
  serverId,
}: {
  onPreparing: () => void;
  prepareRuntime: (serverId: string) => Promise<ManagedServerEnvironment>;
  resolveEnvironment: (serverId: string) => Promise<ManagedServerEnvironment>;
  serverId: string;
}): Promise<ManagedServerEnvironment> {
  try {
    return await resolveEnvironment(serverId);
  } catch (error) {
    if (serverReadinessFailure(error).action !== "prepare_runtime") throw error;
    onPreparing();
    return prepareRuntime(serverId);
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
