import type {
  ManagedServerEnvironment,
  ManagedSourceSnapshot,
} from "../../types";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import { serverEvidenceView } from "./server-evidence";
import { serverDeploymentRunView } from "./run-view";

export async function recheckServerDeploymentAddress(
  services: DeploymentEditorServices,
  projectPath: string,
  runId: string,
  environment: ManagedServerEnvironment,
  snapshot: ManagedSourceSnapshot,
  routes = [] as Parameters<typeof serverEvidenceView>[4],
) {
  if (
    !services.checkServerDeploymentRoutes ||
    !services.getServerDeploymentRun
  ) {
    throw new Error("访问地址检查能力尚未就绪；服务和已生成版本都已保留");
  }
  await services.checkServerDeploymentRoutes(runId);
  const run = await services.getServerDeploymentRun(projectPath, runId);
  if (!run) throw new Error("没有读取到当前上线任务；服务和已生成版本都已保留");
  const now = services.now();
  return {
    run: serverDeploymentRunView(run, now),
    evidence:
      run.status === "success"
        ? serverEvidenceView(run, environment, snapshot, now, routes)
        : null,
  };
}
