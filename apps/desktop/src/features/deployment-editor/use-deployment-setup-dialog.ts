import { useCallback, useState } from "react";
import { issueFromUnknown } from "../../lib/errors";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";
import type { ServerDeploymentSetupDialogMode } from "./ServerDeploymentSetupDialog";

interface DeploymentSetupDialogOptions {
  onError: (message: string) => void;
  services: DeploymentEditorServices;
}

export function useDeploymentSetupDialog({
  onError,
  services,
}: DeploymentSetupDialogOptions) {
  const [inspection, setInspection] =
    useState<ServerDeploymentSetupInspection | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ServerDeploymentSetupDialogMode>("initial");

  const openAddressConfiguration = useCallback(
    async (projectPath: string | null, serverId: string | null) => {
      if (!projectPath || !serverId) {
        onError("无法读取当前访问地址设置；已运行的服务和已生成版本都已保留");
        return;
      }
      try {
        setMode("initial");
        setInspection(
          await services.ensureServerDeploymentSetup(projectPath, serverId),
        );
        setOpen(true);
      } catch (error) {
        onError(issueFromUnknown(error, "访问地址设置没有读取完成").message);
      }
    },
    [onError, services],
  );

  const openSettings = useCallback(
    async (projectPath: string | null, serverId: string | null) => {
      if (!projectPath || !serverId) {
        onError("无法读取当前部署设置；当前运行版本没有改变");
        return;
      }
      try {
        const inspect =
          services.inspectServerDeploymentSetup ??
          services.ensureServerDeploymentSetup;
        setMode("settings");
        setInspection(await inspect(projectPath, serverId));
        setOpen(true);
      } catch (error) {
        onError(issueFromUnknown(error, "部署设置没有读取完成").message);
      }
    },
    [onError, services],
  );

  return {
    close: () => setOpen(false),
    inspection,
    mode,
    open,
    openAddressConfiguration,
    openCurrent: () => {
      setMode("initial");
      setOpen(true);
    },
    openSettings,
    openRegistryAuthorization: () => {
      setMode("initial");
      setInspection((current) =>
        current
          ? {
              ...current,
              issue: "missing_connections",
              needsRegistryAuthorization: true,
            }
          : current,
      );
      setOpen(true);
    },
    reset: () => {
      setInspection(null);
      setMode("initial");
      setOpen(false);
    },
    setInspection,
  };
}
