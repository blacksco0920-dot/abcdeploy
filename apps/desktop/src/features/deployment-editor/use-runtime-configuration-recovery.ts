import { useCallback, useMemo, useState } from "react";
import { issueFromUnknown } from "../../lib/errors";
import type { RuntimeConfigFile } from "../../types";
import type { DeploymentEditorServices } from "./deployment-editor-services";
import { loadScopedRuntimeConfiguration } from "./runtime-configuration-recovery";

export function useRuntimeConfigurationRecovery({
  deploymentPathId,
  onError,
  onSaved,
  projectPath,
  services,
}: {
  deploymentPathId: () => string | null;
  onError: (message: string) => void;
  onSaved: () => Promise<void>;
  projectPath: () => string | undefined;
  services: DeploymentEditorServices;
}) {
  const [configuration, setConfiguration] = useState<RuntimeConfigFile | null>(
    null,
  );
  const open = useCallback(
    (requiredVariables?: readonly string[]) => {
      void loadScopedRuntimeConfiguration(
        services.loadRuntimeConfig,
        projectPath(),
        deploymentPathId(),
        requiredVariables,
      )
        .then(setConfiguration)
        .catch((error) =>
          onError(issueFromUnknown(error, "运行配置没有读取完成").message),
        );
    },
    [deploymentPathId, onError, projectPath, services.loadRuntimeConfig],
  );
  const dialog = useMemo(
    () =>
      configuration
        ? {
            content: configuration.content,
            open: true,
            requiredVariables: configuration.requiredVariables,
            onCancel: () => setConfiguration(null),
            onSave: (content: string) => {
              const path = projectPath();
              if (!path || !services.storeRuntimeConfig) {
                onError("运行配置没有保存；任务和已生成版本都已保留");
                return;
              }
              void services
                .storeRuntimeConfig(path, configuration.environment, content)
                .then(async () => {
                  setConfiguration(null);
                  await onSaved();
                })
                .catch((error) =>
                  onError(issueFromUnknown(error, "运行配置没有保存").message),
                );
            },
          }
        : undefined,
    [configuration, onError, onSaved, projectPath, services],
  );
  return { dialog, open };
}
