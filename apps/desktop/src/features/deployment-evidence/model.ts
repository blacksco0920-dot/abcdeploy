export const REQUIRED_CONSECUTIVE_PASSES = 3;
export const MINIMUM_PASS_INTERVAL_MS = 5_000;
export const MINIMUM_STABILITY_WINDOW_MS = 10_000;
export const EVIDENCE_FRESHNESS_MS = 5 * 60 * 1_000;

export type DeploymentEvidenceCheckKind =
  | "source_identity"
  | "runtime_identity"
  | "service_health"
  | "dependency_health"
  | "public_access";

export interface DeploymentEvidenceRequirement {
  id: string;
  kind: DeploymentEvidenceCheckKind;
}

export interface DeploymentEvidenceCheck {
  requirementId: string;
  kind: DeploymentEvidenceCheckKind;
  expected: string;
  actual: string;
  location: string;
  passed: boolean;
}

export interface DeploymentEvidenceRound {
  checkedAtMs: number;
  checks: readonly DeploymentEvidenceCheck[];
}

export interface DeploymentEvidenceSnapshot {
  requirements: readonly DeploymentEvidenceRequirement[];
  rounds: readonly DeploymentEvidenceRound[];
}

export type DeploymentEvidenceStatus =
  | "verifying"
  | "verified_current"
  | "verified_stale"
  | "offline_historical"
  | "offline_historical"
  | "service_running_public_access_blocked"
  | "verification_failed";

export type DeploymentEvidenceContinuation =
  "none" | "verification" | "investigation";

export interface DeploymentEvidenceProjection {
  status: DeploymentEvidenceStatus;
  canShowCurrentSuccess: boolean;
  continuation: DeploymentEvidenceContinuation;
  preserveEstablishedRuntime: boolean;
  consecutivePassCount: number;
  stabilityWindowMs: number;
  verifiedAtMs: number | null;
  freshUntilMs: number | null;
  establishedCheckIds: string[];
  failedCheckIds: string[];
}

interface EvaluatedRound {
  checkedAtMs: number;
  allPassed: boolean;
  hasMissingCheck: boolean;
  establishedCheckIds: string[];
  failedCheckIds: string[];
  failedPublicCheckIds: string[];
  failedNonPublicCheckIds: string[];
}

