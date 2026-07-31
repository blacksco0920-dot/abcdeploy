import type { RuntimeConfigFile } from "../../types";

export function scopeRuntimeConfiguration(
  configuration: RuntimeConfigFile,
  missingVariables: readonly string[] | undefined,
): RuntimeConfigFile {
  if (!missingVariables?.length) return configuration;
  return {
    ...configuration,
    requiredVariables: [...missingVariables],
  };
}

export async function loadScopedRuntimeConfiguration(
  load:
    | ((
        projectPath: string,
        environment: RuntimeConfigFile["environment"],
      ) => Promise<RuntimeConfigFile>)
    | undefined,
  projectPath: string | undefined,
  pathId: string | null,
  missingVariables: readonly string[] | undefined,
) {
  if (!load || !projectPath || !pathId) {
    throw new Error("无法打开当前线路的运行配置；任务和已生成版本都已保留");
  }
  return scopeRuntimeConfiguration(
    await load(projectPath, pathId as RuntimeConfigFile["environment"]),
    missingVariables,
  );
}
