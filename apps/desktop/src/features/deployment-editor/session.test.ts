import { describe, expect, it } from "vitest";
import { projectActionChecklist } from "../action-checklist/model";
import type { DeploymentEvidenceView, DeploymentRunView } from "./model";
import {
  createDeploymentEditorSession,
  isValidGitRepositoryUrl,
  transitionDeploymentEditorSession,
  type DeploymentEditorSession,
  type DeploymentEditorSessionEvent,
} from "./session";

const completedRun: DeploymentRunView = {
  state: "completed",
  message: "运行和基础检查已完成",
  canCloseClient: true,
  steps: [
    {
      id: "run",
      label: "运行项目",
      status: "completed",
      detail: "必要服务已启动",
    },
  ],
};

function evidence(
  status:
    | "verified_current"
    | "verified_stale"
    | "service_running_public_access_blocked",
): DeploymentEvidenceView {
  const current = status === "verified_current";
  return {
    projection: {
      status,
      canShowCurrentSuccess: current,
      continuation: current ? "none" : "verification",
      preserveEstablishedRuntime: true,
      consecutivePassCount: current ? 3 : 0,
      stabilityWindowMs: current ? 10_000 : 0,
      verifiedAtMs: current ? 20_000 : null,
      freshUntilMs: current ? 320_000 : null,
      establishedCheckIds: ["source", "runtime", "service"],
      failedCheckIds:
        status === "service_running_public_access_blocked"
          ? ["public-web"]
          : [],
    },
    sourceIdentity: "source-v1",
    runtimeIdentity: "runtime-v1",
    environmentLabel: "这台电脑",
    serviceSummary: "1/1 服务健康",
    primaryAddress: "http://127.0.0.1:3000",
    addresses: ["http://127.0.0.1:3000"],
    checkedAtLabel: "刚刚",
  };
}

function send(
  state: DeploymentEditorSession,
  event: DeploymentEditorSessionEvent,
) {
  return transitionDeploymentEditorSession(state, event).state;
}

function resolvedSession() {
  let state = createDeploymentEditorSession({
    configurationVersion: "configuration-v1",
  });
  state = send(state, {
    type: "local_source_selected",
    candidateId: "candidate-1",
    path: "/workspace/sample-store",
    name: "sample-store",
  });
  state = send(state, {
    type: "source_resolution_succeeded",
    candidateId: "candidate-1",
    identity: "source-v1",
    serviceCount: 1,
  });
  state = send(state, {
    type: "local_environment_selected",
    environmentVersion: "local-v1",
  });
  return state;
}

function readySession() {
  let state = resolvedSession();
  const revision = { id: "revision-1", ...state.revisionInputs };
  state = send(state, {
    type: "checks_started",
    revision,
    requiredCheckIds: ["source", "environment"],
  });
  state = send(state, {
    type: "checklist_received",
    checklist: {
      phase: "readiness",
      revision,
      requiredCheckIds: ["source", "environment"],
      checks: [
        { id: "source", status: "passed" },
        { id: "environment", status: "passed" },
      ],
      items: [],
    },
  });
  return state;
}

function completedSession(view = evidence("verified_current")) {
  let state = readySession();
  state = transitionDeploymentEditorSession(state, {
    type: "start_run_requested",
    runId: "run-1",
    revisionId: "revision-1",
  }).state;
  state = send(state, {
    type: "run_updated",
    runId: "run-1",
    run: completedRun,
  });
  state = send(state, {
    type: "evidence_received",
    runId: "run-1",
    evidence: view,
  });
  return state;
}

