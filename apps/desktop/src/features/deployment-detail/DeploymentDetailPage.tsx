import {
  ArrowLeft,
  ExternalLink,
  History,
  LoaderCircle,
  RotateCcw,
  Rocket,
  Settings2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import type { DeploymentPath, DeploymentRunStatus } from "../../types";
import type { DeploymentDetailProjection } from "./model";

interface DeploymentDetailPageProps {
  loading: boolean;
  onBack: () => void;
  onOpenAddress: (address: string) => void;
  onRestore: (runId: string) => void;
  onSettings: () => void;
  onUpdate: () => void;
  path: DeploymentPath | null;
  projectName: string;
  projection: DeploymentDetailProjection | null;
  restoringRunId: string | null;
}

const statusLabels: Record<DeploymentRunStatus, string> = {
  cancelled: "已取消",
  failed: "未完成",
  needs_action: "需要处理",
  queued: "等待中",
  running: "正在上线",
  success: "上线成功",
};

export function DeploymentDetailPage({
  loading,
  onBack,
  onOpenAddress,
  onRestore,
  onSettings,
  onUpdate,
  path,
  projectName,
  projection,
  restoringRunId,
}: DeploymentDetailPageProps) {
  const current = projection?.currentRun ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="返回我的部署"
            onClick={onBack}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold">
                {projectName}
              </h1>
              {current ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  已上线
                </span>
              ) : null}
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              {path?.name ?? "部署详情"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="部署设置"
            disabled={!path}
            onClick={onSettings}
            size="icon"
            title="部署设置"
            variant="secondary"
          >
            <Settings2 />
          </Button>
          <Button onClick={onUpdate}>
            <Rocket />
            {current ? "更新上线" : "开始上线"}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted-foreground)]">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              正在读取当前线上结果
            </div>
          ) : !path || !current || !projection ? (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow-sm)]">
              <h2 className="text-lg font-semibold">还没有在线版本</h2>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                完成第一次上线后，这里会显示访问地址和上线记录。
              </p>
              <Button className="mt-5" onClick={onUpdate}>
                <Rocket />
                开始上线
              </Button>
            </section>
          ) : (
            <>
              {projection.failedUpdate ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                  <h2 className="font-semibold text-amber-950">
                    最近一次更新没有完成
                  </h2>
                  <p className="mt-1 text-sm text-amber-900">
                    当前在线版本未受影响。{projection.failedUpdate.message}
                  </p>
                </section>
              ) : null}

              <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 shadow-[var(--shadow-sm)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-emerald-700">
                      当前在线
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">
                      项目正在服务器运行
                    </h2>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      上线于 {formatDate(current.updatedAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                    已验证
                  </span>
                </div>

                {projection.addresses.length > 0 ? (
                  <div className="mt-5 space-y-2">
                    {projection.addresses.map((address) => (
                      <button
                        className="flex w-full items-center justify-between rounded-xl border border-emerald-100 bg-white px-4 py-3 text-left text-sm hover:border-emerald-300"
                        key={address}
                        onClick={() => onOpenAddress(address)}
                        type="button"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {address}
                        </span>
                        <span className="ml-3 flex shrink-0 items-center gap-2">
                          {address === projection.primaryAddress ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                              主要网页
                            </span>
                          ) : null}
                          <ExternalLink className="size-4 text-[var(--muted-foreground)]" />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-5 rounded-xl bg-white/80 px-4 py-3 text-sm text-[var(--muted-foreground)]">
                    当前版本已上线，但没有保存可直接打开的已验证网址。
                  </p>
                )}

                <div className="mt-5 grid gap-4 border-t border-emerald-200 pt-4 text-sm sm:grid-cols-3">
                  <Fact
                    label="源码版本"
                    value={shortCommit(current.commitSha)}
                  />
                  <Fact
                    label="运行位置"
                    value={path.serverId ? "已连接的服务器" : "服务器"}
                  />
                  <Fact
                    label="运行版本"
                    value={`${current.artifacts.length} 个服务镜像`}
                  />
                </div>

                {current.artifacts.length > 0 ? (
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer text-[var(--muted-foreground)]">
                      查看运行版本
                    </summary>
                    <div className="mt-2 rounded-xl bg-white/80 px-4 py-2">
                      {current.artifacts.map((artifact) => (
                        <div
                          className="flex justify-between gap-4 border-b border-[var(--border)] py-2 last:border-0"
                          key={`${artifact.service}-${artifact.digest}`}
                        >
                          <span className="font-medium">
                            {artifact.service}
                          </span>
                          <span className="truncate font-mono text-xs text-[var(--muted-foreground)]">
                            {shortDigest(artifact.digest)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </section>

              <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
                <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5">
                  <span className="flex items-center gap-2 font-semibold">
                    <History className="size-4" />
                    上线记录
                  </span>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {projection.history.length} 次
                  </span>
                </summary>
                <div className="border-t border-[var(--border)] px-6">
                  {projection.history.map(
                    ({ run, current: isCurrent, canRestore }) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-4 last:border-0"
                        key={run.id}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {statusLabels[run.status]}
                            </span>
                            {isCurrent ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                                当前在线
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                            {formatDate(run.updatedAt)} ·{" "}
                            {shortCommit(run.commitSha)}
                            {run.sourceTitle ? ` · ${run.sourceTitle}` : ""}
                          </p>
                        </div>
                        {canRestore ? (
                          <Button
                            disabled={Boolean(restoringRunId)}
                            onClick={() => onRestore(run.id)}
                            size="sm"
                            variant="secondary"
                          >
                            {restoringRunId === run.id ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <RotateCcw />
                            )}
                            恢复此版本
                          </Button>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function shortCommit(value: string | null) {
  return value ? `Commit ${value.slice(0, 12)}` : "未记录";
}

function shortDigest(value: string) {
  const digest = value.replace(/^sha256:/, "");
  return digest.length > 20
    ? `${digest.slice(0, 10)}…${digest.slice(-8)}`
    : digest;
}
