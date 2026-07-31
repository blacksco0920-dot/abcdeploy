import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  FolderOpen,
  Link2,
  LoaderCircle,
  MapPin,
  MoreHorizontal,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Brand } from "../../components/Brand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { DeploymentListItem, DeploymentListResultKind } from "./model";

export interface DeploymentListPageProps {
  items: DeploymentListItem[];
  onCreate: () => void;
  onOpen: (item: DeploymentListItem) => void;
  onRemove?: (item: DeploymentListItem) => void;
}

export function DeploymentListPage({
  items,
  onCreate,
  onOpen,
  onRemove,
}: DeploymentListPageProps) {
  const [removeCandidate, setRemoveCandidate] =
    useState<DeploymentListItem | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="flex h-[52px] shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-5">
        <Brand />
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1040px] px-6 py-8 max-[560px]:px-4 max-[560px]:py-6">
          <header className="flex items-start justify-between gap-6 max-[560px]:flex-col max-[560px]:items-stretch">
            <div className="min-w-0">
              <h1 className="m-0 text-xl font-semibold leading-7">我的部署</h1>
              <p className="mb-0 mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                查看每个项目当前实际运行在哪里，以及最近一次验证结果。
              </p>
            </div>
            <Button className="shrink-0 max-[560px]:w-full" onClick={onCreate}>
              <Plus />
              新建部署
            </Button>
          </header>

          {items.length ? (
            <ul
              aria-label="部署列表"
              className="m-0 mt-7 list-none space-y-3 p-0"
            >
              {items.map((item) => (
                <DeploymentListRow
                  item={item}
                  key={item.id}
                  onOpen={onOpen}
                  onRequestRemove={onRemove ? setRemoveCandidate : undefined}
                />
              ))}
            </ul>
          ) : (
            <section className="mt-7 flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-6 text-center">
              <span className="grid size-11 place-items-center rounded-xl bg-[var(--muted)] text-[var(--subtle-foreground)]">
                <FolderOpen aria-hidden="true" className="size-5" />
              </span>
              <h2 className="mb-0 mt-4 text-base font-semibold">还没有部署</h2>
              <p className="mb-0 mt-2 max-w-md text-sm leading-6 text-[var(--muted-foreground)]">
                使用上方的“新建部署”，选择项目和它要运行的位置。
              </p>
            </section>
          )}
        </div>
      </main>
      <Dialog
        onOpenChange={(open) => !open && setRemoveCandidate(null)}
        open={Boolean(removeCandidate)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              移除 {removeCandidate?.projectName ?? "这个项目"} 的部署记录？
            </DialogTitle>
            <DialogDescription>
              这会清除该项目在 ABCDeploy
              中的部署线路、运行记录和项目专属设置。不会删除项目文件、服务器或已保存的公共连接；以后重新添加时会从头设置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setRemoveCandidate(null)}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              onClick={() => {
                if (removeCandidate) onRemove?.(removeCandidate);
                setRemoveCandidate(null);
              }}
              variant="destructive"
            >
              确认移除部署记录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeploymentListRow({
  item,
  onOpen,
  onRequestRemove,
}: {
  item: DeploymentListItem;
  onOpen: (item: DeploymentListItem) => void;
  onRequestRemove?: (item: DeploymentListItem) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li>
      <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 shadow-sm max-[560px]:px-4">
        <div className="flex items-start justify-between gap-5 max-[560px]:flex-col max-[560px]:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <h2 className="m-0 min-w-0 truncate text-base font-semibold leading-6">
                {item.projectName}
              </h2>
              <DeploymentResultBadge result={item.currentResult} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs leading-5 text-[var(--muted-foreground)]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="sr-only">运行位置：</span>
                <span className="truncate">{item.environmentName}</span>
              </span>
              {item.primaryAddress ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Link2 aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="break-all">{item.primaryAddress}</span>
                  {item.additionalAddressCount &&
                  item.additionalAddressCount > 0 ? (
                    <span className="shrink-0">
                      另有 {item.additionalAddressCount} 个地址
                    </span>
                  ) : null}
                </span>
              ) : null}
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <Clock3 aria-hidden="true" className="size-3.5" />
                最近验证：{item.lastVerifiedLabel}
              </span>
            </div>
          </div>

          <div className="relative flex shrink-0 items-center gap-2 max-[560px]:w-full">
            <Button
              aria-label={`打开 ${item.projectName}（${item.environmentName}）`}
              className="max-[560px]:flex-1"
              onClick={() => onOpen(item)}
              size="sm"
              variant="secondary"
            >
              打开
              <ArrowRight />
            </Button>
            {onRequestRemove ? (
              <>
                <Button
                  aria-label={`更多操作：${item.projectName}`}
                  onClick={() => setMenuOpen((open) => !open)}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
                {menuOpen ? (
                  <div className="absolute right-0 top-10 z-10 min-w-40 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-md)]">
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--destructive)] hover:bg-[var(--destructive-soft)]"
                      onClick={() => {
                        setMenuOpen(false);
                        onRequestRemove(item);
                      }}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      移除部署记录
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </article>
    </li>
  );
}

function DeploymentResultBadge({
  result,
}: {
  result: DeploymentListItem["currentResult"];
}) {
  const presentation = resultPresentation[result.kind];
  const Icon = presentation.icon;
  return (
    <span
      aria-label={`当前结果：${result.label}`}
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${presentation.className}`}
      data-result-tone={presentation.tone}
    >
      <Icon
        aria-hidden="true"
        className={`size-3.5 ${result.kind === "in_progress" ? "animate-spin-slow" : ""}`}
      />
      {result.label}
    </span>
  );
}

const resultPresentation: Record<
  DeploymentListResultKind,
  {
    className: string;
    icon: typeof Circle;
    tone: "danger" | "neutral" | "processing" | "success" | "warning";
  }
> = {
  failed: {
    className: "bg-[var(--destructive-soft)] text-[var(--destructive)]",
    icon: XCircle,
    tone: "danger",
  },
  in_progress: {
    className: "bg-[var(--accent-soft)] text-[var(--accent)]",
    icon: LoaderCircle,
    tone: "processing",
  },
  needs_action: {
    className: "bg-[var(--warning-soft)] text-[var(--warning)]",
    icon: AlertCircle,
    tone: "warning",
  },
  not_started: {
    className: "bg-[var(--muted)] text-[var(--muted-foreground)]",
    icon: Circle,
    tone: "neutral",
  },
  stale: {
    className: "bg-[var(--muted)] text-[var(--muted-foreground)]",
    icon: Clock3,
    tone: "neutral",
  },
  success: {
    className: "bg-[var(--success-soft)] text-[var(--success)]",
    icon: CheckCircle2,
    tone: "success",
  },
};
