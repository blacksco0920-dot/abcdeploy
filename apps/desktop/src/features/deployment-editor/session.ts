import {
  isActionChecklistRevisionCurrent,
  projectDeploymentStartGate,
  type ActionChecklistPhase,
  type ActionChecklistRevision,
  type ActionChecklistRevisionInputs,
  type ActionChecklistSnapshot,
} from "../action-checklist/model";
import type {
  DeploymentEnvironmentSelection,
  DeploymentEvidenceView,
  DeploymentRunView,
  ProjectSourceSelection,
  SavedServerOption,
} from "./model";

export type DeploymentEditorSourceResolutionState =
  "idle" | "invalid" | "resolving" | "resolved" | "failed";

export interface DeploymentEditorSession {
  source: ProjectSourceSelection;
  sourceCandidateId: string | null;
  sourceResolutionState: DeploymentEditorSourceResolutionState;
  sourceResolutionMessage: string | null;
  environment: DeploymentEnvironmentSelection;
  revisionInputs: ActionChecklistRevisionInputs;
  checklist: ActionChecklistSnapshot;
  activeRunId: string | null;
  run: DeploymentRunView;
  evidence: DeploymentEvidenceView | null;
}

export interface CreateDeploymentEditorSessionOptions {
  configurationVersion?: string;
}

export type DeploymentEditorSessionEvent =
  | {
      type: "local_source_selected";
      candidateId: string;
      path: string;
      name: string;
    }
  | {
      type: "repository_source_selected";
      candidateId: string;
      repositoryUrl: string;
    }
  | {
      type: "source_resolution_succeeded";
      candidateId: string;
      identity: string;
      serviceCount: number;
      name?: string;
    }
  | {
      type: "source_resolution_failed";
      candidateId: string;
      message: string;
    }
  | {
      type: "local_source_refreshed";
      identity: string;
      serviceCount: number;
      name?: string;
    }
  | {
      type: "local_environment_selected";
      environmentVersion: string;
    }
  | {
      type: "server_environment_selected";
      environmentVersion: string;
      serverId: string | null;
      servers: readonly SavedServerOption[];
    }
  | {
      type: "server_deployment_restored";
      environmentVersion: string;
      serverId: string;
      servers: readonly SavedServerOption[];
      runId: string;
      run: DeploymentRunView;
      evidence: DeploymentEvidenceView;
    }
  | { type: "configuration_changed"; configurationVersion: string }
  | {
      type: "checks_started";
      revision: ActionChecklistRevision;
      requiredCheckIds: readonly string[];
      phase?: ActionChecklistPhase;
    }
  | { type: "checklist_received"; checklist: ActionChecklistSnapshot }
  | {
      type: "start_run_requested";
      runId: string;
      revisionId: string;
    }
  | { type: "run_updated"; runId: string; run: DeploymentRunView }
  | {
      type: "evidence_received";
      runId: string;
      evidence: DeploymentEvidenceView;
    }
  | { type: "verification_requested"; runId: string };

export type DeploymentEditorSessionCommand =
  | {
      kind: "resolve_source";
      candidateId: string;
      source: Exclude<ProjectSourceSelection, { kind: "none" }>;
    }
  | {
      kind: "start_run";
      runId: string;
      revisionId: string;
      inputs: ActionChecklistRevisionInputs;
    }
  | { kind: "resume_verification"; runId: string; rebuild: false };

export interface DeploymentEditorSessionTransition {
  state: DeploymentEditorSession;
  accepted: boolean;
  command: DeploymentEditorSessionCommand | null;
}

const SUPPORTED_GIT_PROTOCOLS = new Set(["http:", "https:", "ssh:", "git:"]);

export function createDeploymentEditorSession(
  options: CreateDeploymentEditorSessionOptions = {},
): DeploymentEditorSession {
  return {
    source: { kind: "none" },
    sourceCandidateId: null,
    sourceResolutionState: "idle",
    sourceResolutionMessage: null,
    environment: { kind: "none" },
    revisionInputs: {
      sourceVersion: "",
      environmentVersion: "",
      configurationVersion:
        options.configurationVersion ?? "configuration-initial",
    },
    checklist: emptyChecklist(),
    activeRunId: null,
    run: idleRun(),
    evidence: null,
  };
}

