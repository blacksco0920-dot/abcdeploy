import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeploymentRun, RecentProject } from "../types";
import { ProjectGallery } from "./ProjectGallery";

function project(overrides: Partial<RecentProject> = {}): RecentProject {
  return {
    activeRunCount: 0,
    currentStep: "workspace",
    id: "sample",
    lastOpenedAt: "2026-07-24T04:00:00.000Z",
    latestEnvironment: "deployment",
    latestMessage: "https://message-is-not-an-address.example",
    latestStatus: "success",
    manifestExists: true,
    name: "示例商城",
    path: "/projects/sample",
    pathExists: true,
    serviceCount: 3,
    ...overrides,
  };
}

function deploymentRun(overrides: Partial<DeploymentRun> = {}): DeploymentRun {
  return {
    actionKind: null,
    actionUrl: null,
    artifacts: [],
    branch: "main",
    buildSerial: null,
    candidateTag: null,
    commitSha: null,
    completedSteps: [],
    currentStage: "deploy",
    environment: "deployment",
    id: "run-sample",
    issueCode: null,
    message: "",
    projectName: "示例商城",
    projectPath: "/projects/sample",
    repository: "team/sample",
    sourceRunId: null,
    startedAt: "2026-07-24T04:00:00.000Z",
    status: "running",
    updatedAt: "2026-07-24T04:01:00.000Z",
    ...overrides,
  };
}

function renderGallery({
  currentRuns = [],
  loading = false,
  projects = [project()],
  selectingProject = false,
  selectionIssue = null,
  taskRuns = [],
}: {
  currentRuns?: DeploymentRun[];
  loading?: boolean;
  projects?: RecentProject[];
  selectingProject?: boolean;
  selectionIssue?: { message: string; title: string } | null;
  taskRuns?: DeploymentRun[];
} = {}) {
  const onForget = vi.fn();
  const onOpen = vi.fn();
  const onSelect = vi.fn();
  const view = render(
    <ProjectGallery
      currentRuns={currentRuns}
      loading={loading}
      onForget={onForget}
      onOpen={onOpen}
      onSelect={onSelect}
      projects={projects}
      selectingProject={selectingProject}
      selectionIssue={selectionIssue}
      taskRuns={taskRuns}
    />,
  );
  return { ...view, onForget, onOpen, onSelect };
}

