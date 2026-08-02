import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ProviderCheck } from "../types";

function validateRegistryCredentials(
  registry: string,
  username: string,
  password: string,
): ProviderCheck {
  const ok = Boolean(registry.trim() && username.trim() && password);
  return {
    provider: "registry",
    ok,
    summary: ok ? "镜像仓库登录信息可用" : "登录信息还没有填写完整",
    details: [],
    code: ok ? undefined : "AD-IMG-201",
    nextSteps: ok ? [] : ["填写登录用户名和访问密码后重新验证"],
    retryable: false,
  };
}

export async function replaceRegistryCredentials(
  registry: string,
  secretPrefix: string,
  username: string,
  password: string,
  namespace?: string,
): Promise<ProviderCheck> {
  if (!isTauri()) {
    const result = validateRegistryCredentials(registry, username, password);
    if (result.ok && secretPrefix === "registry.tcr.v2") {
      localStorage.setItem(
        "abcdeploy.demo.connection.checked.tcr",
        new Date().toISOString(),
      );
    }
    return result;
  }
  return invoke<ProviderCheck>("replace_registry_credentials", {
    registry,
    secretPrefix,
    username,
    password,
    namespace,
  });
}

export async function checkSavedRegistryCredentials(
  registry: string,
  secretPrefix: string,
  namespace?: string,
): Promise<ProviderCheck> {
  if (!isTauri()) {
    return {
      provider: "registry",
      ok: true,
      summary: "镜像仓库登录信息可用",
      details: [],
      nextSteps: [],
      retryable: false,
    };
  }
  return invoke<ProviderCheck>("check_saved_registry_credentials", {
    registry,
    secretPrefix,
    namespace,
  });
}
