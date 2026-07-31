import { describe, expect, it } from "vitest";
import {
  isActionChecklistRevisionCurrent,
  projectActionChecklist,
  projectDeploymentStartGate,
  type ActionChecklistRevision,
  type ActionChecklistSnapshot,
  type ActionChecklistRevisionInputs,
} from "./model";

const revisionInputs: ActionChecklistRevisionInputs = {
  sourceVersion: "source-v1",
  environmentVersion: "environment-v1",
  configurationVersion: "configuration-v1",
};

const revision: ActionChecklistRevision = {
  id: "revision-1",
  ...revisionInputs,
};

function checklist(
  overrides: Partial<ActionChecklistSnapshot> = {},
): ActionChecklistSnapshot {
  return {
    phase: "readiness",
    revision,
    requiredCheckIds: ["source", "environment"],
    checks: [
      { id: "source", status: "passed" },
      { id: "environment", status: "passed" },
    ],
    items: [],
    ...overrides,
  };
}

describe("ActionChecklist projection", () => {
  it("stays idle until an evaluation revision exists", () => {
    const projection = projectActionChecklist(
      checklist({ revision: null, requiredCheckIds: [], checks: [] }),
    );

    expect(projection).toMatchObject({
      state: "idle",
      totalActionCount: 0,
      completedActionCount: 0,
      unresolvedActionCount: 0,
    });
  });

  it("stays scanning until every required check is terminal even with no actions", () => {
    const missing = projectActionChecklist(
      checklist({ checks: [{ id: "source", status: "passed" }] }),
    );
    const running = projectActionChecklist(
      checklist({
        checks: [
          { id: "source", status: "passed" },
          { id: "environment", status: "running" },
        ],
      }),
    );

    expect(missing.state).toBe("scanning");
    expect(running.state).toBe("scanning");
    expect(running.unresolvedActionCount).toBe(0);
  });

  it("keeps a system check failure separate from user actions", () => {
    const stillRunning = projectActionChecklist(
      checklist({
        checks: [
          { id: "source", status: "system_failed" },
          { id: "environment", status: "running" },
        ],
      }),
    );
    const failed = projectActionChecklist(
      checklist({
        checks: [
          { id: "source", status: "system_failed" },
          { id: "environment", status: "passed" },
        ],
      }),
    );

    expect(stillRunning.state).toBe("scanning");
    expect(failed).toMatchObject({
      state: "check_failed",
      totalActionCount: 0,
      unresolvedActionCount: 0,
    });
  });

  it("projects all unresolved actions together and becomes ready only after validation", () => {
    const blocked = projectActionChecklist(
      checklist({
        checks: [
          { id: "source", status: "needs_user_action" },
          { id: "environment", status: "needs_user_action" },
        ],
        items: [
          { id: "configuration", status: "pending" },
          { id: "access", status: "still_blocked" },
        ],
      }),
    );
    const ready = projectActionChecklist(
      checklist({
        items: [
          { id: "configuration", status: "completed" },
          { id: "access", status: "completed" },
        ],
      }),
    );

    expect(blocked).toMatchObject({
      state: "blocked",
      totalActionCount: 2,
      completedActionCount: 0,
      unresolvedActionCount: 2,
    });
    expect(ready).toMatchObject({
      state: "ready",
      totalActionCount: 2,
      completedActionCount: 2,
      unresolvedActionCount: 0,
    });
  });
});

describe("ActionChecklist revision and deployment gate", () => {
  it("invalidates a revision when source, environment, or configuration changes", () => {
    expect(isActionChecklistRevisionCurrent(revision, revisionInputs)).toBe(
      true,
    );

    for (const changed of [
      { ...revisionInputs, sourceVersion: "source-v2" },
      { ...revisionInputs, environmentVersion: "environment-v2" },
      { ...revisionInputs, configurationVersion: "configuration-v2" },
    ]) {
      expect(isActionChecklistRevisionCurrent(revision, changed)).toBe(false);
      expect(projectDeploymentStartGate(checklist(), changed)).toMatchObject({
        canStart: false,
        reason: "stale_revision",
      });
    }
  });

  it("allows the main deployment action only for a current ready readiness revision", () => {
    expect(
      projectDeploymentStartGate(checklist(), revisionInputs),
    ).toMatchObject({ canStart: true, reason: "ready" });

    expect(
      projectDeploymentStartGate(
        checklist({ checks: [{ id: "source", status: "running" }] }),
        revisionInputs,
      ),
    ).toMatchObject({ canStart: false, reason: "scanning" });

    expect(
      projectDeploymentStartGate(
        checklist({
          items: [{ id: "configuration", status: "pending" }],
        }),
        revisionInputs,
      ),
    ).toMatchObject({ canStart: false, reason: "blocked" });

    expect(
      projectDeploymentStartGate(
        checklist({
          checks: [
            { id: "source", status: "system_failed" },
            { id: "environment", status: "passed" },
          ],
        }),
        revisionInputs,
      ),
    ).toMatchObject({ canStart: false, reason: "check_failed" });

    expect(
      projectDeploymentStartGate(
        checklist({ phase: "verification" }),
        revisionInputs,
      ),
    ).toMatchObject({ canStart: false, reason: "verification_phase" });
  });
});
