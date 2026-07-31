import type {
  ManagedServerEnvironment,
  ManagedSourceSnapshot,
} from "../../types";
import type { RestoredServerDeployment } from "./deployment-editor-services";
import type { SavedServerOption } from "./model";
import { serverOption } from "./server-deployment-setup";
import { serverEvidenceView } from "./server-evidence";
import { serverDeploymentRunView } from "./run-view";

export function restoredServerDeploymentState(
  restored: RestoredServerDeployment,
  snapshot: ManagedSourceSnapshot,
  nowMs: number,
  savedServers: readonly SavedServerOption[] = [],
) {
  const checkedAtMs = Date.parse(restored.run.updatedAt);
  const environment: ManagedServerEnvironment = {
    id: `restored-${restored.server.id}`,
    version: `restored-${restored.run.updatedAt}`,
    connectionId: restored.server.id,
    name: restored.server.name,
    host: restored.server.host,
    user: restored.server.user,
    port: restored.server.port,
    platform: "Linux",
    architecture: "",
    dockerVersion: "",
    composeVersion: "",
    verifiedAtMs: Number.isFinite(checkedAtMs) ? checkedAtMs : nowMs,
  };
  return {
    environment,
    server: serverOption(restored.server),
    servers: [
      serverOption(restored.server),
      ...savedServers.filter((item) => item.id !== restored.server.id),
    ],
    pathId: restored.path.id,
    runId: restored.run.id,
    run: serverDeploymentRunView(restored.run, nowMs),
    evidence: serverEvidenceView(
      restored.run,
      environment,
      snapshot,
      Number.isFinite(checkedAtMs) ? checkedAtMs : nowMs,
      restored.path.routes,
      nowMs,
    ),
  };
}
