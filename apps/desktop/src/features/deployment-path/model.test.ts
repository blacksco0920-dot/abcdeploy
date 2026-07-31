import { describe, expect, it } from "vitest";
import type { DeploymentRun, WorkspacePreview } from "../../types";
import {
  automaticRouteDrafts,
  connectionNeedsRepair,
  connectionProviderLabel,
  displayedDeploymentPathState,
  deploymentStageLabel,
  isPreparedDeploymentRetry,
  isResumableDeploymentRetry,
  manifestRoutes,
  normalizedAddress,
  projectedTaskTone,
  repositoryConfigured,
  updateManifestRegistry,
  updateManifestRepository,
} from "./model";

describe("deployment path model", () => {
  it("keeps repository validation independent from the view", () => {
    expect(repositoryConfigured("owner/replace-me")).toBe(false);
    expect(repositoryConfigured("blacksc00920/FinAgent")).toBe(true);
  });

  it("只把已有不可变版本的服务器部署故障识别为可直接重试", () => {
    const run = {
      status: "needs_action",
      actionKind: "deployment-path-retry",
      currentStage: "deploy",
      artifacts: [{ service: "web" }],
    } as DeploymentRun;
    expect(isResumableDeploymentRetry(run)).toBe(true);
    expect(isResumableDeploymentRetry({ ...run, artifacts: [] })).toBe(false);
  });

  it("reads structured routes and ignores malformed entries", () => {
    expect(
      manifestRoutes(`
environments:
  production:
    domains:
      - service: web
        host: app.example.com
      - host: ignored.example.com
`),
    ).toEqual([{ service: "web", host: "app.example.com", path: "/" }]);
  });

  it("updates provider facts without making the view manipulate YAML", () => {
    const repositoryYaml = updateManifestRepository("{}", "team/project");
    expect(repositoryYaml).toContain("repository: team/project");
    const registryYaml = updateManifestRegistry(
      repositoryYaml,
      "ccr.ccs.tencentyun.com",
      "customer",
    );
    expect(registryYaml).toContain("registry: ccr.ccs.tencentyun.com");
    expect(registryYaml).toContain("namespace: customer");
  });

  it("creates sslip.io drafts only for empty hosts and valid IPv4 servers", () => {
    const workspace = {
      inspection: { project_name: "Fin Agent" },
    } as WorkspacePreview;
    expect(
      automaticRouteDrafts(
        [{ service: "H5 Web", host: "", path: "/" }],
        workspace,
        { host: "119.91.112.80" },
      ),
    ).toEqual([
      {
        service: "H5 Web",
        host: "fin-agent-h5-web.119-91-112-80.sslip.io",
        path: "/",
      },
    ]);
  });

  it("projects a running task onto every node", () => {
    const run = {
      status: "running",
      currentStage: "trigger-build",
    } as DeploymentRun;
    expect(projectedTaskTone(run, "local")).toBe("ready");
    expect(projectedTaskTone(run, "build")).toBe("working");
    expect(projectedTaskTone(run, "registry")).toBe("waiting");
  });

  it("uses the latest run fact instead of leaving the workflow visually deploying", () => {
    expect(
      displayedDeploymentPathState(
        "deploying",
        { status: "success" } as DeploymentRun,
        true,
      ),
    ).toBe("online");
    expect(
      displayedDeploymentPathState(
        "online",
        { status: "running" } as DeploymentRun,
        true,
      ),
    ).toBe("deploying");
    expect(
      displayedDeploymentPathState(
        "deploying",
        { status: "needs_action" } as DeploymentRun,
        false,
      ),
    ).toBe("needs_action");
    expect(displayedDeploymentPathState("draft", undefined, true)).toBe(
      "ready",
    );
  });

  it("distinguishes a repaired task that is ready to continue from an unresolved failure", () => {
    expect(
      isPreparedDeploymentRetry({
        status: "needs_action",
        actionKind: "deployment-path-retry",
        issueCode: null,
      } as DeploymentRun),
    ).toBe(true);
    expect(
      isPreparedDeploymentRetry({
        status: "needs_action",
        actionKind: "deployment-path-retry",
        issueCode: "AD-SRV-205",
      } as DeploymentRun),
    ).toBe(false);
  });

  it("keeps provider and stage language user-facing", () => {
    expect(connectionProviderLabel({ provider: "tcr" } as never)).toBe(
      "腾讯云 TCR",
    );
    expect(
      connectionNeedsRepair({ status: "needs_authorization" } as never),
    ).toBe(true);
    expect(deploymentStageLabel("healthcheck")).toBe("检查服务可用性");
    expect(normalizedAddress("app.example.com")).toBe(
      "https://app.example.com",
    );
  });
});
