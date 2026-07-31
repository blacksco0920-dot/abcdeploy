import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Monitor,
  Plus,
  Server,
  Settings2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { DeploymentEvidenceSection } from "./DeploymentEvidenceFacts";
import { DeploymentAdoptionDecision } from "./DeploymentAdoptionDecision";
import { NecessaryConfigurationDialog } from "./NecessaryConfigurationDialog";
import { RunRecoveryCard } from "./RunRecoveryCard";
import {
  ChecklistItem,
  ChoiceButton,
  RunStep,
  SelectedFact,
  StatusBadge,
} from "./DeploymentEditorPageParts";
import {
  projectDeploymentEditorAction,
  type DeploymentEditorAction,
  type DeploymentEditorMode,
  type DeploymentEditorViewModel,
} from "./model";

interface DeploymentEditorPageProps {
  mode?: DeploymentEditorMode;
  model: DeploymentEditorViewModel;
  onBack: () => void;
  onChooseLocalSource: () => void;
  onChooseRepositorySource: () => void;
  onRepositoryUrlChange: (value: string) => void;
  onChooseLocalEnvironment: () => void;
  onChooseServerEnvironment: () => void;
  onSelectServer: (serverId: string) => void;
  onConnectServer: () => void;
  onOpenDeploymentSettings: () => void;
  onContinueExistingDeployment: () => void;
  onResetExistingDeployment: () => void;
  onSystemFailureAction?: (
    action: NonNullable<DeploymentEditorViewModel["systemFailure"]>["action"],
  ) => void;
  onResolveAction: (itemId: string) => void;
  onPrimaryAction: (action: DeploymentEditorAction) => void;
  configurationDialog?: {
    content: string;
    open: boolean;
    requiredVariables: readonly string[];
    onCancel: () => void;
    onSave: (content: string) => void;
  };
}

