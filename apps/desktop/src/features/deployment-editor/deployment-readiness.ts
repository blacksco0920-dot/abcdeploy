import type { ManagedSourceSnapshot } from "../../types";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import {
  deploymentReadinessChecklist,
  readinessCheckIds,
} from "./server-deployment-setup";
import type { DeploymentEditorSession } from "./session";

export async function inspectDeploymentReadiness(
  state: DeploymentEditorSession,
  revisionId: string,
  snapshot: ManagedSourceSnapshot | null,
  serverId: string | null,
  ensureSetup: DeploymentEditorServices["ensureServerDeploymentSetup"],
) {
  const server = state.environment.kind === "server";
  const revision = { id: revisionId, ...state.revisionInputs };
  const setup =
    server && snapshot && serverId
      ? await ensureSetup(snapshot.sourcePath, serverId)
      : null;
  return {
    setup,
    revision,
    requiredCheckIds: readinessCheckIds(server),
    checklist: deploymentReadinessChecklist(
      revision,
      server,
      setup?.paths ?? [],
      setup?.issue,
    ),
    systemChecks: [
      "项目已经读取并固定当前内容",
      state.environment.kind === "local"
        ? "这台电脑可以接收本次运行"
        : "服务器连接已经验证",
      ...(setup?.autoCompleted ? ["已自动复用保存的上线服务"] : []),
    ],
  };
}
