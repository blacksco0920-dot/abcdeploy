import type { DeploymentPath, DeploymentRun } from "../../types";
import { orderedPublicAddresses } from "../deployment-editor/public-address";

export interface DeploymentHistoryItem {
  run: DeploymentRun;
  current: boolean;
  canRestore: boolean;
}

export interface DeploymentDetailProjection {
  currentRun: DeploymentRun | null;
  latestRun: DeploymentRun | null;
  failedUpdate: DeploymentRun | null;
  primaryAddress: string | null;
  addresses: string[];
  history: DeploymentHistoryItem[];
}

export function projectDeploymentDetail(
  path: DeploymentPath,
  runs: readonly DeploymentRun[],
): DeploymentDetailProjection {
  const history = [...runs].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  const successful = history.filter((run) => run.status === "success");
  const currentRun =
    successful.find((run) => run.id === path.currentRunId) ?? null;
  const latestRun = history[0] ?? null;
  const failedUpdate =
    currentRun &&
    latestRun &&
    latestRun.id !== currentRun.id &&
    latestRun.status !== "success" &&
    Date.parse(latestRun.updatedAt) >= Date.parse(currentRun.updatedAt)
      ? latestRun
      : null;
  const addresses = orderedPublicAddresses(
    currentRun?.routeChecks ?? [],
    path.routes,
  );

  return {
    currentRun,
    latestRun,
    failedUpdate,
    ...addresses,
    history: history.map((run) => ({
      run,
      current: currentRun?.id === run.id,
      canRestore:
        run.status === "success" &&
        currentRun?.id !== run.id &&
        Boolean(run.commitSha) &&
        run.artifacts.length > 0 &&
        run.artifacts.every((artifact) => Boolean(artifact.digest.trim())),
    })),
  };
}