describe("deployment editor session source and environment", () => {
  it("creates a blank session without inventing stable facts", () => {
    const state = createDeploymentEditorSession({
      configurationVersion: "configuration-v1",
    });

    expect(state).toMatchObject({
      source: { kind: "none" },
      sourceCandidateId: null,
      sourceResolutionState: "idle",
      sourceResolutionMessage: null,
      environment: { kind: "none" },
      revisionInputs: {
        sourceVersion: "",
        environmentVersion: "",
        configurationVersion: "configuration-v1",
      },
      activeRunId: null,
      run: { state: "idle" },
      evidence: null,
    });
    expect(projectActionChecklist(state.checklist).state).toBe("idle");
  });

  it("selects and replaces a local source while invalidating old facts immediately", () => {
    const previous = completedSession();
    const transition = transitionDeploymentEditorSession(previous, {
      type: "local_source_selected",
      candidateId: "candidate-2",
      path: "/workspace/other-app",
      name: "other-app",
    });

    expect(transition.accepted).toBe(true);
    expect(transition.command).toMatchObject({
      kind: "resolve_source",
      candidateId: "candidate-2",
    });
    expect(transition.state).toMatchObject({
      source: {
        kind: "local",
        path: "/workspace/other-app",
        name: "other-app",
        identity: null,
      },
      sourceCandidateId: "candidate-2",
      sourceResolutionState: "resolving",
      activeRunId: null,
      run: { state: "idle" },
      evidence: null,
    });
    expect(projectActionChecklist(transition.state.checklist).state).toBe(
      "idle",
    );
  });

  it("refreshes a changed local source without discarding the selected environment", () => {
    const previous = readySession();
    const transition = transitionDeploymentEditorSession(previous, {
      type: "local_source_refreshed",
      identity: "source-v2",
      serviceCount: 2,
      name: "sample-store",
    });

    expect(transition.accepted).toBe(true);
    expect(transition.state).toMatchObject({
      source: {
        kind: "local",
        identity: "source-v2",
        serviceCount: 2,
      },
      environment: { kind: "local" },
      revisionInputs: {
        sourceVersion: "source-v2",
        environmentVersion: "local-v1",
      },
      activeRunId: null,
      run: { state: "idle" },
    });
    expect(projectActionChecklist(transition.state.checklist).state).toBe(
      "idle",
    );
  });

  it("validates common Git URL forms before resolving a repository source", () => {
    for (const value of [
      "https://code.example.com/team/app.git",
      "ssh://git@code.example.com/team/app.git",
      "git://code.example.com/team/app.git",
      "git@code.example.com:team/app.git",
    ]) {
      expect(isValidGitRepositoryUrl(value)).toBe(true);
    }
    for (const value of [
      "",
      "team/app",
      "https://code.example.com",
      "file:///workspace/app",
      "https://embedded-token@code.example.com/team/app.git",
      "https://code.example.com/team/app with space.git",
    ]) {
      expect(isValidGitRepositoryUrl(value)).toBe(false);
    }

    const blank = createDeploymentEditorSession();
    const invalid = transitionDeploymentEditorSession(blank, {
      type: "repository_source_selected",
      candidateId: "repository-1",
      repositoryUrl: "team/app",
    });
    const valid = transitionDeploymentEditorSession(blank, {
      type: "repository_source_selected",
      candidateId: "repository-2",
      repositoryUrl: "https://code.example.com/team/app.git",
    });

    expect(invalid.state).toMatchObject({
      source: { kind: "repository", repositoryUrlValid: false },
      sourceResolutionState: "invalid",
    });
    expect(invalid.command).toBeNull();
    expect(valid.state).toMatchObject({
      source: {
        kind: "repository",
        name: "app",
        repositoryUrl: "https://code.example.com/team/app.git",
        repositoryUrlValid: true,
      },
      sourceResolutionState: "resolving",
    });
    expect(valid.command).toMatchObject({ kind: "resolve_source" });
  });

  it("accepts only the current source resolution result", () => {
    let state = createDeploymentEditorSession();
    state = send(state, {
      type: "local_source_selected",
      candidateId: "candidate-1",
      path: "/workspace/first",
      name: "first",
    });
    state = send(state, {
      type: "local_source_selected",
      candidateId: "candidate-2",
      path: "/workspace/second",
      name: "second",
    });

    const stale = transitionDeploymentEditorSession(state, {
      type: "source_resolution_failed",
      candidateId: "candidate-1",
      message: "旧文件夹无法读取",
    });
    expect(stale.accepted).toBe(false);
    expect(stale.state).toBe(state);

    const current = transitionDeploymentEditorSession(state, {
      type: "source_resolution_failed",
      candidateId: "candidate-2",
      message: "当前文件夹无法读取",
    });
    expect(current.accepted).toBe(true);
    expect(current.state).toMatchObject({
      sourceResolutionState: "failed",
      sourceResolutionMessage: "当前文件夹无法读取",
    });

    const lateSuccess = transitionDeploymentEditorSession(current.state, {
      type: "source_resolution_succeeded",
      candidateId: "candidate-2",
      identity: "late-source",
      serviceCount: 1,
    });
    expect(lateSuccess.accepted).toBe(false);
    expect(lateSuccess.state).toBe(current.state);
  });

  it("selects local or verified server environments and invalidates an old run on change", () => {
    let state = resolvedSession();
    expect(state.environment).toEqual({ kind: "local" });

    state = completedSession();
    const changed = transitionDeploymentEditorSession(state, {
      type: "server_environment_selected",
      environmentVersion: "server-v1",
      serverId: "server-1",
      servers: [
        {
          id: "server-1",
          name: "应用服务器",
          detail: "已验证",
          verified: true,
        },
      ],
    });

    expect(changed.accepted).toBe(true);
    expect(changed.state.environment).toMatchObject({
      kind: "server",
      serverId: "server-1",
    });
    expect(changed.state.revisionInputs.environmentVersion).toBe("server-v1");
    expect(changed.state.activeRunId).toBeNull();
    expect(changed.state.run.state).toBe("idle");
    expect(changed.state.evidence).toBeNull();
    expect(projectActionChecklist(changed.state.checklist).state).toBe("idle");
  });
});

