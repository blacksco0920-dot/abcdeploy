export type DeploymentSetupMode = "initial" | "settings";

interface DeploymentSetupProgressProps {
  mode: DeploymentSetupMode;
  step: 1 | 2;
}

const STEPS = [
  { index: 1, label: "部署资源" },
  { index: 2, label: "访问地址" },
] as const;

export function DeploymentSetupProgress({
  mode,
  step,
}: DeploymentSetupProgressProps) {
  const initial = mode === "initial";

  return (
    <section
      aria-label={initial ? "首次上线设置进度" : "部署设置进度"}
      className="rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs font-medium text-[var(--foreground)]">
          {initial ? "首次上线设置" : "后续维护"}
        </p>
        <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
          {initial ? "只显示当前需要你确认的内容" : "同一套部署设置"}
        </p>
      </div>
      <ol className="m-0 mt-2 grid list-none grid-cols-2 gap-2 p-0">
        {STEPS.map((item) => {
          const active = item.index === step;
          const completed = item.index < step;
          return (
            <li
              aria-current={active ? "step" : undefined}
              aria-label={`${item.index} ${item.label}`}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                active
                  ? "border-[var(--primary)] bg-[var(--background)] text-[var(--foreground)]"
                  : "border-transparent text-[var(--muted-foreground)]"
              }`}
              key={item.index}
            >
              <span className="mr-1.5" aria-hidden="true">
                {completed ? "✓" : item.index}
              </span>
              <span>{item.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
