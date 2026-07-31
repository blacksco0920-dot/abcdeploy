import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ConfigProfile,
  ConfigProfileInput,
  EnvironmentConfigBindings,
  ProjectProfileBinding,
  RuntimeEnvironment,
} from "../types";

const DEMO_CONFIG_PROFILES_KEY = "abcdeploy.demo.config-profiles";
const demoConfigProfileSecrets = new Map<string, Record<string, string>>();
const demoGeneratedRuntimeSecrets = new Map<string, string>();

export async function listConfigProfiles(): Promise<ConfigProfile[]> {
  if (!isTauri()) return readDemoConfigProfiles();
  return invoke<ConfigProfile[]>("list_config_profiles");
}

export async function saveConfigProfile(
  input: ConfigProfileInput,
): Promise<ConfigProfile> {
  if (isTauri()) return invoke<ConfigProfile>("save_config_profile", { input });
  const profiles = readDemoConfigProfiles();
  const id = input.id ?? `${input.kind}-${Date.now()}`;
  const profile: ConfigProfile = {
    id,
    kind: input.kind,
    provider: input.provider,
    name: input.name,
    scope: input.scope,
    values: input.values,
    secretFields: input.secretFields,
    configuredSecretFields: input.secretFields.filter(
      (field) =>
        Boolean(input.secrets[field]) ||
        profiles
          .find((item) => item.id === id)
          ?.configuredSecretFields.includes(field),
    ),
    isDefault:
      input.isDefault ||
      !profiles.some((candidate) => candidate.kind === input.kind),
    updatedAt: new Date().toISOString(),
  };
  demoConfigProfileSecrets.set(id, {
    ...(demoConfigProfileSecrets.get(id) ?? {}),
    ...Object.fromEntries(
      Object.entries(input.secrets).filter(([, value]) => Boolean(value)),
    ),
  });
  const next = profiles
    .filter((candidate) => candidate.id !== id)
    .map((candidate) =>
      profile.isDefault && candidate.kind === profile.kind
        ? { ...candidate, isDefault: false }
        : candidate,
    );
  next.push(profile);
  localStorage.setItem(DEMO_CONFIG_PROFILES_KEY, JSON.stringify(next));
  return profile;
}

export async function deleteConfigProfile(id: string): Promise<boolean> {
  if (isTauri()) return invoke<boolean>("delete_config_profile", { id });
  const profiles = readDemoConfigProfiles();
  const next = profiles.filter((profile) => profile.id !== id);
  localStorage.setItem(DEMO_CONFIG_PROFILES_KEY, JSON.stringify(next));
  demoConfigProfileSecrets.delete(id);
  return next.length !== profiles.length;
}

export async function bindConfigProfile(
  path: string,
  environment: RuntimeEnvironment,
  kind: ConfigProfile["kind"],
  profileId: string,
): Promise<ProjectProfileBinding> {
  if (isTauri()) {
    return invoke<ProjectProfileBinding>("bind_config_profile", {
      path,
      environment,
      kind,
      profileId,
    });
  }
  const binding = { environment, kind, profileId };
  const bindings = readDemoConfigProfileBindings(path, environment).filter(
    (current) => current.profileId !== profileId,
  );
  bindings.push(binding);
  writeDemoConfigProfileBindings(path, environment, bindings);
  return binding;
}

export async function listConfigProfileBindings(
  path: string,
  environment: RuntimeEnvironment,
): Promise<EnvironmentConfigBindings> {
  if (!isTauri()) return readDemoConfigProfileBindings(path, environment);
  return invoke<ProjectProfileBinding[]>("list_config_profile_bindings", {
    path,
    environment,
  });
}

export async function setEnvironmentConfigBindings(
  path: string,
  environment: RuntimeEnvironment,
  profileIds: string[],
): Promise<EnvironmentConfigBindings> {
  if (isTauri()) {
    return invoke<ProjectProfileBinding[]>("set_environment_config_bindings", {
      path,
      environment,
      profileIds,
    });
  }
  const profiles = readDemoConfigProfiles();
  const bindings = Array.from(new Set(profileIds)).map((profileId) => {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error(`所选配置中心连接已不存在：${profileId}`);
    const supported =
      profile.scope === "any" ||
      (profile.scope === "local" && environment === "development") ||
      (profile.scope === "remote" && environment !== "development");
    if (!supported) throw new Error(`配置“${profileId}”不适用于当前运行环境`);
    return { environment, kind: profile.kind, profileId };
  });
  writeDemoConfigProfileBindings(path, environment, bindings);
  return bindings;
}

export function demoEmptyRuntimeVariables(content: string): string[] {
  return content.split("\n").flatMap((line) => {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/,
    );
    return match && ["", '\"\"', "''"].includes(match[2].trim())
      ? [match[1]]
      : [];
  });
}

export function demoInternalRuntimeSecret(variable: string): boolean {
  return [
    "JWT_SECRET",
    "AUTH_TOKEN_SECRET",
    "SESSION_SECRET",
    "COOKIE_SECRET",
    "ENCRYPTION_KEY",
    "SECRET_KEY",
  ].some((suffix) => variable === suffix || variable.endsWith(`_${suffix}`));
}

export function demoGeneratedRuntimeSecret(
  path: string,
  environment: RuntimeEnvironment,
  variable: string,
): string {
  const key = `${path}:${environment}:${variable}`;
  const existing = demoGeneratedRuntimeSecrets.get(key);
  if (existing) return existing;
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  demoGeneratedRuntimeSecrets.set(key, value);
  return value;
}

