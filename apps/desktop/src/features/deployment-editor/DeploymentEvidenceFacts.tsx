import { ExternalLink } from "lucide-react";
import type { DeploymentEditorViewModel } from "./model";

export function DeploymentEvidenceSection({
  model,
}: {
  model: DeploymentEditorViewModel;
}) {
  const evidence = model.evidence;
  if (!evidence) return null;
  const publicBlocked =
    evidence.projection.status === "service_running_public_access_blocked";
  const current = evidence.projection.canShowCurrentSuccess;
  return (
    <section
      aria-labelledby="result-heading"
      className={`rounded-xl border p-5 ${current ? "border-[var(--success)]/30 bg-[var(--success-soft)]" : "border-[var(--warning)]/30 bg-[var(--warning-soft)]"}`}
    >
      <h2 className="m-0 text-base font-semibold" id="result-heading">
        {current
          ? "运行成功"
          : publicBlocked
            ? "服务已运行，访问地址仍需处理"
            : "结果仍在验证"}
      </h2>
      <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
        {current
          ? `关键检查已连续通过 ${evidence.projection.consecutivePassCount} 次 · ${evidence.checkedAtLabel}`
          : "已经成立的运行事实会保留，不会重复生成相同版本。"}
      </p>
      {evidence.addresses.length ? (
        <div className="mt-4 space-y-2">
          {evidence.addresses.map((address) => (
            <a
              className="flex items-center justify-between rounded-lg border border-current/10 bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] no-underline"
              href={address}
              key={address}
              rel="noreferrer"
              target="_blank"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{address}</span>
                {address === evidence.primaryAddress ? (
                  <span className="shrink-0 rounded bg-[var(--success-soft)] px-1.5 py-0.5 text-[10px] text-[var(--success)]">
                    主要网页
                  </span>
                ) : null}
              </span>
              <ExternalLink className="size-4 shrink-0 text-[var(--muted-foreground)]" />
            </a>
          ))}
        </div>
      ) : null}
      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <EvidenceFact
          label="源码版本"
          title={evidence.sourceIdentity}
          value={sourceVersionLabel(evidence.sourceIdentity)}
        />
        <RuntimeVersionFact
          fallback={evidence.runtimeIdentity}
          versions={evidence.runtimeVersions ?? []}
        />
        <EvidenceFact label="运行位置" value={evidence.environmentLabel} />
        <EvidenceFact label="服务与依赖" value={evidence.serviceSummary} />
      </dl>
    </section>
  );
}

export function EvidenceFact({
  label,
  title,
  value,
}: {
  label: string;
  title?: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd
        className="m-0 mt-1 break-all font-medium text-[var(--foreground)]"
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

export function RuntimeVersionFact({
  fallback,
  versions,
}: {
  fallback: string;
  versions: readonly { service: string; image: string; digest: string }[];
}) {
  if (!versions.length) {
    return <EvidenceFact label="运行版本" value={fallback} />;
  }
  return (
    <details className="sm:col-span-2">
      <summary className="cursor-pointer text-[var(--foreground)]">
        <span className="text-[var(--muted-foreground)]">运行版本 · </span>
        <span className="font-medium">{versions.length} 个服务镜像已核验</span>
      </summary>
      <ul
        className="m-0 mt-2 grid gap-1 p-0 sm:grid-cols-2"
        aria-label="实际运行镜像"
      >
        {versions.map((version) => (
          <li
            className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-[var(--surface)]/70 px-2 py-1"
            key={`${version.service}-${version.digest}`}
            title={`${version.image}@${version.digest}`}
          >
            <span className="truncate font-medium">{version.service}</span>
            <code className="shrink-0 text-[11px] text-[var(--muted-foreground)]">
              {shortDigest(version.digest)}
            </code>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function sourceVersionLabel(identity: string) {
  return /^[a-f0-9]{40}$/i.test(identity)
    ? `Commit ${identity.slice(0, 12)}`
    : identity;
}

function shortDigest(digest: string) {
  const value = digest.replace(/^sha256:/i, "");
  return value.length > 20
    ? `${value.slice(0, 12)}…${value.slice(-8)}`
    : digest;
}