export function isValidGitRepositoryUrl(value: string) {
  const candidate = value.trim();
  if (!candidate || /\s/.test(candidate)) return false;

  const scpPath = scpLikeRepositoryPath(candidate);
  if (scpPath !== null) return validRepositoryPath(scpPath);

  try {
    const url = new URL(candidate);
    const hasEmbeddedWebCredential =
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.username || url.password);
    return (
      SUPPORTED_GIT_PROTOCOLS.has(url.protocol) &&
      Boolean(url.hostname) &&
      !hasEmbeddedWebCredential &&
      !url.password &&
      !url.search &&
      !url.hash &&
      validRepositoryPath(url.pathname)
    );
  } catch {
    return false;
  }
}

export function transitionDeploymentEditorSession(
  state: DeploymentEditorSession,
  event: DeploymentEditorSessionEvent,
): DeploymentEditorSessionTransition {
  switch (event.type) {
    case "local_source_selected":
      return selectLocalSource(state, event);
    case "repository_source_selected":
      return selectRepositorySource(state, event);
    case "source_resolution_succeeded":
      return resolveSource(state, event);
    case "source_resolution_failed":
      return failSourceResolution(state, event);
    case "local_source_refreshed":
      return refreshLocalSource(state, event);
    case "local_environment_selected":
      return selectLocalEnvironment(state, event.environmentVersion);
    case "server_environment_selected":
      return selectServerEnvironment(state, event);
    case "server_deployment_restored":
      return restoreServerDeployment(state, event);
    case "configuration_changed":
      return changeConfiguration(state, event.configurationVersion);
    case "checks_started":
      return startChecks(state, event);
    case "checklist_received":
      return receiveChecklist(state, event.checklist);
    case "start_run_requested":
      return requestRun(state, event.runId, event.revisionId);
    case "run_updated":
      return updateRun(state, event.runId, event.run);
    case "evidence_received":
      return receiveEvidence(state, event.runId, event.evidence);
    case "verification_requested":
      return requestVerification(state, event.runId);
  }
}

function restoreServerDeployment(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "server_deployment_restored" }
  >,
) {
  if (state.sourceResolutionState !== "resolved") return ignored(state);
  return accepted({
    ...state,
    environment: {
      kind: "server",
      serverId: event.serverId,
      servers: event.servers,
    },
    revisionInputs: {
      ...state.revisionInputs,
      environmentVersion: event.environmentVersion,
    },
    checklist: emptyChecklist(),
    activeRunId: event.runId,
    run: event.run,
    evidence: event.evidence,
  });
}

function selectLocalSource(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "local_source_selected" }
  >,
) {
  const source: Extract<ProjectSourceSelection, { kind: "local" }> = {
    kind: "local",
    name: event.name,
    path: event.path,
    identity: null,
    serviceCount: null,
  };
  const next = invalidateExecution(state, {
    source,
    sourceCandidateId: event.candidateId,
    sourceResolutionState: "resolving",
    sourceResolutionMessage: null,
    revisionInputs: { ...state.revisionInputs, sourceVersion: "" },
  });
  return accepted(next, {
    kind: "resolve_source",
    candidateId: event.candidateId,
    source,
  });
}

function selectRepositorySource(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "repository_source_selected" }
  >,
) {
  const repositoryUrl = event.repositoryUrl.trim();
  const repositoryUrlValid = isValidGitRepositoryUrl(repositoryUrl);
  const source: Extract<ProjectSourceSelection, { kind: "repository" }> = {
    kind: "repository",
    name: inferredRepositoryName(repositoryUrl),
    repositoryUrl,
    repositoryUrlValid,
    identity: null,
    serviceCount: null,
  };
  const next = invalidateExecution(state, {
    source,
    sourceCandidateId: event.candidateId,
    sourceResolutionState: repositoryUrlValid ? "resolving" : "invalid",
    sourceResolutionMessage: null,
    revisionInputs: { ...state.revisionInputs, sourceVersion: "" },
  });
  return accepted(
    next,
    repositoryUrlValid
      ? { kind: "resolve_source", candidateId: event.candidateId, source }
      : null,
  );
}

