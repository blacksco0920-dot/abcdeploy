import { describe, expect, it } from "vitest";
import type { WorkspacePreview } from "../types";
import { secretRepositoryFromManifest } from "./workspace";

function workspace(manifestYaml: string) {
  return { manifestYaml } as WorkspacePreview;
}

describe("secretRepositoryFromManifest", () => {
  it("extracts only the reusable repository identity", () => {
    expect(
      secretRepositoryFromManifest(
        workspace(
          "environments:\n  staging:\n    secrets_ref: https://cnb.cool/team/project-secrets/-/blob/main/staging.yml",
        ),
        "staging",
      ),
    ).toBe("team/project-secrets");
  });

  it("rejects placeholders and unrelated providers", () => {
    expect(
      secretRepositoryFromManifest(
        workspace(
          "environments:\n  production:\n    secrets_ref: https://cnb.cool/owner/replace-me/-/blob/main/production.yml",
        ),
        "production",
      ),
    ).toBe("");
    expect(
      secretRepositoryFromManifest(
        workspace(
          "environments:\n  production:\n    secrets_ref: https://example.com/team/secrets",
        ),
        "production",
      ),
    ).toBe("");
  });
});