export function demoRuntimeValuesFromProfile(
  profile: ConfigProfile,
  path: string,
  environment: RuntimeEnvironment,
): Record<string, string> {
  const secrets = demoConfigProfileSecrets.get(profile.id) ?? {};
  if (profile.kind === "ai" && profile.provider === "minimax") {
    return {
      AI_PROVIDER: "minimax",
      ...(profile.values.base_url
        ? { MINIMAX_BASE_URL: profile.values.base_url }
        : {}),
      ...(profile.values.model ? { MINIMAX_MODEL: profile.values.model } : {}),
      ...(secrets.api_key ? { MINIMAX_API_KEY: secrets.api_key } : {}),
    };
  }
  if (
    profile.kind === "database" &&
    profile.provider === "abcdeploy_local_postgres" &&
    secrets.password
  ) {
    const project = path
      .split(/[\\/]/)
      .filter(Boolean)
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const database = `abc_demo_${project || "project"}_${environment}`;
    const host = profile.values.host || "127.0.0.1";
    const port = profile.values.port || "55432";
    const user = profile.values.user || "abcdeploy";
    return {
      DATABASE_URL: `postgresql://${user}:${secrets.password}@${host}:${port}/${database}`,
    };
  }
  if (
    profile.kind === "redis" &&
    profile.provider === "abcdeploy_local_redis" &&
    secrets.password
  ) {
    const host = profile.values.host || "127.0.0.1";
    const port = profile.values.port || "56379";
    return { REDIS_URL: `redis://:${secrets.password}@${host}:${port}/0` };
  }
  if (profile.kind === "database" && secrets.url)
    return { DATABASE_URL: secrets.url };
  if (profile.kind === "redis" && secrets.url)
    return { REDIS_URL: secrets.url };
  if (profile.kind !== "custom") return {};
  const variable = profile.values.env_name;
  const value = variable && (profile.values.env_value || secrets[variable]);
  return variable && value && /^[A-Z_][A-Z0-9_]*$/.test(variable)
    ? { [variable]: value }
    : {};
}

export function fillDemoRuntimeValues(
  content: string,
  suggestions: Record<string, string>,
) {
  const filledVariables: string[] = [];
  const lines = content.split("\n").map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=)(.*)$/);
    if (!match) return line;
    const [, assignment, variable, rawValue] = match;
    const suggestion = suggestions[variable];
    if (!suggestion || !["", '\"\"', "''"].includes(rawValue.trim()))
      return line;
    filledVariables.push(variable);
    return `${assignment}${demoDotenvValue(suggestion)}`;
  });
  return { content: lines.join("\n"), filledVariables };
}

export function readDemoConfigProfiles(): ConfigProfile[] {
  try {
    const profiles = (
      JSON.parse(
        localStorage.getItem(DEMO_CONFIG_PROFILES_KEY) ?? "[]",
      ) as ConfigProfile[]
    ).map((profile) => ({ ...profile, scope: profile.scope ?? "any" }));
    restoreDemoManagedProfileSecrets(profiles);
    return profiles;
  } catch {
    return [];
  }
}

function restoreDemoManagedProfileSecrets(profiles: ConfigProfile[]) {
  if (localStorage.getItem("abcdeploy.demo.local-infrastructure") !== "running")
    return;
  for (const profile of profiles) {
    if (
      ["abcdeploy_local_postgres", "abcdeploy_local_redis"].includes(
        profile.provider,
      ) &&
      !demoConfigProfileSecrets.has(profile.id)
    ) {
      demoConfigProfileSecrets.set(profile.id, {
        password: "demo-local-password",
      });
    }
  }
}

function demoDotenvValue(value: string) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function demoBindingKey(
  path: string,
  environment: RuntimeEnvironment,
  kind: ConfigProfile["kind"],
) {
  return `abcdeploy.demo.binding.${path}.${environment}.${kind}`;
}

function demoBindingsKey(path: string, environment: RuntimeEnvironment) {
  return `abcdeploy.demo.bindings.${encodeURIComponent(path)}.${environment}`;
}

function readDemoConfigProfileBindings(
  path: string,
  environment: RuntimeEnvironment,
): ProjectProfileBinding[] {
  const grouped = localStorage.getItem(demoBindingsKey(path, environment));
  if (grouped !== null) {
    try {
      return JSON.parse(grouped) as ProjectProfileBinding[];
    } catch {
      return [];
    }
  }
  return (["ai", "database", "redis", "dns", "registry", "custom"] as const)
    .map((kind) =>
      localStorage.getItem(demoBindingKey(path, environment, kind)),
    )
    .flatMap((value) =>
      value ? [JSON.parse(value) as ProjectProfileBinding] : [],
    );
}

function writeDemoConfigProfileBindings(
  path: string,
  environment: RuntimeEnvironment,
  bindings: ProjectProfileBinding[],
) {
  localStorage.setItem(
    demoBindingsKey(path, environment),
    JSON.stringify(bindings),
  );
  for (const kind of [
    "ai",
    "database",
    "redis",
    "dns",
    "registry",
    "custom",
  ] as const) {
    localStorage.removeItem(demoBindingKey(path, environment, kind));
  }
  for (const binding of bindings) {
    localStorage.setItem(
      demoBindingKey(path, environment, binding.kind),
      JSON.stringify(binding),
    );
  }
}
