import { useCallback, type MutableRefObject } from "react";
import type {
  ManagedLocalRunWorkspace,
  ManagedSourceSnapshot,
} from "../../types";
import type { DeploymentEvidenceRound } from "../deployment-evidence/model";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import {
  localEvidenceRound,
  localEvidenceSnapshot,
  localEvidenceView,
} from "./local-evidence-view";
import { completedRun, failedRun } from "./run-view";
import type { DeploymentEditorSessionEvent } from "./session";

interface UseLocalRunVerificationOptions {
  applyEvent: (event: DeploymentEditorSessionEvent) => void;
  evidenceRoundsRef: MutableRefObject<DeploymentEvidenceRound[]>;
  services: DeploymentEditorServices;
}

export function useLocalRunVerification({
  applyEvent,
  evidenceRoundsRef,
  services,
}: UseLocalRunVerificationOptions) {
  return useCallback(
    async (
      uiRunId: string,
      managedRun: ManagedLocalRunWorkspace,
      snapshot: ManagedSourceSnapshot,
    ) => {
      for (let roundIndex = 0; roundIndex < 3; roundIndex += 1) {
        if (roundIndex > 0) await services.waitForEvidenceInterval();
        const evidenceRound = await services.verifyLocalRun(managedRun.runId);
        const round = localEvidenceRound(snapshot, managedRun, evidenceRound);
        evidenceRoundsRef.current = [...evidenceRoundsRef.current, round];
        const snapshotEvidence = localEvidenceSnapshot(
          evidenceRoundsRef.current,
        );
        const projection = await services.projectEvidence(
          snapshotEvidence,
          services.now(),
          true,
        );
        const evidence = localEvidenceView(
          snapshot,
          managedRun,
          evidenceRound,
          projection,
        );
        applyEvent({ type: "evidence_received", runId: uiRunId, evidence });
        if (
          evidence.projection.status === "verification_failed" ||
          evidence.projection.status ===
            "service_running_public_access_blocked" ||
          evidence.projection.status === "verified_current"
        ) {
          applyEvent({
            type: "run_updated",
            runId: uiRunId,
            run: completedRun(evidence.projection.canShowCurrentSuccess),
          });
          return;
        }
      }
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: failedRun(
          "结果还没有达到连续验证门槛。已启动的服务保持不变；请重新检查结果。",
        ),
      });
    },
    [applyEvent, evidenceRoundsRef, services],
  );
}