export function DeploymentEditorPage({
  mode = "initial",
  model,
  onBack,
  onChooseLocalSource,
  onChooseRepositorySource,
  onRepositoryUrlChange,
  onChooseLocalEnvironment,
  onChooseServerEnvironment,
  onSelectServer,
  onConnectServer,
  onOpenDeploymentSettings,
  onContinueExistingDeployment,
  onResetExistingDeployment,
  onSystemFailureAction,
  onResolveAction,
  onPrimaryAction,
  configurationDialog,
}: DeploymentEditorPageProps) {
  const projectedAction = projectDeploymentEditorAction(model);
  const action: DeploymentEditorAction =
    mode === "update" && projectedAction.kind === "start_server"
      ? {
          ...projectedAction,
          label: "更新上线",
          explanation: "使用当前项目内容和已保存的上线设置更新服务器。",
        }
      : projectedAction;
  const sourceSelected =
    model.sourceResolutionState === "resolved" &&
    model.source.kind !== "none" &&
    Boolean(model.source.identity) &&
    (model.source.kind === "local" ||
      (model.source.kind === "repository" &&
        model.source.repositoryUrlValid &&
        Boolean(model.source.repositoryUrl)));
  const environmentSelected =
    model.environment.kind === "local" ||
    (model.environment.kind === "server" &&
      Boolean(model.environment.serverId));
  const locked = model.run.state !== "idle" || Boolean(model.evidence);
  const adoptionPending = Boolean(model.adoptionDecision);
  const recoveryOwnsPrimaryAction =
    model.run.state === "failed" && Boolean(model.run.recovery);
  const showReadiness =
    sourceSelected &&
    environmentSelected &&
    model.run.state === "idle" &&
    !model.evidence;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <header className="flex h-[52px] shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-4">
        <Button
          aria-label="返回我的部署"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div className="ml-2 min-w-0">
          <strong className="block truncate text-sm font-semibold">
            {mode === "update" && !locked
              ? "更新部署"
              : locked
                ? "本次运行"
                : "新建部署"}
          </strong>
          <span className="block truncate text-xs text-[var(--muted-foreground)]">
            {mode === "update"
              ? "当前项目、服务器和上线设置将自动复用"
              : "选择项目和运行位置，剩下的由系统检查"}
          </span>
        </div>
        {model.environment.kind === "server" &&
        (mode === "update" || model.evidence) ? (
          <Button
            className="ml-auto gap-1.5"
            onClick={onOpenDeploymentSettings}
            size="sm"
            variant="secondary"
          >
            <Settings2 className="size-4" />
            上线设置
          </Button>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-5 py-6">
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
          {mode === "update" ? (
            <UpdateContextSection model={model} />
          ) : (
            <>
              <SourceSection
                disabled={locked}
                model={model}
                onChooseLocal={onChooseLocalSource}
                onChooseRepository={onChooseRepositorySource}
                onRepositoryUrlChange={onRepositoryUrlChange}
              />
              {model.adoptionDecision ? (
                <DeploymentAdoptionDecision
                  decision={model.adoptionDecision}
                  onContinue={onContinueExistingDeployment}
                  onReset={onResetExistingDeployment}
                />
              ) : (
                <EnvironmentSection
                  disabled={!sourceSelected || locked}
                  model={model}
                  onChooseLocal={onChooseLocalEnvironment}
                  onChooseServer={onChooseServerEnvironment}
                  onConnectServer={onConnectServer}
                  onSelectServer={onSelectServer}
                />
              )}
            </>
          )}
          {showReadiness ? (
            <ReadinessSection
              model={model}
              onResolveAction={onResolveAction}
              onSystemFailureAction={onSystemFailureAction}
            />
          ) : null}
          {!adoptionPending && model.run.state !== "idle" ? (
            <RunSection
              action={action}
              model={model}
              onPrimaryAction={onPrimaryAction}
            />
          ) : null}
          {model.evidence ? <DeploymentEvidenceSection model={model} /> : null}

          {!adoptionPending && !recoveryOwnsPrimaryAction ? (
            <section className="sticky bottom-0 z-10 rounded-xl border border-[var(--border)] bg-[var(--surface)]/95 p-4 shadow-[var(--shadow-sm)] backdrop-blur">
              <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
                <p className="m-0 text-xs leading-5 text-[var(--muted-foreground)]">
                  {action.explanation}
                </p>
                {action.kind === "running_status" ? (
                  <div
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--accent-soft)] px-4 text-sm font-medium text-[var(--accent)] sm:min-w-40"
                    role="status"
                  >
                    <LoaderCircle className="animate-spin-slow" />
                    {action.label}
                  </div>
                ) : (
                  <Button
                    className="sm:min-w-40"
                    disabled={!action.enabled}
                    onClick={() => onPrimaryAction(action)}
                  >
                    {action.kind === "open_result" ? <ExternalLink /> : null}
                    {action.label}
                  </Button>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </main>
      {configurationDialog ? (
        <NecessaryConfigurationDialog {...configurationDialog} />
      ) : null}
    </div>
  );
}

function UpdateContextSection({ model }: { model: DeploymentEditorViewModel }) {
  const projectName =
    model.source.kind === "none" ? "当前项目" : model.source.name || "当前项目";
  const projectDetail =
    model.source.kind === "local"
      ? model.source.path
      : model.source.kind === "repository"
        ? model.source.repositoryUrl
        : "正在读取项目";
  const serverEnvironment =
    model.environment.kind === "server" ? model.environment : null;
  const server =
    serverEnvironment?.servers.find(
      (item) => item.id === serverEnvironment.serverId,
    ) ?? null;

  return (
    <section
      aria-labelledby="update-context-heading"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h1 className="m-0 text-base font-semibold" id="update-context-heading">
        本次更新
      </h1>
      <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
        重新读取当前项目，并更新到原来的服务器。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="size-5 text-[var(--accent)]" />
            <div className="min-w-0">
              <strong className="block truncate text-sm">{projectName}</strong>
              <span className="block truncate text-xs text-[var(--muted-foreground)]">
                {projectDetail}
              </span>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-3">
            <Server className="size-5 text-[var(--accent)]" />
            <div className="min-w-0">
              <strong className="block truncate text-sm">
                {server?.name ?? "原服务器"}
              </strong>
              <span className="block truncate text-xs text-[var(--muted-foreground)]">
                {server?.detail ?? "正在读取已保存的服务器"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceSection({
  disabled,
  model,
  onChooseLocal,
  onChooseRepository,
  onRepositoryUrlChange,
}: {
  disabled: boolean;
  model: DeploymentEditorViewModel;
  onChooseLocal: () => void;
  onChooseRepository: () => void;
  onRepositoryUrlChange: (value: string) => void;
}) {
  const source = model.source;
  return (
    <section
      aria-labelledby="source-heading"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div>
        <h1 className="m-0 text-base font-semibold" id="source-heading">
          选择项目
        </h1>
        <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
          选择电脑里的文件夹，或者填写代码仓库地址。
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceButton
          active={source.kind === "local"}
          disabled={disabled}
          icon={FolderOpen}
          label="本地文件夹"
          onClick={onChooseLocal}
          summary="使用电脑里的当前项目内容"
        />
        <ChoiceButton
          active={source.kind === "repository"}
          disabled={disabled}
          icon={GitBranch}
          label="代码仓库地址"
          onClick={onChooseRepository}
          summary="从可访问的 Git 仓库读取"
        />
      </div>
      {source.kind === "local" ? (
        <>
          <SelectedFact
            detail={`${source.path}${source.identity ? ` · ${shortIdentity(source.identity)}` : ""}`}
            title={source.name}
            trailing={
              model.sourceResolutionState === "failed"
                ? "没有读取完成"
                : source.serviceCount === null
                  ? "正在读取项目"
                  : `识别 ${source.serviceCount} 个项目服务`
            }
          />
          <SourceResolutionMessage model={model} />
        </>
      ) : null}
      {source.kind === "repository" ? (
        <div className="mt-4">
          <label
            className="mb-1.5 block text-sm font-medium"
            htmlFor="deployment-repository-url"
          >
            代码仓库地址
          </label>
          <Input
            aria-describedby="deployment-repository-hint deployment-repository-error"
            disabled={disabled}
            id="deployment-repository-url"
            onChange={(event) => onRepositoryUrlChange(event.target.value)}
            placeholder="https://code.example.com/team/project.git"
            value={source.repositoryUrl}
          />
          <p
            className="mb-0 mt-1.5 text-xs text-[var(--muted-foreground)]"
            id="deployment-repository-hint"
          >
            私有仓库需要授权时，系统会把它列入待办。
          </p>
          {source.repositoryUrl && !source.repositoryUrlValid ? (
            <p
              className="mb-0 mt-1 text-xs text-[var(--destructive)]"
              id="deployment-repository-error"
              role="alert"
            >
              请输入完整的 Git 仓库地址
            </p>
          ) : null}
          <SourceResolutionMessage model={model} />
        </div>
      ) : null}
    </section>
  );
}

function EnvironmentSection({
  disabled,
  model,
  onChooseLocal,
  onChooseServer,
  onConnectServer,
  onSelectServer,
}: {
  disabled: boolean;
  model: DeploymentEditorViewModel;
  onChooseLocal: () => void;
  onChooseServer: () => void;
  onConnectServer: () => void;
  onSelectServer: (serverId: string) => void;
}) {
  const environment = model.environment;
  return (
    <section
      aria-disabled={disabled}
      aria-labelledby="environment-heading"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h2 className="m-0 text-base font-semibold" id="environment-heading">
        选择运行位置
      </h2>
      <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
        {disabled
          ? "先选择项目，这里才会启用。"
          : "项目可以在这台电脑运行，也可以放到一台服务器上。"}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChoiceButton
          active={environment.kind === "local"}
          disabled={disabled}
          icon={Monitor}
          label="这台电脑"
          onClick={onChooseLocal}
          summary="只在本机运行和访问"
        />
        <ChoiceButton
          active={environment.kind === "server"}
          disabled={disabled}
          icon={Server}
          label="服务器"
          onClick={onChooseServer}
          summary="持续运行并提供访问地址"
        />
      </div>
      {!disabled && environment.kind === "server" ? (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold">选择服务器</h3>
              <p className="mb-0 mt-1 text-xs text-[var(--muted-foreground)]">
                已验证的服务器可以直接复用
              </p>
            </div>
            <Button onClick={onConnectServer} size="sm" variant="secondary">
              <Plus />
              连接新服务器
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {environment.servers.map((server) => (
              <button
                aria-pressed={environment.serverId === server.id}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${environment.serverId === server.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
                key={server.id}
                onClick={() => onSelectServer(server.id)}
                type="button"
              >
                <span className="min-w-0">
                  <strong className="block truncate text-sm">
                    {server.name}
                  </strong>
                  <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                    {server.detail}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {server.verified ? "已验证" : "需要验证"}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReadinessSection({
  model,
  onResolveAction,
  onSystemFailureAction,
}: {
  model: DeploymentEditorViewModel;
  onResolveAction: (itemId: string) => void;
  onSystemFailureAction: DeploymentEditorPageProps["onSystemFailureAction"];
}) {
  const stateLabel = {
    idle: "等待检查",
    scanning: "正在检查",
    blocked: "需要处理",
    ready: "可以开始",
    check_failed: "系统准备失败",
  }[model.checklist.state];
  return (
    <section
      aria-labelledby="checklist-heading"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold" id="checklist-heading">
            自动检查与待办
          </h2>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            系统会自动完成能安全处理的准备，只把确实需要你的事情列在这里。
          </p>
        </div>
        <StatusBadge state={model.checklist.state} text={stateLabel} />
      </div>
      {model.systemChecks.length ? (
        <div className="mt-4 rounded-lg bg-[var(--muted)] px-3 py-2.5">
          <strong className="text-xs font-medium">系统已确认</strong>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {model.systemChecks.join("、")}
          </p>
        </div>
      ) : null}
      {model.systemFailure ? (
        <div
          className="mt-4 flex gap-3 rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive-soft)] px-3 py-3"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--destructive)]" />
          <div className="min-w-0 flex-1">
            <strong className="text-sm">{model.systemFailure.title}</strong>
            <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              {model.systemFailure.message}
            </p>
            <Button
              className="mt-3"
              onClick={() =>
                onSystemFailureAction?.(model.systemFailure!.action)
              }
              size="sm"
              variant="secondary"
            >
              {model.systemFailure.actionLabel}
            </Button>
          </div>
        </div>
      ) : null}
      {model.checklistItems.length ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>需要你处理</span>
            <span>
              {model.checklist.completedActionCount}/
              {model.checklist.totalActionCount} 已完成
            </span>
          </div>
          <ul
            aria-label="完整待办"
            className="m-0 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] p-0"
          >
            {model.checklistItems.map((item) => (
              <ChecklistItem
                item={item}
                key={item.id}
                onResolve={onResolveAction}
              />
            ))}
          </ul>
        </div>
      ) : model.checklist.state === "ready" ? (
        <p className="mb-0 mt-4 inline-flex items-center gap-2 text-sm text-[var(--success)]">
          <CheckCircle2 className="size-4" />
          没有需要你处理的事项
        </p>
      ) : null}
    </section>
  );
}

function SourceResolutionMessage({
  model,
}: {
  model: DeploymentEditorViewModel;
}) {
  if (
    model.sourceResolutionState !== "failed" ||
    !model.sourceResolutionMessage
  ) {
    return null;
  }
  return (
    <p
      className="mb-0 mt-3 rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive-soft)] px-3 py-2 text-xs leading-5 text-[var(--destructive)]"
      role="alert"
    >
      {model.sourceResolutionMessage}
    </p>
  );
}

function shortIdentity(identity: string) {
  return identity.length > 16 ? identity.slice(0, 12) : identity;
}

function RunSection({
  action,
  model,
  onPrimaryAction,
}: {
  action: DeploymentEditorAction;
  model: DeploymentEditorViewModel;
  onPrimaryAction: (action: DeploymentEditorAction) => void;
}) {
  const progress = model.run.progress;
  const currentStep = progress
    ? model.run.state === "completed"
      ? progress.total
      : Math.min(progress.total, progress.completed + 1)
    : null;
  const progressPercent = progress
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : 0;
  return (
    <section
      aria-labelledby="run-heading"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-base font-semibold" id="run-heading">
            运行过程
          </h2>
          <p className="mb-0 mt-1 text-xs text-[var(--muted-foreground)]">
            {model.run.message}
          </p>
        </div>
        {progress && currentStep ? (
          <strong className="shrink-0 text-xs font-medium text-[var(--accent)]">
            第 {currentStep}/{progress.total} 步 · {progress.currentLabel}
          </strong>
        ) : null}
      </div>
      {progress ? (
        <div className="mt-4">
          <div
            aria-label="上线完成比例"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progressPercent}
            className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
            <span>{progress.elapsedLabel}</span>
            <span>{progress.updatedLabel}</span>
            <span>
              {progress.completed}/{progress.total} 项已完成
            </span>
          </div>
          {progress.waitingHint ? (
            <p className="mb-0 mt-3 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs leading-5 text-[var(--warning)]">
              {progress.waitingHint}
            </p>
          ) : null}
        </div>
      ) : null}
      <ol className="m-0 mt-4 space-y-3 p-0">
        {model.run.steps.map((step) => (
          <RunStep key={step.id} step={step} />
        ))}
      </ol>
      {model.run.recovery ? (
        <RunRecoveryCard
          action={action}
          onPrimaryAction={onPrimaryAction}
          recovery={model.run.recovery}
        />
      ) : null}
      {model.run.details?.length ? (
        <details className="mt-4 border-t border-[var(--border)] pt-3 text-xs">
          <summary className="cursor-pointer select-none font-medium text-[var(--muted-foreground)]">
            查看部署详情
          </summary>
          <dl className="mb-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-[var(--muted)] p-3">
            {model.run.details.map((detail) => (
              <div className="contents" key={detail.label}>
                <dt className="text-[var(--muted-foreground)]">
                  {detail.label}
                </dt>
                <dd className="m-0 break-all font-mono text-[var(--foreground)]">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
