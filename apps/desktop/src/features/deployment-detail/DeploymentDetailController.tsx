import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { issueFromUnknown } from "../../lib/errors";
import type { DeploymentPath, DeploymentRun } from "../../types";
import { DeploymentSetupDialogs } from "../deployment-editor/DeploymentSetupDialogs";
import { useDeploymentSetupDialog } from "../deployment-editor/use-deployment-setup-dialog";
import { DeploymentDetailPage } from "./DeploymentDetailPage";
import {
  defaultDeploymentDetailServices,
  type DeploymentDetailServices,
} from "./deployment-detail-services";
import { projectDeploymentDetail } from "./model";

export interface DeploymentDetailProject {
  latestRunId?: string | null;
  name: string;
  path: string;
}

interface DeploymentDetailControllerProps {
  onBack: () => void;
  onError: (error: unknown) => void;
  onUpdate: () => void;
  project: DeploymentDetailProject;
  services?: DeploymentDetailServices;
}

export function DeploymentDetailController({
  onBack,
  onError,
  onUpdate,
  project,
  services = defaultDeploymentDetailServices,
}: DeploymentDetailControllerProps) {
  const [path, setPath] = useState<DeploymentPath | null>(null);
  const [runs, setRuns] = useState<DeploymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringRunId, setRestoringRunId] = useState<string | null>(null);
  const reportDialogError = useCallback(
    (message: string) => onError(new Error(message)),
    [onError],
  );
  const setupDialog = useDeploymentSetupDialog({
    onError: reportDialogError,
    services: services.setupServices,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const paths = await services.listPaths(project.path);
      const selected = selectCurrentPath(paths, project.latestRunId);
      setPath(selected);
      setRuns(
        selected ? await services.listRuns(selected.id, project.path) : [],
      );
    } catch (error) {
      onError(error);
    } finally {
      setLoading(false);
    }
  }, [onError, project.latestRunId, project.path, services]);

  useEffect(() => {
    void load();
  }, [load]);

  const projection = useMemo(
    () => (path ? projectDeploymentDetail(path, runs) : null),
    [path, runs],
  );

  async function restoreVersion(runId: string) {
    if (!path || restoringRunId) return;
    if (!window.confirm("确定恢复到这个版本吗？当前在线版本会保留在记录中。")) {
      return;
    }
    setRestoringRunId(runId);
    try {
      const run = await services.restoreVersion(path.id, runId, project.path);
      if (run.status === "success") {
        toast.success("旧版本已重新上线");
      } else {
        toast.info("已开始恢复版本", {
          description: "可以关闭页面，稍后回来查看结果。",
        });
      }
      await load();
    } catch (error) {
      const issue = issueFromUnknown(error, "版本恢复没有完成");
      toast.error(issue.title, {
        description: `${issue.message} 当前在线版本没有改变。`,
      });
    } finally {
      setRestoringRunId(null);
    }
  }

  return (
    <>
      <DeploymentDetailPage
        loading={loading}
        onBack={onBack}
        onOpenAddress={(address) => {
          void services.openAddress(address).catch(onError);
        }}
        onRestore={(runId) => void restoreVersion(runId)}
        onSettings={() => {
          void setupDialog.openSettings(project.path, path?.serverId ?? null);
        }}
        onUpdate={onUpdate}
        path={path}
        projectName={project.name}
        projection={projection}
        restoringRunId={restoringRunId}
      />
      <DeploymentSetupDialogs
        addressRequired={false}
        inspection={setupDialog.inspection}
        mode={setupDialog.mode}
        onClose={setupDialog.close}
        onResolved={async () => {
          setupDialog.close();
          await load();
          toast.success("部署设置已保存", {
            description: "新设置会在下次上线时使用，当前在线版本没有改变。",
          });
        }}
        open={setupDialog.open}
        services={services.setupServices}
      />
    </>
  );
}

function selectCurrentPath(
  paths: readonly DeploymentPath[],
  latestRunId?: string | null,
) {
  return (
    paths.find((path) => path.lastRunId === latestRunId) ??
    paths.find((path) => path.currentRunId === latestRunId) ??
    paths.find(
      (path) => path.state === "online" || Boolean(path.lastSuccessfulRevision),
    ) ??
    [...paths].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0] ??
    null
  );
}
