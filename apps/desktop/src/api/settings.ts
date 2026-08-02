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

export async function setAppSetting(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(`abcdeploy.setting.${key}`, value);
    return;
  }
  return invoke("set_app_setting", { key, value });
}
