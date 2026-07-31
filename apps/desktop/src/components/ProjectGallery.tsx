import { AlertCircle, LoaderCircle } from "lucide-react";
import type { DeploymentRun, RecentProject } from "../types";
import { DeploymentListPage } from "../features/deployment-list/DeploymentListPage";
import type {
  DeploymentListItem,
  DeploymentListResult,
} from "../features/deployment-list/model";
import { orderedPublicAddresses } from "../features/deployment-editor/public-address";

interface ProjectGalleryProps {
  currentRuns: DeploymentRun[];
  loading: boolean;
  onForget: (project: RecentProject) => void;
  onOpen: (project: RecentProject) => void;
  onSelect: () => void;
  projects: RecentProject[];
  selectingProject?: boolean;
  selectionIssue?: { message: string; title: string } | null;
  taskRuns: DeploymentRun[];
}

export function ProjectGallery(props: ProjectGalleryProps) {
  if (props.loading && props.projects.length === 0) {
    return <DeploymentListLoading />;
  }

  const projections = props.projects.map((project) =>
    projectProjection(project, props.taskRuns, props.currentRuns),
  );
  const projectByItem = new Map(
    projections.map(({ item, project }) => [item, project]),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      <ProjectGalleryNotice
        loading={props.loading}
        selectingProject={props.selectingProject ?? false}
        selectionIssue={props.selectionIssue}
      />
      <div className="min-h-0 flex-1">
        <DeploymentListPage
          items={projections.map(({ item }) => item)}
          onCreate={() => {
            if (!props.selectingProject) props.onSelect();
          }}
          onOpen={(item) => {
            const project = projectByItem.get(item);
            if (project) props.onOpen(project);
          }}
          onRemove={(item) => {
            const project = projectByItem.get(item);
            if (project) props.onForget(project);
          }}
        />
      </div>
    </div>
  );
}

function projectProjection(
  project: RecentProject,
  taskRuns: DeploymentRun[],
  currentRuns: DeploymentRun[],
) {
  const tasks = taskRuns
    .filter((run) => run.projectPath === project.path)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeTask = tasks.find((run) =>
    ["queued", "running"].includes(run.status),
  );
  const needsActionTask = tasks.find((run) => run.status === "needs_action");
  const failedTask = tasks.find((run) => run.status === "failed");
  const currentTask = currentRuns
    .filter((run) => run.projectPath === project.path)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const newerNeedsActionTask = newerThanCurrent(needsActionTask, currentTask);
  const newerFailedTask = newerThanCurrent(failedTask, currentTask);
  const displayedTask =
    activeTask ?? newerNeedsActionTask ?? newerFailedTask ?? currentTask;
  const addresses = orderedPublicAddresses(
    currentTask?.routeChecks ?? [],
  ).addresses;
  const item: DeploymentListItem = {
    currentResult: currentResult(project, {
      activeTask,
      failedTask: newerFailedTask,
      currentTask,
      hasTaskHistory: tasks.length > 0 || Boolean(currentTask),
      needsActionTask: newerNeedsActionTask,
    }),
    environmentName: environmentName(project, displayedTask),
    id: project.id,
    // RecentProject has no success-evidence timestamp. lastOpenedAt and
    // latestUpdatedAt are deliberately not presented as verification facts.
    lastVerifiedLabel: currentTask
      ? verifiedTimeLabel(currentTask.updatedAt)
      : "未记录",
    projectName: project.name,
  };
  if (addresses[0]) item.primaryAddress = addresses[0];
  if (addresses.length > 1) item.additionalAddressCount = addresses.length - 1;
  return { item, project };
}

function newerThanCurrent(
  candidate: DeploymentRun | undefined,
  current: DeploymentRun | undefined,
) {
  if (!candidate || !current) return candidate;
  return candidate.updatedAt > current.updatedAt ? candidate : undefined;
}

