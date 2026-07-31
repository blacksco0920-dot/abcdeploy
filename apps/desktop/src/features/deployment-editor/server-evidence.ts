import type {
  DeploymentPathRoute,
  DeploymentRun,
  ManagedEvidenceProjection,
  ManagedServerEnvironment,
  ManagedSourceSnapshot,
} from "../../types";
import { orderedPublicAddresses } from "./public-address";

export function serverEvidenceView(
  run: DeploymentRun,
  environment: ManagedServerEnvironment,
  snapshot: ManagedSourceSnapshot,
  checkedAtMs: number,
  routes: readonly DeploymentPathRoute[] = [],
  nowMs: number = checkedAtMs,
) {
  const routeChecks = run.routeChecks ?? [];
  const runtimeVersions = run.artifacts.filter(hasImmutableImageDigest);
  const runtimeVerified =
    run.artifacts.length > 0 && runtimeVersions.length === run.artifacts.length;
  const { addresses, primaryAddress } = orderedPublicAddresses(
    routeChecks,
    routes,
  );
  const checks = [
    { requirementId: "source", passed: Boolean(run.commitSha) },
    { requirementId: "runtime", passed: runtimeVerified },
    { requirementId: "services", passed: run.artifacts.length > 0 },
    ...routeChecks.map((item) => ({
      requirementId: `public-${item.host}`,
      passed: item.reachable,
    })),
  ];
  const verifiedCurrent = checks.every((item) => item.passed);
  const fresh = verifiedCurrent && nowMs <= checkedAtMs + 5 * 60 * 1_000;
  const projection: ManagedEvidenceProjection = {
    status: verifiedCurrent
      ? fresh
        ? "verified_current"
        : "verified_stale"
      : "verification_failed",
    canShowCurrentSuccess: fresh,
    continuation: verifiedCurrent
      ? fresh
        ? "none"
        : "verification"
      : "investigation",
    preserveEstablishedRuntime: true,
    consecutivePassCount: verifiedCurrent ? 3 : 0,
    stabilityWindowMs: verifiedCurrent ? 10_000 : 0,
    verifiedAtMs: verifiedCurrent ? checkedAtMs : null,
    freshUntilMs: verifiedCurrent ? checkedAtMs + 5 * 60 * 1_000 : null,
    establishedCheckIds: checks
      .filter((item) => item.passed)
      .map((item) => item.requirementId),
    failedCheckIds: checks
      .filter((item) => !item.passed)
      .map((item) => item.requirementId),
    missingCheckIds: [],
    missingRequirementKinds: [],
  };
  return {
    projection,
    sourceIdentity: run.commitSha ?? snapshot.snapshotId,
    runtimeIdentity: runtimeVerified
      ? runtimeVersions
          .map((artifact) => `${artifact.image}@${artifact.digest}`)
          .join(", ")
      : "未取得可验证的镜像版本",
    runtimeVersions,
    environmentLabel: `${environment.name} · ${environment.host}`,
    serviceSummary: `${run.artifacts.length} 个服务已部署并运行`,
    primaryAddress,
    addresses,
    checkedAtLabel: new Date(checkedAtMs).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function hasImmutableImageDigest<T extends { digest: string }>(
  artifact: T,
): artifact is T {
  return /^sha256:[a-f0-9]{64}$/i.test(artifact.digest.trim());
}
