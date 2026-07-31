import {
  bindProjectServer,
  checkServer,
  generateSshIdentity,
  installServerKeyWithPassword,
} from "../../api";
import type { ProviderCheck, ServerForm, ServerResource } from "../../types";

export interface NewServerInput {
  name: string;
  host: string;
  user: string;
  port: number;
  keyPath?: string;
}

export interface PreparedServerConnection {
  form: ServerForm;
  fingerprint: string;
}

export async function verifySavedServer(
  server: ServerResource,
): Promise<ProviderCheck> {
  return checkServer(serverForm(server));
}

export async function prepareNewServerConnection(
  input: NewServerInput,
): Promise<PreparedServerConnection> {
  const keyPath = input.keyPath
    ? input.keyPath
    : (await generateSshIdentity()).identity.path;
  const form: ServerForm = {
    name: input.name,
    host: input.host,
    user: input.user,
    port: input.port,
    keyPath,
  };
  const check = await checkServer(form);
  if (check.ok) {
    throw new Error(
      "这台服务器已经可以使用密钥连接，请从已有服务器列表中选择。",
    );
  }
  const fingerprint = check.details.find((detail) =>
    detail.startsWith("SHA256:"),
  );
  if (!fingerprint) throw new Error(check.summary);
  return {
    form: { ...form, hostFingerprint: fingerprint },
    fingerprint,
  };
}

export async function confirmNewServerConnection(
  sourcePath: string,
  prepared: PreparedServerConnection,
  password: string,
): Promise<ServerResource> {
  const installed = await installServerKeyWithPassword(prepared.form, password);
  if (!installed.ok) throw new Error(installed.summary);
  const verified = await checkServer(prepared.form);
  if (!verified.ok) throw new Error(verified.summary);
  // "staging" is currently only the storage adapter key. The MVP exposes one
  // generic server environment and stores the returned reusable Server id.
  return bindProjectServer(sourcePath, "staging", prepared.form);
}

function serverForm(server: ServerResource): ServerForm {
  return {
    name: server.name,
    host: server.host,
    user: server.user,
    port: server.port,
    keyPath: server.keyPath,
    hostFingerprint: server.hostFingerprint,
  };
}