function currentResult(
  project: RecentProject,
  tasks: {
    activeTask?: DeploymentRun;
    currentTask?: DeploymentRun;
    failedTask?: DeploymentRun;
    hasTaskHistory: boolean;
    needsActionTask?: DeploymentRun;
  },
): DeploymentListResult {
  if (!project.pathExists) {
    return { kind: "needs_action", label: "需要重新选择项目文件夹" };
  }
  if (
    tasks.activeTask ||
    project.activeRunCount > 0 ||
    (!tasks.hasTaskHistory &&
      (project.latestStatus === "queued" || project.latestStatus === "running"))
  ) {
    return { kind: "in_progress", label: "正在上线" };
  }
  if (
    tasks.needsActionTask ||
    (!tasks.hasTaskHistory && project.latestStatus === "needs_action")
  ) {
    return { kind: "needs_action", label: "需要处理" };
  }
  if (
    tasks.failedTask ||
    (!tasks.hasTaskHistory && project.latestStatus === "failed")
  ) {
    if (tasks.currentTask) {
      return { kind: "needs_action", label: "服务仍在线 · 更新失败" };
    }
    return { kind: "failed", label: "上次运行没有完成" };
  }
  if (!tasks.hasTaskHistory && project.latestStatus === "cancelled") {
    return { kind: "failed", label: "上次运行已取消" };
  }
  if (tasks.currentTask) {
    const fresh =
      Date.now() - Date.parse(tasks.currentTask.updatedAt) <= 5 * 60 * 1_000;
    return fresh
      ? { kind: "success", label: "运行正常" }
      : { kind: "stale", label: "上次验证通过 · 待复查" };
  }
  if (!tasks.hasTaskHistory && project.latestStatus === "success") {
    return { kind: "stale", label: "上次验证通过 · 待复查" };
  }
  return { kind: "not_started", label: "尚未运行" };
}

function environmentName(
  project: RecentProject,
  task: DeploymentRun | undefined,
) {
  if (task?.environment || project.latestEnvironment) return "服务器";
  if (task || project.latestStatus) return "运行位置未记录";
  return "尚未选择运行位置";
}

function verifiedTimeLabel(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ProjectGalleryNotice({
  loading,
  selectingProject,
  selectionIssue,
}: {
  loading: boolean;
  selectingProject: boolean;
  selectionIssue?: { message: string; title: string } | null;
}) {
  if (selectionIssue) {
    return (
      <div
        className="flex shrink-0 items-start gap-3 border-b border-[var(--warning)]/30 bg-[var(--warning-soft)] px-6 py-3 text-sm"
        role="alert"
      >
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
        />
        <div>
          <strong>{selectionIssue.title}</strong>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {selectionIssue.message} 点击“新建部署”重新选择。
          </p>
        </div>
      </div>
    );
  }
  if (!selectingProject && !loading) return null;
  return (
    <div
      className="inline-flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-2 text-xs text-[var(--muted-foreground)]"
      role="status"
    >
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 animate-spin-slow text-[var(--accent)]"
      />
      {selectingProject ? "正在打开项目选择器" : "正在刷新部署列表"}
    </div>
  );
}

function DeploymentListLoading() {
  return (
    <main className="h-full min-h-0 overflow-auto bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-[1040px] px-6 py-8 max-[560px]:px-4 max-[560px]:py-6">
        <h1 className="m-0 text-xl font-semibold leading-7">我的部署</h1>
        <div
          className="mt-7 flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 text-center"
          role="status"
        >
          <LoaderCircle
            aria-hidden="true"
            className="size-5 animate-spin-slow text-[var(--accent)]"
          />
          <strong className="mt-4 text-sm">正在读取已保存的部署</strong>
          <span className="mt-2 text-xs text-[var(--muted-foreground)]">
            完成后会显示项目、运行位置和最近验证结果。
          </span>
        </div>
      </div>
    </main>
  );
}
