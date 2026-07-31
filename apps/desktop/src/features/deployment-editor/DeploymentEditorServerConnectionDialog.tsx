import type { ServerResource } from "../../types";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import type { SavedServerOption } from "./model";
import { ServerConnectionDialog } from "./ServerConnectionDialog";
import type { NewServerInput } from "./server-connection";
import { serverOption } from "./server-deployment-setup";

interface DeploymentEditorServerConnectionDialogProps {
  open: boolean;
  target: NewServerInput | null;
  sourcePath: string | null;
  savedServers: readonly SavedServerOption[];
  services: DeploymentEditorServices;
  onClose: () => void;
  onConfirmed: (
    resource: ServerResource,
    servers: SavedServerOption[],
  ) => Promise<void>;
}

export function DeploymentEditorServerConnectionDialog({
  open,
  target,
  sourcePath,
  savedServers,
  services,
  onClose,
  onConfirmed,
}: DeploymentEditorServerConnectionDialogProps) {
  return (
    <ServerConnectionDialog
      initialInput={target}
      onClose={onClose}
      onConnected={onClose}
      onConfirm={async (prepared, password) => {
        if (!sourcePath) throw new Error("请先重新选择项目");
        const resource = await services.confirmServerConnection(
          sourcePath,
          prepared,
          password,
        );
        await onConfirmed(resource, [
          serverOption(resource),
          ...savedServers.filter((item) => item.id !== resource.id),
        ]);
      }}
      onPrepare={services.prepareServerConnection}
      onOpenUrl={services.openAddress}
      open={open}
    />
  );
}