describe("deployment editor session checklist and run", () => {
  it("starts checks only for current inputs and accepts only that full revision", () => {
    const initial = resolvedSession();
    const staleRevision = {
      id: "revision-old",
      ...initial.revisionInputs,
      sourceVersion: "source-old",
    };
    const rejected = transitionDeploymentEditorSession(initial, {
      type: "checks_started",
      revision: staleRevision,
      requiredCheckIds: ["source", "environment"],
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.state).toBe(initial);

    const revision = { id: "revision-1", ...initial.revisionInputs };
    const scanning = transitionDeploymentEditorSession(initial, {
      type: "checks_started",
      revision,
      requiredCheckIds: ["source", "environment"],
    });
    expect(scanning.accepted).toBe(true);
    expect(projectActionChecklist(scanning.state.checklist).state).toBe(
      "scanning",
    );

    const staleChecklist = transitionDeploymentEditorSession(scanning.state, {
      type: "checklist_received",
      checklist: {
        phase: "readiness",
        revision: { ...revision, id: "revision-other" },
        requiredCheckIds: [],
        checks: [],
        items: [],
      },
    });
    expect(staleChecklist.accepted).toBe(false);
    expect(staleChecklist.state).toBe(scanning.state);

    const incompleteSet = transitionDeploymentEditorSession(scanning.state, {
      type: "checklist_received",
      checklist: {
        phase: "readiness",
        revision,
        requiredCheckIds: ["source"],
        checks: [{ id: "source", status: "passed" }],
        items: [],
      },
    });
    expect(incompleteSet.accepted).toBe(false);
    expect(incompleteSet.state).toBe(scanning.state);

    const blocked = transitionDeploymentEditorSession(scanning.state, {
      type: "checklist_received",
      checklist: {
        phase: "readiness",
        revision,
        requiredCheckIds: ["source", "environment"],
        checks: [
          { id: "source", status: "needs_user_action" },
          { id: "environment", status: "passed" },
        ],
        items: [{ id: "configuration", status: "pending" }],
      },
    });
    expect(blocked.accepted).toBe(true);
    expect(projectActionChecklist(blocked.state.checklist)).toMatchObject({
      state: "blocked",
      totalActionCount: 1,
      unresolvedActionCount: 1,
    });
  });

  it("starts a run only from the current ready readiness revision", () => {
    const scanning = resolvedSession();
    const rejected = transitionDeploymentEditorSession(scanning, {
      type: "start_run_requested",
      runId: "run-1",
      revisionId: "revision-1",
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.command).toBeNull();

    const ready = readySession();
    const started = transitionDeploymentEditorSession(ready, {
      type: "start_run_requested",
      runId: "run-1",
      revisionId: "revision-1",
    });
    expect(started.accepted).toBe(true);
    expect(started.command).toEqual({
      kind: "start_run",
      runId: "run-1",
      revisionId: "revision-1",
      inputs: ready.revisionInputs,
    });
    expect(started.state).toMatchObject({
      activeRunId: "run-1",
      run: { state: "running" },
      evidence: null,
    });
  });

  it("applies run and evidence updates only to the active run", () => {
    let state = readySession();
    state = transitionDeploymentEditorSession(state, {
      type: "start_run_requested",
      runId: "run-1",
      revisionId: "revision-1",
    }).state;

    const staleRun = transitionDeploymentEditorSession(state, {
      type: "run_updated",
      runId: "run-old",
      run: completedRun,
    });
    expect(staleRun.accepted).toBe(false);
    expect(staleRun.state).toBe(state);

    state = send(state, {
      type: "run_updated",
      runId: "run-1",
      run: completedRun,
    });
    const staleEvidence = transitionDeploymentEditorSession(state, {
      type: "evidence_received",
      runId: "run-old",
      evidence: evidence("verified_current"),
    });
    expect(staleEvidence.accepted).toBe(false);

    state = send(state, {
      type: "evidence_received",
      runId: "run-1",
      evidence: evidence("verified_current"),
    });
    expect(state.run.state).toBe("completed");
    expect(state.evidence?.projection.status).toBe("verified_current");
  });

  it("resumes verification without issuing a new build or run", () => {
    const state = completedSession(
      evidence("service_running_public_access_blocked"),
    );
    const resumed = transitionDeploymentEditorSession(state, {
      type: "verification_requested",
      runId: "run-1",
    });

    expect(resumed.accepted).toBe(true);
    expect(resumed.command).toEqual({
      kind: "resume_verification",
      runId: "run-1",
      rebuild: false,
    });
    expect(resumed.state.run).toEqual(state.run);
    expect(resumed.state.activeRunId).toBe("run-1");
  });
});
