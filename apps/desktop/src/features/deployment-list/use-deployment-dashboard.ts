import { useCallback, useEffect, useRef, useState } from "react";
import {
  listActiveDeploymentRuns,
  listAttentionDeploymentRuns,
  listCurrentDeploymentRuns,
  listRecentProjects,
  listRecentSuccessfulDeploymentRuns,
  refreshDeployment,
} from "../../api";
import type { DeploymentRun, RecentProject } from "../../types";

const ACTIVE_REFRESH_MS = 8_000;
const IDLE_REFRESH_MS = 60_000;

export function deploymentRefreshDelay(hasActiveRuns: boolean) {
  return hasActiveRuns ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
}

export function mergeDashboardRuns(...groups: DeploymentRun[][]) {
  const byId = new Map<string, DeploymentRun>();
  for (const run of groups.flat()) {
    const current = byId.get(run.id);
    if (!current || run.updatedAt >= current.updatedAt) byId.set(run.id, run);
  }
  return [...byId.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function useAppForeground() {
  const [foreground, setForeground] = useState(
    () =>
      typeof document === "undefined" ||
      (document.visibilityState !== "hidden" && document.hasFocus()),
  );

  useEffect(() => {
    const update = () =>
      setForeground(
        document.visibilityState !== "hidden" && document.hasFocus(),
      );
    const hide = () => setForeground(false);
    window.addEventListener("focus", update);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return foreground;
}

export function useDeploymentDashboard(onError: (error: unknown) => void) {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [activeRuns, setActiveRuns] = useState<DeploymentRun[]>([]);
  const [attentionRuns, setAttentionRuns] = useState<DeploymentRun[]>([]);
  const [successfulRuns, setSuccessfulRuns] = useState<DeploymentRun[]>([]);
  const [currentRuns, setCurrentRuns] = useState<DeploymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const inFlight = useRef<Promise<void> | null>(null);
  const foreground = useAppForeground();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (refreshActive = true, showLoading = false) => {
      if (inFlight.current) return inFlight.current;
      const operation = (async () => {
        if (showLoading && mounted.current) setLoading(true);
        try {
          let active = await listActiveDeploymentRuns();
          if (refreshActive && active.length) {
            await Promise.allSettled(
              active.map((run) => refreshDeployment(run.id)),
            );
            active = await listActiveDeploymentRuns();
          }
          const [nextProjects, attention, successful, current] =
            await Promise.all([
              listRecentProjects(),
              listAttentionDeploymentRuns(),
              listRecentSuccessfulDeploymentRuns(),
              listCurrentDeploymentRuns(),
            ]);
          if (!mounted.current) return;
          setProjects(nextProjects);
          setActiveRuns(active);
          setAttentionRuns(attention);
          setSuccessfulRuns(successful);
          setCurrentRuns(current);
        } catch (error) {
          if (mounted.current) onError(error);
        } finally {
          if (mounted.current) setLoading(false);
        }
      })();
      inFlight.current = operation;
      try {
        await operation;
      } finally {
        inFlight.current = null;
      }
    },
    [onError],
  );

  useEffect(() => {
    void refresh(false, true);
  }, [refresh]);

  useEffect(() => {
    if (!foreground) return;
    const timer = window.setTimeout(
      () => void refresh(true),
      deploymentRefreshDelay(activeRuns.length > 0),
    );
    return () => window.clearTimeout(timer);
  }, [activeRuns.length, foreground, refresh]);

  return {
    loading,
    projects,
    currentRuns,
    refresh,
    taskRuns: mergeDashboardRuns(activeRuns, attentionRuns, successfulRuns),
  };
}
