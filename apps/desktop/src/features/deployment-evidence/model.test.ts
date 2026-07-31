import { describe, expect, it } from "vitest";
import {
  projectDeploymentEvidence,
  type DeploymentEvidenceCheck,
  type DeploymentEvidenceRound,
  type DeploymentEvidenceSnapshot,
} from "./model";

const requirements: DeploymentEvidenceSnapshot["requirements"] = [
  { id: "source", kind: "source_identity" },
  { id: "runtime", kind: "runtime_identity" },
  { id: "service", kind: "service_health" },
  { id: "public-web", kind: "public_access" },
];

function check(
  requirement: (typeof requirements)[number],
  passed = true,
): DeploymentEvidenceCheck {
  return {
    requirementId: requirement.id,
    kind: requirement.kind,
    expected: `${requirement.id}-expected`,
    actual: passed ? `${requirement.id}-expected` : `${requirement.id}-actual`,
    location: `${requirement.id}-location`,
    passed,
  };
}

function round(
  checkedAtMs: number,
  failures: string[] = [],
): DeploymentEvidenceRound {
  return {
    checkedAtMs,
    checks: requirements.map((requirement) =>
      check(requirement, !failures.includes(requirement.id)),
    ),
  };
}

function evidence(
  rounds: DeploymentEvidenceRound[],
): DeploymentEvidenceSnapshot {
  return { requirements, rounds };
}

describe("DeploymentEvidence stability projection", () => {
  it("requires three consecutive passes five seconds apart over ten seconds", () => {
    const tooSoon = projectDeploymentEvidence(
      evidence([round(0), round(4_999), round(10_000)]),
      10_000,
    );
    const stable = projectDeploymentEvidence(
      evidence([round(0), round(5_000), round(10_000)]),
      10_000,
    );

    expect(tooSoon).toMatchObject({
      status: "verifying",
      canShowCurrentSuccess: false,
      consecutivePassCount: 2,
    });
    expect(stable).toMatchObject({
      status: "verified_current",
      canShowCurrentSuccess: true,
      consecutivePassCount: 3,
      stabilityWindowMs: 10_000,
      verifiedAtMs: 10_000,
    });
  });

  it("restarts the consecutive sequence after any failed round", () => {
    const projection = projectDeploymentEvidence(
      evidence([
        round(0),
        round(5_000),
        round(10_000, ["service"]),
        round(15_000),
        round(20_000),
      ]),
      20_000,
    );

    expect(projection).toMatchObject({
      status: "verifying",
      canShowCurrentSuccess: false,
      consecutivePassCount: 2,
      stabilityWindowMs: 5_000,
    });
  });

  it("keeps success current for five minutes and then requires verification", () => {
    const snapshot = evidence([round(0), round(5_000), round(10_000)]);

    expect(projectDeploymentEvidence(snapshot, 310_000)).toMatchObject({
      status: "verified_current",
      canShowCurrentSuccess: true,
      freshUntilMs: 310_000,
    });
    expect(projectDeploymentEvidence(snapshot, 310_001)).toMatchObject({
      status: "verified_stale",
      canShowCurrentSuccess: false,
      continuation: "verification",
      preserveEstablishedRuntime: true,
    });
  });
});

describe("DeploymentEvidence public access projection", () => {
  it("preserves established runtime facts and resumes verification after public access fails", () => {
    const projection = projectDeploymentEvidence(
      evidence([
        round(0),
        round(5_000),
        round(10_000),
        round(15_000, ["public-web"]),
      ]),
      15_000,
    );

    expect(projection).toMatchObject({
      status: "service_running_public_access_blocked",
      canShowCurrentSuccess: false,
      continuation: "verification",
      preserveEstablishedRuntime: true,
      failedCheckIds: ["public-web"],
      establishedCheckIds: ["source", "runtime", "service"],
      consecutivePassCount: 0,
    });
  });

  it("does not reuse the old success sequence after public access is repaired", () => {
    const projection = projectDeploymentEvidence(
      evidence([
        round(0),
        round(5_000),
        round(10_000),
        round(15_000, ["public-web"]),
        round(20_000),
      ]),
      20_000,
    );

    expect(projection).toMatchObject({
      status: "verifying",
      canShowCurrentSuccess: false,
      continuation: "verification",
      consecutivePassCount: 1,
    });
  });

  it("does not claim that a service is running without runtime and health evidence", () => {
    const publicOnly: DeploymentEvidenceSnapshot = {
      requirements: [{ id: "public-web", kind: "public_access" }],
      rounds: [
        {
          checkedAtMs: 10_000,
          checks: [
            {
              requirementId: "public-web",
              kind: "public_access",
              expected: "reachable",
              actual: "connection refused",
              location: "user network",
              passed: false,
            },
          ],
        },
      ],
    };

    expect(projectDeploymentEvidence(publicOnly, 10_000)).toMatchObject({
      status: "verifying",
      canShowCurrentSuccess: false,
      preserveEstablishedRuntime: false,
    });
  });
});
