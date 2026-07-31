import type { DeploymentPathRoute, PublicRouteStatus } from "../../types";

const WEB_SERVICE =
  /(^|[-_.])(web|h5|frontend|front|site|www|app|portal)([-_.]|$)/i;
const WEB_HOST = /(^|\.)(www|web|h5|app|site|portal)\./i;

export interface OrderedPublicAddresses {
  addresses: string[];
  primaryAddress: string | null;
}

/**
 * Keeps address selection deterministic across the success page and home.
 * Explicit route-to-service information wins; host naming is only a fallback
 * for older deployment records which did not persist route metadata.
 */
export function orderedPublicAddresses(
  checks: readonly PublicRouteStatus[],
  routes: readonly DeploymentPathRoute[] = [],
): OrderedPublicAddresses {
  const reachable = checks.filter(
    (check) => check.reachable && Boolean(check.url.trim()),
  );
  const serviceByHost = new Map(
    routes.map((route) => [normalizedHost(route.host), route.service] as const),
  );
  const ordered = [...reachable].sort((left, right) => {
    const leftRank = addressRank(left.host, serviceByHost);
    const rightRank = addressRank(right.host, serviceByHost);
    return leftRank - rightRank;
  });
  const addresses = Array.from(new Set(ordered.map((check) => check.url)));
  return { addresses, primaryAddress: addresses[0] ?? null };
}

function addressRank(host: string, serviceByHost: ReadonlyMap<string, string>) {
  const normalized = normalizedHost(host);
  const service = serviceByHost.get(normalized);
  if (service && WEB_SERVICE.test(service)) return 0;
  if (service) return 2;
  return WEB_HOST.test(normalized) ? 1 : 3;
}

function normalizedHost(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}