export function projectDeploymentEvidence(
  snapshot: DeploymentEvidenceSnapshot,
  nowMs: number,
): DeploymentEvidenceProjection {
  const evaluatedRounds = [...snapshot.rounds]
    .sort((left, right) => left.checkedAtMs - right.checkedAtMs)
    .map((round) => evaluateRound(snapshot.requirements, round));
  const latest = evaluatedRounds[evaluatedRounds.length - 1];
  const stableRounds = stablePassingSuffix(evaluatedRounds);
  const consecutivePassCount = stableRounds.length;
  const stabilityWindowMs =
    consecutivePassCount > 1
      ? stableRounds[consecutivePassCount - 1].checkedAtMs -
        stableRounds[0].checkedAtMs
      : 0;

  const base = {
    consecutivePassCount,
    stabilityWindowMs,
    verifiedAtMs: null,
    freshUntilMs: null,
    establishedCheckIds: latest?.establishedCheckIds ?? [],
    failedCheckIds: latest?.failedCheckIds ?? [],
  };

  if (!latest || snapshot.requirements.length === 0) {
    return {
      ...base,
      status: "verifying",
      canShowCurrentSuccess: false,
      continuation: "verification",
      preserveEstablishedRuntime: false,
    };
  }

  const nonPublicRequirements = snapshot.requirements.filter(
    (requirement) => requirement.kind !== "public_access",
  );
  const allNonPublicChecksEstablished = nonPublicRequirements.every((item) =>
    latest.establishedCheckIds.includes(item.id),
  );
  const hasEstablishedRuntimeChain = (
    ["source_identity", "runtime_identity", "service_health"] as const
  ).every((kind) =>
    snapshot.requirements.some(
      (requirement) =>
        requirement.kind === kind &&
        latest.establishedCheckIds.includes(requirement.id),
    ),
  );
  if (
    latest.failedPublicCheckIds.length > 0 &&
    latest.failedNonPublicCheckIds.length === 0 &&
    allNonPublicChecksEstablished &&
    hasEstablishedRuntimeChain
  ) {
    return {
      ...base,
      status: "service_running_public_access_blocked",
      canShowCurrentSuccess: false,
      continuation: "verification",
      preserveEstablishedRuntime: true,
    };
  }

  if (latest.failedNonPublicCheckIds.length > 0) {
    return {
      ...base,
      status: "verification_failed",
      canShowCurrentSuccess: false,
      continuation: "investigation",
      preserveEstablishedRuntime: false,
    };
  }

  const hasStableEvidence =
    consecutivePassCount >= REQUIRED_CONSECUTIVE_PASSES &&
    stabilityWindowMs >= MINIMUM_STABILITY_WINDOW_MS;
  if (!hasStableEvidence || latest.hasMissingCheck) {
    return {
      ...base,
      status: "verifying",
      canShowCurrentSuccess: false,
      continuation: "verification",
      preserveEstablishedRuntime: latest.establishedCheckIds.length > 0,
    };
  }

  const verifiedAtMs = stableRounds[stableRounds.length - 1].checkedAtMs;
  const freshUntilMs = verifiedAtMs + EVIDENCE_FRESHNESS_MS;
  if (nowMs > freshUntilMs) {
    return {
      ...base,
      status: "verified_stale",
      canShowCurrentSuccess: false,
      continuation: "verification",
      preserveEstablishedRuntime: true,
      verifiedAtMs,
      freshUntilMs,
    };
  }

  return {
    ...base,
    status: "verified_current",
    canShowCurrentSuccess: true,
    continuation: "none",
    preserveEstablishedRuntime: true,
    verifiedAtMs,
    freshUntilMs,
  };
}

function evaluateRound(
  requirements: readonly DeploymentEvidenceRequirement[],
  round: DeploymentEvidenceRound,
): EvaluatedRound {
  const checksById = new Map(
    round.checks.map((check) => [check.requirementId, check] as const),
  );
  const establishedCheckIds: string[] = [];
  const failedCheckIds: string[] = [];
  const failedPublicCheckIds: string[] = [];
  const failedNonPublicCheckIds: string[] = [];
  let hasMissingCheck = false;

  for (const requirement of requirements) {
    const check = checksById.get(requirement.id);
    if (!check || check.kind !== requirement.kind) {
      hasMissingCheck = true;
      continue;
    }
    if (check.passed) {
      establishedCheckIds.push(requirement.id);
      continue;
    }

    failedCheckIds.push(requirement.id);
    if (requirement.kind === "public_access") {
      failedPublicCheckIds.push(requirement.id);
    } else {
      failedNonPublicCheckIds.push(requirement.id);
    }
  }

  return {
    checkedAtMs: round.checkedAtMs,
    allPassed: !hasMissingCheck && failedCheckIds.length === 0,
    hasMissingCheck,
    establishedCheckIds,
    failedCheckIds,
    failedPublicCheckIds,
    failedNonPublicCheckIds,
  };
}

function stablePassingSuffix(rounds: readonly EvaluatedRound[]) {
  const passingSuffix: EvaluatedRound[] = [];
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const round = rounds[index];
    if (!round.allPassed) break;
    passingSuffix.push(round);
  }
  if (passingSuffix.length === 0) return [];

  const spacedNewestFirst = [passingSuffix[0]];
  for (const candidate of passingSuffix.slice(1)) {
    const previous = spacedNewestFirst[spacedNewestFirst.length - 1];
    if (
      previous.checkedAtMs - candidate.checkedAtMs >=
      MINIMUM_PASS_INTERVAL_MS
    ) {
      spacedNewestFirst.push(candidate);
    }
  }
  return spacedNewestFirst.reverse();
}
