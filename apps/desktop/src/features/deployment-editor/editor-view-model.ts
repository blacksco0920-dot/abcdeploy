import { projectActionChecklist } from "../action-checklist/model";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { DeploymentEditorViewModel } from "./model";
import { serverDeploymentSetupItemView } from "./server-deployment-setup";
import type { DeploymentEditorSession } from "./session";

export function editorViewModel(
  session: DeploymentEditorSession,
  systemChecks: readonly string[],
  systemFailure: DeploymentEditorViewModel["systemFailure"],
  services: DeploymentEditorServices,
): DeploymentEditorViewModel {
  return {
    source: session.source,
    sourceResolutionState:
      session.sourceResolutionState === "invalid"
        ? "idle"
        : session.sourceResolutionState,
    sourceResolutionMessage: session.sourceResolutionMessage,
    environment: session.environment,
    checklist: projectActionChecklist(session.checklist),
    checklistItems: session.checklist.items.map(
      (item) =>
        serverDeploymentSetupItemView(item) ?? {
          id: item.id,
          title: "处理运行前待办",
          reason: "系统验证后才会标记为完成",
          status: item.status,
          actionLabel: item.status === "completed" ? null : "处理",
        },
    ),
    systemChecks,
    systemFailure,
    run: session.run,
    evidence: session.evidence,
    serverDeploymentAvailable: Boolean(services.prepareServerDeployment),
  };
}
