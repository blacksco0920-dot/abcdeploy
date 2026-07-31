import type {
  ManagedEvidenceProjection,
  ManagedLocalEvidenceRound,
  ManagedLocalRunWorkspace,
  ManagedSourceSnapshot,
} from "../../types";
import type {
  DeploymentEvidenceRound,
  DeploymentEvidenceSnapshot,
} from "../deployment-evidence/model";

export function localEvidenceRound(
  snapshot: ManagedSourceSnapshot,
  managedRun: ManagedLocalRunWorkspace,
  round: ManagedLocalEvidenceRound,
): DeploymentEvidenceRound {
  const publicServices = round.services.filter(hasPublicUrl);
  const runningCount = round.services.filter(
    (service) => service.running,
  ).length;
  return {
    checkedAtMs: round.checkedAtMs,
    checks: [
      {
        requirementId: "source",
        kind: "source_identity",
        expected: snapshot.snapshotId,
        actual: round.snapshotId,
        location: "ABCDeploy 受管项目快照",
        passed: round.snapshotId === snapshot.snapshotId,
      },
      {
        requirementId: "runtime",
        kind: "runtime_identity",
        expected: managedRun.runId,
        actual: round.runId,
        location: "这台电脑",
        passed: round.runId === managedRun.runId,
      },
      {
        requirementId: "services",
        kind: "service_health",
        expected: `${round.services.length} 个服务运行`,
        actual: `${runningCount} 个服务运行`,
        location: "这台电脑",
        passed:
          round.services.length > 0 && runningCount === round.services.length,
      },
      ...publicServices.map((service) => ({
        requirementId: `public-${service.id}`,
        kind: "public_access" as const,
        expected: "地址可以访问",
        actual: service.reachable
          ? `HTTP ${service.httpStatus ?? "可访问"}`
          : "地址无法访问",
        location: service.url,
        passed: service.reachable,
      })),
    ],
  };
}

export function localEvidenceSnapshot(
  rounds: readonly DeploymentEvidenceRound[],
): DeploymentEvidenceSnapshot {
  const latest = rounds[rounds.length - 1];
  const publicRequirementIds =
    latest?.checks
      .filter((check) => check.kind === "public_access")
      .map((check) => check.requirementId) ?? [];
  return {
    requirements: [
      { id: "source", kind: "source_identity" },
      { id: "runtime", kind: "runtime_identity" },
      { id: "services", kind: "service_health" },
      ...publicRequirementIds.map((id) => ({
        id,
        kind: "public_access" as const,
      })),
    ],
    rounds,
  };
}

export function localEvidenceView(
  snapshot: ManagedSourceSnapshot,
  managedRun: ManagedLocalRunWorkspace,
  latest: ManagedLocalEvidenceRound,
  projection: ManagedEvidenceProjection,
) {
  const publicServices = latest.services.filter(hasPublicUrl);
  const addresses = Array.from(
    new Set(publicServices.map((service) => service.url).filter(Boolean)),
  );
  return {
    projection,
    sourceIdentity: snapshot.snapshotId,
    runtimeIdentity: managedRun.runId,
    environmentLabel: "这台电脑",
    serviceSummary: `${latest.services.filter((item) => item.running).length}/${latest.services.length} 服务运行`,
    primaryAddress: addresses[0] ?? null,
    addresses,
    checkedAtLabel: new Date(latest.checkedAtMs).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function hasPublicUrl<T extends { url: string | null }>(
  service: T,
): service is T & { url: string } {
  return Boolean(service.url);
}
