import { FolderGit2, History, LoaderCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { DeploymentAdoptionDecisionView } from "./model";

export function DeploymentAdoptionDecision({
  decision,
  onContinue,
  onReset,
}: {
  decision: DeploymentAdoptionDecisionView;
  onContinue: () => void;
  onReset: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = decision.action !== null;

  return (
    <section
      aria-labelledby="deployment-adoption-heading"
      className="rounded-xl border border-[var(--warning)]/35 bg-[var(--warning-soft)] p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface)] text-[var(--warning)]">
          <FolderGit2 className="size-4" />
        </span>
        <div className="min-w-0">
          <h2
            className="m-0 text-base font-semibold"
            id="deployment-adoption-heading"
          >
            检测到已有上线设置
          </h2>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            这个项目以前设置过构建或部署。先选择如何处理，系统才会继续；做出选择前不会修改代码、服务器或线上服务。
          </p>
        </div>
      </div>

      <dl className="mb-0 mt-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--muted-foreground)]">代码仓库</dt>
          <dd className="m-0 mt-1 font-medium">
            {decision.repository || "已从项目中识别"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted-foreground)]">自动构建</dt>
          <dd className="m-0 mt-1 font-medium">
            {decision.pipelineExists ? "已发现原有设置" : "未发现原有设置"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <History className="size-4 text-[var(--accent)]" />
          <h3 className="mb-0 mt-3 text-sm font-semibold">继续原来的上线</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            读取原有线路和运行记录继续管理，不会重新部署。
          </p>
          <Button
            className="mt-4 w-full"
            disabled={busy}
            onClick={onContinue}
            size="sm"
          >
            {decision.action === "continue" ? (
              <LoaderCircle className="animate-spin" />
            ) : null}
            继续管理已有部署
          </Button>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <RotateCcw className="size-4 text-[var(--muted-foreground)]" />
          <h3 className="mb-0 mt-3 text-sm font-semibold">从头设置一次</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            清除 ABCDeploy 保存的部署记录和服务器绑定，再重新设置。
          </p>
          <Button
            className="mt-4 w-full"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
            size="sm"
            variant="secondary"
          >
            {decision.action === "reset" ? (
              <LoaderCircle className="animate-spin" />
            ) : null}
            重新设置部署
          </Button>
        </div>
      </div>

      <Dialog onOpenChange={setConfirmReset} open={confirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确定重新设置部署？</DialogTitle>
            <DialogDescription>
              将清除这个项目在 ABCDeploy
              中保存的部署记录、待办和服务器绑定。项目代码、代码仓库、远程镜像和服务器上正在运行的服务都不会被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => setConfirmReset(false)}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmReset(false);
                onReset();
              }}
            >
              确认重新设置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
