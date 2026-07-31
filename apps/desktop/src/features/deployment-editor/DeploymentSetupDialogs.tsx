import { useEffect, useState } from "react";
import { CnbSecretHandoffDialog } from "./CnbSecretHandoffDialog";
import { ServerAddressDialog } from "./ServerAddressDialog";
import {
  ServerDeploymentSetupDialog,
  type ServerDeploymentSetupDialogMode,
} from "./ServerDeploymentSetupDialog";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { ServerDeploymentSetupInspection } from "./server-deployment-setup-service";
import type { DeploymentPath } from "../../types";

interface DeploymentSetupDialogsProps {
  addressRequired: boolean;
  inspection: ServerDeploymentSetupInspection | null;
  mode: ServerDeploymentSetupDialogMode;
  onClose: () => void;
  onResolved: (
    continueRun: boolean,
    inspection?: ServerDeploymentSetupInspection,
  ) => Promise<void>;
  open: boolean;
  services: DeploymentEditorServices;
}

export function DeploymentSetupDialogs({
  addressRequired,
  inspection,
  mode,
  onClose,
  onResolved,
  open,
  services,
}: DeploymentSetupDialogsProps) {
  const [handoff, setHandoff] = useState<Awaited<
    ReturnType<
      NonNullable<DeploymentEditorServices["authorizeServerDeploymentServices"]>
    >
  > | null>(null);
  const [activeInspection, setActiveInspection] =
    useState<ServerDeploymentSetupInspection | null>(null);
  const [settingsAddressOpen, setSettingsAddressOpen] = useState(false);
  const currentInspection = activeInspection ?? inspection;

  useEffect(() => {
    if (!open) {
      setActiveInspection(null);
      setSettingsAddressOpen(false);
      setHandoff(null);
    }
  }, [open]);

  const addressOpen =
    open &&
    ((mode === "initial" &&
      (addressRequired || currentInspection?.issue === "missing_address")) ||
      (mode === "settings" && settingsAddressOpen));
  const authorize = services.authorizeServerDeploymentServices;
  const shouldContinueRun = mode === "initial";

  async function inspectionAfterSave(
    base: ServerDeploymentSetupInspection,
    serverId: string,
  ) {
    if (!services.inspectServerDeploymentSetup) {
      return { ...base, serverId, issue: null };
    }
    return services.inspectServerDeploymentSetup(base.projectPath, serverId);
  }

  function continueSettings(next: ServerDeploymentSetupInspection) {
    setActiveInspection(next);
    setSettingsAddressOpen(true);
  }

  return (
    <>
      <ServerDeploymentSetupDialog
        inspection={currentInspection}
        mode={mode}
        onAuthorize={
          authorize
            ? async (input) => {
                if (!currentInspection) throw new Error("请重新检查上线设置");
                const result = await authorize(currentInspection, input);
                if (result.secretHandoffRequired) {
                  setHandoff(result);
                  return;
                }
                if (mode === "settings") {
                  continueSettings(result.inspection);
                } else {
                  await onResolved(shouldContinueRun, result.inspection);
                }
              }
            : undefined
        }
        onClose={onClose}
        onRetry={async () => {
          if (
            mode === "settings" &&
            currentInspection &&
            services.inspectServerDeploymentSetup
          ) {
            const refreshed = await services.inspectServerDeploymentSetup(
              currentInspection.projectPath,
              currentInspection.serverId,
            );
            setActiveInspection(refreshed);
            if (!refreshed.issue || refreshed.issue === "missing_address") {
              continueSettings(refreshed);
            }
            return;
          }
          await onResolved(false);
        }}
        onOpenProviderSetup={services.openAddress}
        onSave={async (sourceConnectionId, registryConnectionId, serverId) => {
          if (!currentInspection) throw new Error("请重新检查上线设置");
          const saved = await services.saveServerDeploymentSetup(
            currentInspection,
            sourceConnectionId,
            registryConnectionId,
            serverId,
          );
          if (mode === "settings") {
            const refreshed = await inspectionAfterSave(
              currentInspection,
              serverId,
            );
            continueSettings({
              ...refreshed,
              paths: pathsAfterSave(
                refreshed.paths,
                saved,
                currentInspection.paths,
              ),
            });
          } else {
            await onResolved(shouldContinueRun);
          }
        }}
        open={open && !addressOpen && !handoff}
      />
      <ServerAddressDialog
        inspection={currentInspection}
        mode={mode}
        onBack={
          mode === "settings" ? () => setSettingsAddressOpen(false) : undefined
        }
        onClose={onClose}
        onOpenUrl={services.openAddress}
        onSave={async (routes) => {
          if (!currentInspection) throw new Error("请重新检查项目访问地址");
          const saved = await services.saveServerDeploymentAddress(
            currentInspection,
            routes,
          );
          if (mode === "settings") {
            const refreshed = await inspectionAfterSave(
              currentInspection,
              currentInspection.serverId,
            );
            setSettingsAddressOpen(false);
            setActiveInspection(null);
            await onResolved(false, {
              ...refreshed,
              paths: pathsAfterSave(
                refreshed.paths,
                saved,
                currentInspection.paths,
              ),
            });
          } else {
            await onResolved(addressRequired);
          }
        }}
        open={addressOpen}
      />
      <CnbSecretHandoffDialog
        handoff={handoff}
        onClose={() => {
          setHandoff(null);
          onClose();
        }}
        onComplete={async () => {
          if (!handoff || !services.completeServerDeploymentAuthorization) {
            throw new Error("安全配置状态没有保存，请重新检查上线设置");
          }
          const nextInspection =
            await services.completeServerDeploymentAuthorization(
              handoff.inspection,
              handoff.secretRepository,
            );
          setHandoff(null);
          if (mode === "settings") {
            continueSettings(nextInspection);
          } else {
            await onResolved(shouldContinueRun, nextInspection);
          }
        }}
        onOpenUrl={services.openAddress}
        open={open && Boolean(handoff)}
      />
    </>
  );
}

function pathsAfterSave(
  refreshed: DeploymentPath[],
  saved: DeploymentPath | undefined,
  previous: DeploymentPath[],
) {
  if (refreshed.length > 0) return refreshed;
  if (saved) return [saved];
  return previous;
}
