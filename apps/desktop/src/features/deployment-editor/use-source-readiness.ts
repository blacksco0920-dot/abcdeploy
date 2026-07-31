import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ManagedSourceSnapshot } from "../../types";
import { issueFromUnknown } from "../../lib/errors";
import { projectActionChecklist } from "../action-checklist/model";
import { inspectDeploymentReadiness } from "./deployment-readiness";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { DeploymentEditorViewModel } from "./model";
import {
  failedDeploymentReadinessChecklist,
  readinessCheckIds,
} from "./server-deployment-setup";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";
import type {
  DeploymentEditorSession,
  DeploymentEditorSessionEvent,
  DeploymentEditorSessionTransition,
} from "./session";

interface SourceReadinessOptions {
  applyEvent: (
    event: DeploymentEditorSessionEvent,
  ) => DeploymentEditorSessionTransition;
  localSnapshotRef: MutableRefObject<ManagedSourceSnapshot | null>;
  revisionSequence: MutableRefObject<number>;
  selectedServerIdRef: MutableRefObject<string | null>;
  services: DeploymentEditorServices;
  setInspection: Dispatch<
    SetStateAction<ServerDeploymentSetupInspection | null>
  >;
  setSystemChecks: Dispatch<SetStateAction<string[]>>;
  setSystemFailure: Dispatch<
    SetStateAction<DeploymentEditorViewModel["systemFailure"]>
  >;
}

export function useSourceReadiness({
  applyEvent,
  localSnapshotRef,
  revisionSequence,
  selectedServerIdRef,
  services,
  setInspection,
  setSystemChecks,
  setSystemFailure,
}: SourceReadinessOptions) {
  const evaluateReadiness = useCallback(
    async (
      state: DeploymentEditorSession,
      setupOverride?: ServerDeploymentSetupInspection,
    ) => {
      const revisionId = `readiness-${++revisionSequence.current}`;
      const revision = { id: revisionId, ...state.revisionInputs };
      const started = applyEvent({
        type: "checks_started",
        revision,
        requiredCheckIds: readinessCheckIds(
          state.environment.kind === "server",
        ),
      });
      if (!started.accepted) return false;
      setSystemFailure(null);
      setSystemChecks([]);
      try {
        const result = await inspectDeploymentReadiness(
          state,
          revisionId,
          localSnapshotRef.current,
          selectedServerIdRef.current,
          setupOverride
            ? async () => setupOverride
            : services.ensureServerDeploymentSetup,
        );
        setInspection(result.setup);
        const received = applyEvent({
          type: "checklist_received",
          checklist: result.checklist,
        });
        if (received.accepted) setSystemChecks(result.systemChecks);
        return (
          received.accepted &&
          projectActionChecklist(received.state.checklist).state === "ready"
        );
      } catch (error) {
        const issue = issueFromUnknown(error, "上线设置没有检查完成");
        applyEvent({
          type: "checklist_received",
          checklist: failedDeploymentReadinessChecklist(revision),
        });
        setSystemFailure({
          action: "retry",
          actionLabel: "重新检查上线设置",
          title: "上线设置没有检查完成",
          message: `${issue.message} 项目和服务器选择都已保留。`,
        });
        return false;
      }
    },
    [
      applyEvent,
      localSnapshotRef,
      revisionSequence,
      selectedServerIdRef,
      services,
      setInspection,
      setSystemChecks,
      setSystemFailure,
    ],
  );

  const refreshLocalSourceBeforeRun = useCallback(async () => {
    let current = localSnapshotRef.current;
    if (!current) return null;
    setSystemFailure(null);

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const refreshed = await services.resolveLocalFolder(current.sourcePath);
        if (refreshed.httpServiceCount < 1) {
          throw new Error("当前项目不再包含可通过地址访问的网页或 HTTP 服务");
        }
        if (refreshed.snapshotId === current.snapshotId) {
          localSnapshotRef.current = refreshed;
          return refreshed;
        }

        localSnapshotRef.current = refreshed;
        const updated = applyEvent({
          type: "local_source_refreshed",
          identity: refreshed.snapshotId,
          serviceCount: refreshed.serviceCount,
          name: refreshed.projectName,
        });
        if (!updated.accepted) return null;

        setSystemChecks(["项目内容有变化，正在重新读取并检查"]);
        if (!(await evaluateReadiness(updated.state))) return null;
        current = refreshed;
      }

      throw new Error("项目内容仍在变化，请等待编辑器或其他工具保存完成后再试");
    } catch (error) {
      const issue = issueFromUnknown(error, "项目没有重新读取完成");
      setSystemChecks([]);
      setSystemFailure({
        action: "retry",
        actionLabel: "重新读取项目",
        title: "项目没有重新读取完成",
        message: `${issue.message} 已完成的上线设置和服务器连接都已保留。`,
      });
      return null;
    }
  }, [
    applyEvent,
    evaluateReadiness,
    localSnapshotRef,
    services,
    setSystemChecks,
    setSystemFailure,
  ]);

  return { evaluateReadiness, refreshLocalSourceBeforeRun };
}
