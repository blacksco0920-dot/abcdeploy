import { useCallback, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  forgetProject,
  listDeploymentPaths,
  relinkProject,
  selectProjectDirectory,
} from "./api";
import { ProjectGallery } from "./components/ProjectGallery";
import {
  DeploymentDetailController,
  type DeploymentDetailProject,
} from "./features/deployment-detail/DeploymentDetailController";
import { DeploymentEditorController } from "./features/deployment-editor/DeploymentEditorController";
import type { CompletedDeployment } from "./features/deployment-editor/model";
import { useDeploymentDashboard } from "./features/deployment-list/use-deployment-dashboard";
import { issueFromUnknown } from "./lib/errors";
import type { RecentProject } from "./types";

type AppScreen = "home" | "editor" | "detail";

export type ProjectSelectionIssue = {
  message: string;
  title: string;
};

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("home");
  const [initialLocalPath, setInitialLocalPath] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] =
    useState<DeploymentDetailProject | null>(null);
  const [editorReturnScreen, setEditorReturnScreen] = useState<
    "home" | "detail"
  >("home");
  const [selectingProject, setSelectingProject] = useState(false);
  const [selectionIssue, setSelectionIssue] =
    useState<ProjectSelectionIssue | null>(null);

  const reportError = useCallback((error: unknown) => {
    const issue = issueFromUnknown(error, "操作没有完成");
    toast.error(issue.title, { description: issue.message });
  }, []);
  const dashboard = useDeploymentDashboard(reportError);

  function openProject(project: RecentProject) {
    setSelectionIssue(null);
    if (!project.pathExists) {
      void recoverMovedProject(project);
      return;
    }
    void openExistingProject({
      latestRunId: project.latestRunId,
      name: project.name,
      path: project.path,
    });
  }

  async function openExistingProject(project: DeploymentDetailProject) {
    setSelectedProject(project);
    try {
      const paths = await listDeploymentPaths(project.path);
      const hasOnlineResult = paths.some(
        (path) =>
          path.state === "online" || Boolean(path.lastSuccessfulRevision),
      );
      if (hasOnlineResult) {
        setInitialLocalPath(null);
        setScreen("detail");
        return;
      }
    } catch (error) {
      reportError(error);
    }
    setEditorReturnScreen("home");
    setInitialLocalPath(project.path);
    setScreen("editor");
  }

  async function recoverMovedProject(project: RecentProject) {
    setSelectingProject(true);
    try {
      const selected = await selectProjectDirectory(
        `重新找到“${project.name}”项目文件夹`,
      );
      if (!selected) return;
      const recovered = await relinkProject(project.path, selected);
      await dashboard.refresh(false);
      toast.success("项目位置已更新，原来的配置和部署记录都已保留");
      await openExistingProject({
        latestRunId: project.latestRunId,
        name: recovered.name,
        path: recovered.path,
      });
    } catch (error) {
      const issue = issueFromUnknown(error, "项目位置没有更新");
      setSelectionIssue({ title: issue.title, message: issue.message });
    } finally {
      setSelectingProject(false);
    }
  }

  async function forgetRecent(project: RecentProject) {
    try {
      await forgetProject(project.path);
      await dashboard.refresh(false);
      toast.success("部署记录已移除；项目文件和公共连接均未改动");
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <div className="h-screen min-h-0 bg-[var(--background)]">
      {screen === "home" ? (
        <ProjectGallery
          currentRuns={dashboard.currentRuns}
          loading={dashboard.loading}
          onForget={(project) => void forgetRecent(project)}
          onOpen={openProject}
          onSelect={() => {
            setSelectionIssue(null);
            setSelectedProject(null);
            setEditorReturnScreen("home");
            setInitialLocalPath(null);
            setScreen("editor");
          }}
          projects={dashboard.projects}
          selectingProject={selectingProject}
          selectionIssue={selectionIssue}
          taskRuns={dashboard.taskRuns}
        />
      ) : screen === "detail" && selectedProject ? (
        <DeploymentDetailController
          onBack={() => {
            setSelectedProject(null);
            setScreen("home");
            void dashboard.refresh(true);
          }}
          onError={reportError}
          onUpdate={() => {
            setEditorReturnScreen("detail");
            setInitialLocalPath(selectedProject.path);
            setScreen("editor");
          }}
          project={selectedProject}
        />
      ) : (
        <DeploymentEditorController
          initialLocalPath={initialLocalPath}
          mode={editorReturnScreen === "detail" ? "update" : "initial"}
          onBack={() => {
            setInitialLocalPath(null);
            setScreen(
              editorReturnScreen === "detail" && selectedProject
                ? "detail"
                : "home",
            );
            void dashboard.refresh(true);
          }}
          onDeploymentChanged={(deployment: CompletedDeployment) => {
            setSelectedProject({
              latestRunId: deployment.run.id,
              name: deployment.projectName,
              path: deployment.projectPath,
            });
            setInitialLocalPath(null);
            setEditorReturnScreen("home");
            setScreen("detail");
            void dashboard.refresh(true);
          }}
          onError={reportError}
        />
      )}
      <Toaster closeButton position="top-right" richColors />
    </div>
  );
}
