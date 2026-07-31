import { describe, expect, it } from "vitest";
import {
  deploymentRefreshDelay,
  mergeDashboardRuns,
} from "./features/deployment-list/use-deployment-dashboard";
import type { DeploymentRun } from "./types";

describe("ABCDeploy 当前产品入口", () => {
  it("闲置时降低刷新频率，运行中保持及时", () => {
    expect(deploymentRefreshDelay(true)).toBe(8_000);
    expect(deploymentRefreshDelay(false)).toBe(60_000);
  });

  it("部署列表按任务编号去重并保留最新事实", () => {
    const older = {
      id: "run-1",
      updatedAt: "2026-07-26T10:00:00Z",
    } as DeploymentRun;
    const newer = {
      id: "run-1",
      updatedAt: "2026-07-26T10:01:00Z",
    } as DeploymentRun;
    const other = {
      id: "run-2",
      updatedAt: "2026-07-26T09:59:00Z",
    } as DeploymentRun;

    expect(mergeDashboardRuns([older], [other, newer])).toEqual([newer, other]);
  });
});
