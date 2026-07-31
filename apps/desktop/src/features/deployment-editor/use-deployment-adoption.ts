import { useCallback, useState } from "react";
import { issueFromUnknown } from "../../lib/errors";
import type { WorkspaceAdoption } from "../../types";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { DeploymentAdoptionDecisionView } from "./model";

export function useDeploymentAdoption({
  onError,
  services,
}: {
  onError: (message: string) => void;
  services: DeploymentEditorServices;
}) {
  const [adoption, setAdoption] = useState<WorkspaceAdoption | null>(null);
  const [action, setAction] = useState<"continue" | "reset" | null>(null);

  const clear = useCallback(() => {
    setAdoption(null);
    setAction(null);
  }, []);

  const inspect = useCallback(
    async (projectPath: string) => {
      if (!services.loadProjectAdoption) return false;
      const result = await services
        .loadProjectAdoption(projectPath)
        .catch(() => null);
      if (result?.mode !== "pending") return false;
      setAdoption(result);
      return true;
    },
    [services],
  );

  const resolve = useCallback(
    async (
      nextAction: "continue" | "reset",
      projectPath: string,
      onResolved: () => Promise<void>,
    ) => {
      const operation =
        nextAction === "continue"
          ? services.continueProjectDeployment
          : services.resetProjectDeployment;
      if (!operation || action) return;
      setAction(nextAction);
      try {
        await operation(projectPath);
        clear();
        await onResolved();
      } catch (error) {
        setAction(null);
        onError(
          issueFromUnknown(
            error,
            nextAction === "continue"
              ? "已有部署没有读取完成"
              : "部署设置没有重置完成",
          ).message,
        );
      }
    },
    [action, clear, onError, services],
  );

  const decision: DeploymentAdoptionDecisionView | null =
    adoption?.mode === "pending"
      ? {
          repository: adoption.repository,
          pipelineExists: adoption.pipelineExists,
          action,
        }
      : null;

  return { clear, decision, inspect, resolve };
}