describe("ProjectGallery deployment-list adapter", () => {
  it("把旧项目精确适配为我的部署，并保留新建和打开回调", () => {
    const current = project();
    const { onOpen, onSelect } = renderGallery({ projects: [current] });

    expect(
      screen.getByRole("heading", { level: 1, name: "我的部署" }),
    ).toBeInTheDocument();
    expect(screen.getByText("示例商城")).toBeInTheDocument();
    expect(screen.getByText("服务器")).toBeInTheDocument();
    expect(screen.getByText("上次验证通过 · 待复查")).toHaveAttribute(
      "data-result-tone",
      "neutral",
    );
    expect(screen.getByText("最近验证：未记录")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新建部署" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "打开 示例商城（服务器）" }),
    );
    expect(onOpen).toHaveBeenCalledWith(current);
  });

  it("把部署记录移除操作映射回对应项目", () => {
    const current = project();
    const { onForget } = renderGallery({ projects: [current] });

    fireEvent.click(screen.getByRole("button", { name: "更多操作：示例商城" }));
    fireEvent.click(screen.getByRole("button", { name: "移除部署记录" }));
    fireEvent.click(screen.getByRole("button", { name: "确认移除部署记录" }));
    expect(onForget).toHaveBeenCalledWith(current);
  });

  it("保守投影旧状态，活跃任务优先且旧 success 永不直接变绿", () => {
    const projects = [
      project({ id: "stale", name: "旧成功", path: "/projects/stale" }),
      project({
        id: "failed",
        latestStatus: "failed",
        name: "失败项目",
        path: "/projects/failed",
      }),
      project({
        id: "needs-action",
        latestStatus: "needs_action",
        name: "待处理项目",
        path: "/projects/needs-action",
      }),
      project({
        activeRunCount: 1,
        id: "active",
        name: "运行中项目",
        path: "/projects/active",
      }),
      project({
        id: "new",
        latestEnvironment: null,
        latestStatus: null,
        name: "未运行项目",
        path: "/projects/new",
      }),
    ];
    renderGallery({
      projects,
      taskRuns: [
        deploymentRun({
          id: "run-active",
          projectName: "运行中项目",
          projectPath: "/projects/active",
        }),
      ],
    });

    expect(screen.getByText("上次验证通过 · 待复查")).toHaveAttribute(
      "data-result-tone",
      "neutral",
    );
    expect(screen.getByText("上次运行没有完成")).toHaveAttribute(
      "data-result-tone",
      "danger",
    );
    expect(screen.getByText("需要处理")).toHaveAttribute(
      "data-result-tone",
      "warning",
    );
    expect(screen.getByText("正在上线")).toHaveAttribute(
      "data-result-tone",
      "processing",
    );
    expect(screen.getByText("尚未运行")).toHaveAttribute(
      "data-result-tone",
      "neutral",
    );
    expect(document.querySelector('[data-result-tone="success"]')).toBeNull();
  });

  it("运行位置和地址只使用已有结构化事实", () => {
    const currentRun = deploymentRun({
      id: "run-active",
      projectName: "有地址项目",
      projectPath: "/projects/active",
      status: "success",
      routeChecks: [
        {
          host: "app.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://app.example.com",
        },
        {
          host: "admin.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://admin.example.com",
        },
        {
          host: "failed.example.com",
          httpStatus: null,
          message: "failed",
          phase: "http",
          reachable: false,
          url: "https://failed.example.com",
        },
      ],
    });
    renderGallery({
      currentRuns: [currentRun],
      projects: [
        project({
          id: "active",
          latestEnvironment: null,
          name: "有地址项目",
          path: "/projects/active",
        }),
        project({
          id: "unknown",
          latestEnvironment: null,
          name: "未知位置项目",
          path: "/projects/unknown",
        }),
      ],
      taskRuns: [currentRun],
    });

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("服务器")).toBeInTheDocument();
    expect(
      within(rows[0]).getByText("https://app.example.com"),
    ).toBeInTheDocument();
    expect(within(rows[0]).getByText("另有 1 个地址")).toBeInTheDocument();
    expect(screen.queryByText("https://failed.example.com")).toBeNull();
    expect(
      screen.queryByText("https://message-is-not-an-address.example"),
    ).toBeNull();
    expect(within(rows[1]).getByText("运行位置未记录")).toBeInTheDocument();
  });

  it("使用部署线路明确指向的当前版本，并优先展示网页地址", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T02:04:00.000Z"));
    const currentRun = deploymentRun({
      status: "success",
      startedAt: "2026-07-25T02:00:00.000Z",
      updatedAt: "2026-07-25T02:03:00.000Z",
      routeChecks: [
        {
          host: "api.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://api.example.com",
        },
        {
          host: "h5.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://h5.example.com",
        },
      ],
    });
    renderGallery({
      currentRuns: [currentRun],
      projects: [project({ latestStatus: "success" })],
      taskRuns: [currentRun],
    });

    expect(screen.getByText("运行正常")).toHaveAttribute(
      "data-result-tone",
      "success",
    );
    expect(screen.getByText("https://h5.example.com")).toBeInTheDocument();
    expect(screen.getByText("最近验证：10:03")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("较旧的失败记录不会覆盖较新的成功结果", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T02:04:00.000Z"));
    const latestSuccess = deploymentRun({
      id: "latest-success",
      status: "success",
      updatedAt: "2026-07-25T02:03:00.000Z",
    });
    renderGallery({
      currentRuns: [latestSuccess],
      projects: [project({ latestStatus: "failed" })],
      taskRuns: [
        deploymentRun({
          id: "old-failure",
          status: "failed",
          updatedAt: "2026-07-25T02:00:00.000Z",
        }),
        latestSuccess,
      ],
    });

    expect(screen.getByText("运行正常")).toHaveAttribute(
      "data-result-tone",
      "success",
    );
    expect(screen.queryByText("服务仍在线 · 更新失败")).toBeNull();
    vi.useRealTimers();
  });

  it("更新失败时保留当前线上版本和地址，只把失败作为待处理提示", () => {
    const currentRun = deploymentRun({
      id: "online-version",
      status: "success",
      updatedAt: "2026-07-25T02:03:00.000Z",
      routeChecks: [
        {
          host: "online.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://online.example.com",
        },
      ],
    });
    const failedUpdate = deploymentRun({
      id: "failed-update",
      status: "failed",
      updatedAt: "2026-07-25T02:05:00.000Z",
    });

    renderGallery({
      currentRuns: [currentRun],
      taskRuns: [failedUpdate, currentRun],
    });

    expect(screen.getByText("服务仍在线 · 更新失败")).toHaveAttribute(
      "data-result-tone",
      "warning",
    );
    expect(screen.getByText("https://online.example.com")).toBeInTheDocument();
  });

  it("回退后首页以部署线路当前指针为准，不把更新的成功记录误当线上版本", () => {
    const restoredRun = deploymentRun({
      id: "restored-old-version",
      status: "success",
      updatedAt: "2026-07-25T02:00:00.000Z",
      routeChecks: [
        {
          host: "restored.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://restored.example.com",
        },
      ],
    });
    const newerSuccessfulAttempt = deploymentRun({
      id: "newer-successful-attempt",
      status: "success",
      updatedAt: "2026-07-25T02:05:00.000Z",
      routeChecks: [
        {
          host: "newer.example.com",
          httpStatus: 200,
          message: "ok",
          phase: "ready",
          reachable: true,
          url: "https://newer.example.com",
        },
      ],
    });

    renderGallery({
      currentRuns: [restoredRun],
      taskRuns: [newerSuccessfulAttempt, restoredRun],
    });

    expect(
      screen.getByText("https://restored.example.com"),
    ).toBeInTheDocument();
    expect(screen.queryByText("https://newer.example.com")).toBeNull();
  });

  it("移除旧首页的搜索、筛选、隐藏和旧业务信息", () => {
    renderGallery();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(screen.queryByText(/全部|已经上线|从列表隐藏/)).toBeNull();
    expect(screen.queryByText(/个服务|工作流|\/projects\//)).toBeNull();
  });

  it("初始加载和选择失败都给出简洁、可恢复的页面提示", () => {
    const loadingView = renderGallery({ loading: true, projects: [] });
    expect(
      screen.getByRole("heading", { name: "我的部署" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在读取已保存的部署",
    );
    expect(screen.queryByText("还没有部署")).toBeNull();
    loadingView.unmount();

    const issue = {
      message: "没有识别到可以运行的服务。",
      title: "无法读取这个项目",
    };
    renderGallery({ projects: [project()], selectionIssue: issue });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(issue.title);
    expect(alert).toHaveTextContent(issue.message);
    expect(alert).toHaveTextContent("点击“新建部署”重新选择");
  });
});
