import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  ActionChecklistItemView,
  DeploymentEditorViewModel,
  DeploymentRunStepView,
} from "./model";

export function ChoiceButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
  summary,
}: {
  active: boolean;
  disabled: boolean;
  icon: typeof FolderOpen;
  label: string;
  onClick: () => void;
  summary: string;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-45 ${active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface)] text-[var(--accent)]">
        <Icon className="size-4" />
      </span>
      <span>
        <strong className="block text-sm">{label}</strong>
        <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
          {summary}
        </span>
      </span>
    </button>
  );
}

export function SelectedFact({
  detail,
  title,
  trailing,
}: {
  detail: string;
  title: string;
  trailing: string;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[var(--muted)] px-3 py-2.5">
      <span className="min-w-0">
        <strong className="block truncate text-sm">{title}</strong>
        <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
          {detail}
        </span>
      </span>
      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
        {trailing}
      </span>
    </div>
  );
}

export function ChecklistItem({
  item,
  onResolve,
}: {
  item: ActionChecklistItemView;
  onResolve: (itemId: string) => void;
}) {
  const statusText = {
    pending: "待处理",
    checking: "检查中",
    completed: "已完成",
    still_blocked: "仍有问题",
  }[item.status];
  return (
    <li className="flex list-none items-start justify-between gap-4 px-3 py-3">
      <div className="flex min-w-0 gap-2.5">
        {item.status === "completed" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
        ) : item.status === "checking" ? (
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin-slow text-[var(--accent)]" />
        ) : (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
        )}
        <div>
          <strong className="block text-sm">{item.title}</strong>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {item.reason}
          </p>
          <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
            {statusText}
          </span>
        </div>
      </div>
      {item.actionLabel && item.status !== "completed" ? (
        <Button
          onClick={() => onResolve(item.id)}
          size="sm"
          variant="secondary"
        >
          {item.actionLabel}
        </Button>
      ) : null}
    </li>
  );
}

export function RunStep({ step }: { step: DeploymentRunStepView }) {
  const Icon =
    step.status === "completed"
      ? Check
      : step.status === "running"
        ? LoaderCircle
        : step.status === "failed"
          ? AlertCircle
          : Circle;
  return (
    <li className="flex list-none items-start gap-3">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${step.status === "running" ? "animate-spin-slow text-[var(--accent)]" : step.status === "failed" ? "text-[var(--destructive)]" : step.status === "completed" ? "text-[var(--success)]" : "text-[var(--subtle-foreground)]"}`}
      />
      <div>
        <strong className="block text-sm">{step.label}</strong>
        <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
          {step.detail}
        </span>
      </div>
    </li>
  );
}

export function StatusBadge({
  state,
  text,
}: {
  state: DeploymentEditorViewModel["checklist"]["state"];
  text: string;
}) {
  const tone =
    state === "ready"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : state === "check_failed"
        ? "bg-[var(--destructive-soft)] text-[var(--destructive)]"
        : "bg-[var(--warning-soft)] text-[var(--warning)]";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${tone}`}
    >
      {state === "scanning" ? (
        <LoaderCircle className="size-3 animate-spin-slow" />
      ) : null}
      {text}
    </span>
  );
}
