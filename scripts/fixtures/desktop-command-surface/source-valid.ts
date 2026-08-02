import { invoke as callDesktop } from "@tauri-apps/api/core";

await callDesktop<string>("alpha");
await callDesktop("beta", { enabled: true });
await callDesktop<{
  ready: boolean;
}>("gamma");