function resolveSource(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "source_resolution_succeeded" }
  >,
) {
  if (
    state.sourceCandidateId !== event.candidateId ||
    state.source.kind === "none" ||
    state.sourceResolutionState !== "resolving"
  ) {
    return ignored(state);
  }

  const source: Exclude<ProjectSourceSelection, { kind: "none" }> =
    state.source.kind === "local"
      ? {
          ...state.source,
          name: event.name ?? state.source.name,
          identity: event.identity,
          serviceCount: event.serviceCount,
        }
      : {
          ...state.source,
          name: event.name ?? state.source.name,
          identity: event.identity,
          serviceCount: event.serviceCount,
        };
  return accepted(
    invalidateExecution(state, {
      source,
      sourceResolutionState: "resolved",
      sourceResolutionMessage: null,
      revisionInputs: {
        ...state.revisionInputs,
        sourceVersion: event.identity,
      },
    }),
  );
}

function failSourceResolution(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "source_resolution_failed" }
  >,
) {
  if (
    state.sourceCandidateId !== event.candidateId ||
    state.source.kind === "none" ||
    state.sourceResolutionState !== "resolving"
  ) {
    return ignored(state);
  }

  return accepted(
    invalidateExecution(state, {
      source: { ...state.source, identity: null, serviceCount: null },
      sourceResolutionState: "failed",
      sourceResolutionMessage: event.message,
      revisionInputs: { ...state.revisionInputs, sourceVersion: "" },
    }),
  );
}

function refreshLocalSource(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "local_source_refreshed" }
  >,
) {
  if (
    state.source.kind !== "local" ||
    state.sourceResolutionState !== "resolved"
  ) {
    return ignored(state);
  }
  if (state.source.identity === event.identity) return accepted(state);

  return accepted(
    invalidateExecution(state, {
      source: {
        ...state.source,
        name: event.name ?? state.source.name,
        identity: event.identity,
        serviceCount: event.serviceCount,
      },
      sourceResolutionMessage: null,
      revisionInputs: {
        ...state.revisionInputs,
        sourceVersion: event.identity,
      },
    }),
  );
}

function selectLocalEnvironment(
  state: DeploymentEditorSession,
  environmentVersion: string,
) {
  if (state.sourceResolutionState !== "resolved") return ignored(state);
  if (
    state.environment.kind === "local" &&
    state.revisionInputs.environmentVersion === environmentVersion
  ) {
    return accepted(state);
  }
  return accepted(
    invalidateExecution(state, {
      environment: { kind: "local" },
      revisionInputs: { ...state.revisionInputs, environmentVersion },
    }),
  );
}

function selectServerEnvironment(
  state: DeploymentEditorSession,
  event: Extract<
    DeploymentEditorSessionEvent,
    { type: "server_environment_selected" }
  >,
) {
  if (state.sourceResolutionState !== "resolved") return ignored(state);
  const environment: Extract<
    DeploymentEnvironmentSelection,
    { kind: "server" }
  > = {
    kind: "server",
    serverId: event.serverId,
    servers: event.servers,
  };
  if (
    state.environment.kind === "server" &&
    state.environment.serverId === event.serverId &&
    state.revisionInputs.environmentVersion === event.environmentVersion &&
    selectedServerVerified(state.environment) ===
      selectedServerVerified(environment)
  ) {
    return accepted({ ...state, environment });
  }
  return accepted(
    invalidateExecution(state, {
      environment,
      revisionInputs: {
        ...state.revisionInputs,
        environmentVersion: event.environmentVersion,
      },
    }),
  );
}

function changeConfiguration(
  state: DeploymentEditorSession,
  configurationVersion: string,
) {
  if (state.revisionInputs.configurationVersion === configurationVersion) {
    return accepted(state);
  }
  return accepted(
    invalidateExecution(state, {
      revisionInputs: { ...state.revisionInputs, configurationVersion },
    }),
  );
}

function startChecks(
  state: DeploymentEditorSession,
  event: Extract<DeploymentEditorSessionEvent, { type: "checks_started" }>,
) {
  if (
    !hasResolvedInputs(state) ||
    !isActionChecklistRevisionCurrent(event.revision, state.revisionInputs)
  ) {
    return ignored(state);
  }
  return accepted({
    ...state,
    checklist: {
      phase: event.phase ?? "readiness",
      revision: event.revision,
      requiredCheckIds: event.requiredCheckIds,
      checks: [],
      items: [],
    },
  });
}

