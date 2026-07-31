export type ActionChecklistPhase = "readiness" | "verification";

export type ActionChecklistState =
  "idle" | "scanning" | "blocked" | "ready" | "check_failed";

export type ActionChecklistCheckStatus =
  "pending" | "running" | "passed" | "needs_user_action" | "system_failed";

export type ActionChecklistItemStatus =
  "pending" | "checking" | "completed" | "still_blocked";

export interface ActionChecklistRevisionInputs {
  sourceVersion: string;
  environmentVersion: string;
  configurationVersion: string;
}

export interface ActionChecklistRevision extends ActionChecklistRevisionInputs {
  id: string;
}

export interface ActionChecklistCheck {
  id: string;
  status: ActionChecklistCheckStatus;
}

export interface ActionChecklistItem {
  id: string;
  status: ActionChecklistItemStatus;
}

export interface ActionChecklistSnapshot {
  phase: ActionChecklistPhase;
  revision: ActionChecklistRevision | null;
  requiredCheckIds: readonly string[];
  checks: readonly ActionChecklistCheck[];
  items: readonly ActionChecklistItem[];
}

export interface ActionChecklistProjection {
  phase: ActionChecklistPhase;
  revisionId: string | null;
  state: ActionChecklistState;
  totalActionCount: number;
  completedActionCount: number;
  unresolvedActionCount: number;
}

export type DeploymentStartGateReason =
  | "ready"
  | "idle"
  | "scanning"
  | "blocked"
  | "check_failed"
  | "stale_revision"
  | "verification_phase";

export interface DeploymentStartGate {
  canStart: boolean;
  reason: DeploymentStartGateReason;
  checklistState: ActionChecklistState;
  revisionId: string | null;
  unresolvedActionCount: number;
}

const NON_TERMINAL_CHECK_STATUSES = new Set<ActionChecklistCheckStatus>([
  "pending",
  "running",
]);

export function projectActionChecklist(
  snapshot: ActionChecklistSnapshot,
): ActionChecklistProjection {
  const totalActionCount = snapshot.items.length;
  const completedActionCount = snapshot.items.filter(
    (item) => item.status === "completed",
  ).length;
  const unresolvedActionCount = totalActionCount - completedActionCount;

  const base = {
    phase: snapshot.phase,
    revisionId: snapshot.revision?.id ?? null,
    totalActionCount,
    completedActionCount,
    unresolvedActionCount,
  };

  if (!snapshot.revision) {
    return { ...base, state: "idle" };
  }

  const checksById = new Map(
    snapshot.checks.map((check) => [check.id, check] as const),
  );
  const requiredChecks = snapshot.requiredCheckIds.map((id) =>
    checksById.get(id),
  );
  const hasIncompleteCheck = requiredChecks.some(
    (check) => !check || NON_TERMINAL_CHECK_STATUSES.has(check.status),
  );

  if (hasIncompleteCheck) {
    return { ...base, state: "scanning" };
  }

  if (requiredChecks.some((check) => check?.status === "system_failed")) {
    return { ...base, state: "check_failed" };
  }

  const hasUserActionResult = requiredChecks.some(
    (check) => check?.status === "needs_user_action",
  );
  if (hasUserActionResult || unresolvedActionCount > 0) {
    return { ...base, state: "blocked" };
  }

  return { ...base, state: "ready" };
}

export function isActionChecklistRevisionCurrent(
  revision: ActionChecklistRevision | null,
  current: ActionChecklistRevisionInputs,
) {
  return Boolean(
    revision &&
    revision.sourceVersion === current.sourceVersion &&
    revision.environmentVersion === current.environmentVersion &&
    revision.configurationVersion === current.configurationVersion,
  );
}

export function projectDeploymentStartGate(
  snapshot: ActionChecklistSnapshot,
  current: ActionChecklistRevisionInputs,
): DeploymentStartGate {
  const checklist = projectActionChecklist(snapshot);
  const blocked = (reason: DeploymentStartGateReason): DeploymentStartGate => ({
    canStart: false,
    reason,
    checklistState: checklist.state,
    revisionId: checklist.revisionId,
    unresolvedActionCount: checklist.unresolvedActionCount,
  });

  if (snapshot.phase !== "readiness") return blocked("verification_phase");
  if (checklist.state === "idle") return blocked("idle");
  if (!isActionChecklistRevisionCurrent(snapshot.revision, current)) {
    return blocked("stale_revision");
  }
  if (checklist.state !== "ready") return blocked(checklist.state);

  return {
    canStart: true,
    reason: "ready",
    checklistState: checklist.state,
    revisionId: checklist.revisionId,
    unresolvedActionCount: checklist.unresolvedActionCount,
  };
}
