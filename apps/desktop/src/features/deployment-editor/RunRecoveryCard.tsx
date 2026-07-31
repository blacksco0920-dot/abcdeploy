import { AlertCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { DeploymentEditorAction, DeploymentRunView } from "./model";

export function RunRecoveryCard({
  action,
  onPrimaryAction,
  recovery,
}: {
  action: DeploymentEditorAction;
  onPrimaryAction: (action: DeploymentEditorAction) => void;
  recovery: NonNullable<DeploymentRunView["recovery"]>;
}) {
  return (
    <div
      className="mt-4 rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive-soft)] p-4"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-semibold">{recovery.title}</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--foreground)]">
            {recovery.message}
          </p>
          <div className="mt-3 rounded-md bg-[var(--surface)]/70 px-3 py-2">
            <strong className="text-xs font-medium">已经保留</strong>
            <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              {recovery.preserved}
            </p>
          </div>
          <strong className="mt-3 block text-xs font-medium">下一步</strong>
          <ol className="mb-0 mt-1 space-y-1 pl-5 text-xs leading-5 text-[var(--muted-foreground)]">
            {recovery.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Button
            className="mt-3"
            onClick={() => onPrimaryAction(action)}
            size="sm"
          >
            {recovery.actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