function receiveChecklist(
  state: DeploymentEditorSession,
  checklist: ActionChecklistSnapshot,
) {
  if (
    !checklist.revision ||
    checklist.revision.id !== state.checklist.revision?.id ||
    checklist.phase !== state.checklist.phase ||
    !sameIds(checklist.requiredCheckIds, state.checklist.requiredCheckIds) ||
    !isActionChecklistRevisionCurrent(checklist.revision, state.revisionInputs)
  ) {
    return ignored(state);
  }
  return accepted({ ...state, checklist });
}

function requestRun(
  state: DeploymentEditorSession,
  runId: string,
  revisionId: string,
) {
  const gate = projectDeploymentStartGate(
    state.checklist,
    state.revisionInputs,
  );
  if (
    (state.activeRunId && state.run.state !== "failed") ||
    !hasResolvedInputs(state) ||
    !gate.canStart ||
    gate.revisionId !== revisionId
  ) {
    return ignored(state);
  }

  return accepted(
    {
      ...state,
      activeRunId: runId,
      run: {
        state: "running",
        message: "",
        canCloseClient: false,
        steps: [],
      },
      evidence: null,
    },
    {
      kind: "start_run",
      runId,
      revisionId,
      inputs: { ...state.revisionInputs },
    },
  );
}

function updateRun(
  state: DeploymentEditorSession,
  runId: string,
  run: DeploymentRunView,
) {
  if (state.activeRunId !== runId) return ignored(state);
  return accepted({ ...state, run });
}

function receiveEvidence(
  state: DeploymentEditorSession,
  runId: string,
  evidence: DeploymentEvidenceView,
) {
  if (state.activeRunId !== runId) return ignored(state);
  return accepted({ ...state, evidence });
}

function requestVerification(state: DeploymentEditorSession, runId: string) {
  if (
    state.activeRunId !== runId ||
    state.run.state !== "completed" ||
    state.evidence?.projection.continuation !== "verification"
  ) {
    return ignored(state);
  }
  return accepted(state, {
    kind: "resume_verification",
    runId,
    rebuild: false,
  });
}

function hasResolvedInputs(state: DeploymentEditorSession) {
  if (
    state.sourceResolutionState !== "resolved" ||
    state.source.kind === "none" ||
    !state.source.identity
  ) {
    return false;
  }
  if (state.environment.kind === "local") return true;
  if (state.environment.kind !== "server" || !state.environment.serverId) {
    return false;
  }
  const serverId = state.environment.serverId;
  return state.environment.servers.some(
    (server) => server.id === serverId && server.verified,
  );
}

function invalidateExecution(
  state: DeploymentEditorSession,
  changes: Partial<DeploymentEditorSession>,
): DeploymentEditorSession {
  return {
    ...state,
    ...changes,
    checklist: emptyChecklist(),
    activeRunId: null,
    run: idleRun(),
    evidence: null,
  };
}

function emptyChecklist(): ActionChecklistSnapshot {
  return {
    phase: "readiness",
    revision: null,
    requiredCheckIds: [],
    checks: [],
    items: [],
  };
}

function idleRun(): DeploymentRunView {
  return { state: "idle", message: "", canCloseClient: false, steps: [] };
}

function accepted(
  state: DeploymentEditorSession,
  command: DeploymentEditorSessionCommand | null = null,
): DeploymentEditorSessionTransition {
  return { state, accepted: true, command };
}

function ignored(
  state: DeploymentEditorSession,
): DeploymentEditorSessionTransition {
  return { state, accepted: false, command: null };
}

function scpLikeRepositoryPath(value: string) {
  const match = value.match(/^[^@\s/:]+@[^@\s/:]+:(.+)$/);
  return match?.[1] ?? null;
}

function validRepositoryPath(value: string) {
  const segments = value.split("/").filter(Boolean);
  const repository = segments[segments.length - 1];
  return Boolean(repository && repository !== "." && repository !== "..");
}

function inferredRepositoryName(value: string) {
  const path = scpLikeRepositoryPath(value) ?? repositoryUrlPath(value);
  const segments = path.split("/").filter(Boolean);
  const repository = segments[segments.length - 1] ?? "";
  return repository.replace(/\.git$/i, "") || null;
}

function repositoryUrlPath(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function selectedServerVerified(
  environment: Extract<DeploymentEnvironmentSelection, { kind: "server" }>,
) {
  return environment.servers.some(
    (server) => server.id === environment.serverId && server.verified,
  );
}

function sameIds(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  if (leftIds.size !== left.length || rightIds.size !== right.length) {
    return false;
  }
  return left.every((id) => rightIds.has(id));
}
