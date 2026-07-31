import { parseDocument } from "yaml";
import type { WorkspacePreview } from "../types";

/**
 * Returns the reusable CNB secret repository encoded by the current manifest.
 *
 * The workflow UI only needs the repository identity. Secret file contents and
 * credentials never cross this boundary.
 */
export function secretRepositoryFromManifest(
  workspace: WorkspacePreview,
  environment: "staging" | "production",
) {
  const reference = parseDocument(workspace.manifestYaml).getIn([
    "environments",
    environment,
    "secrets_ref",
  ]);
  if (typeof reference !== "string" || reference.includes("replace-me")) {
    return "";
  }
  return reference.match(/^https:\/\/cnb\.cool\/(.+?)\/-\/blob\//)?.[1] ?? "";
}
