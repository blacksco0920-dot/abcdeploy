import { invoke, isTauri } from "@tauri-apps/api/core";

export async function getAppSetting(key: string): Promise<string | null> {
  if (!isTauri()) {
    return (
      localStorage.getItem(`abcdeploy.setting.${key}`) ??
      (key === "registry.tcr.namespace" ? "demo" : null)
    );
  }
  return invoke<string | null>("get_app_setting", { key });
}

export async function getAppSettings(
  keys: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(keys));
  if (!isTauri()) {
    const entries = await Promise.all(
      unique.map(async (key) => [key, await getAppSetting(key)] as const),
    );
    return Object.fromEntries(
      entries.filter(
        (entry): entry is readonly [string, string] => entry[1] !== null,
      ),
    );
  }
  return invoke<Record<string, string>>("get_app_settings", { keys: unique });
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`abcdeploy.setting.${key}`, value);
    return;
  }
  return invoke("set_app_setting", { key, value });
}
