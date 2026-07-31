import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import type { ServerDeploymentAuthorizationResult } from "./server-deployment-authorization";

interface CnbSecretHandoffDialogProps {
  handoff: ServerDeploymentAuthorizationResult | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
  onOpenUrl: (url: string) => Promise<void>;
  open: boolean;
}

export function CnbSecretHandoffDialog({
  handoff,
  onClose,
  onComplete,
  onOpenUrl,
  open,
}: CnbSecretHandoffDialogProps) {
  const [filenameCopied, setFilenameCopied] = useState(false);
  const [contentCopied, setContentCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setFilenameCopied(false);
    setContentCopied(false);
    setBusy(false);
    setError("");
  }, [handoff, open]);

  if (!handoff) return null;
  const editorUrl = `https://cnb.cool/${handoff.secretRepository}/-/new/main`;
  const createUrl = "https://cnb.cool/new/repos";
  const secretRepositoryDocsUrl = "https://docs.cnb.cool/zh/repo/secret.html";

  async function copy(value: string, kind: "filename" | "content") {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === "filename") setFilenameCopied(true);
      else setContentCopied(true);
      return true;
    } catch {
      setError("没有复制成功，请允许客户端使用剪贴板后重试");
      return false;
    }
  }

  return (
    <Dialog onOpenChange={(next) => !next && !busy && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>保存一次上线安全配置</DialogTitle>
          <DialogDescription>
            CNB
            不允许客户端直接写入密钥仓库。按下面两步保存一次，后续上线会自动复用。
          </DialogDescription>
        </DialogHeader>

        {!handoff.repositoryAccessible ? (
          <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4 text-sm leading-6">
            <div className="font-semibold">还没有找到这个 CNB 密钥仓库</div>
            <div className="text-[var(--muted-foreground)]">
              先创建私有仓库 {handoff.secretRepository}
              ，创建后回到这里重新执行验证。
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() => void onOpenUrl(createUrl)}
                type="button"
                variant="secondary"
              >
                <ExternalLink />
                打开 CNB 创建仓库
              </Button>
              <Button
                onClick={() => void onOpenUrl(secretRepositoryDocsUrl)}
                type="button"
                variant="secondary"
              >
                <ExternalLink />
                查看密钥仓库说明
              </Button>
            </div>
          </div>
        ) : null}
        <div className="space-y-3 py-1">
          <HandoffStep
            complete={filenameCopied}
            description={handoff.bundle.filename}
            label="1. 复制文件名"
            onClick={() => void copy(handoff.bundle.filename, "filename")}
          />
          <HandoffStep
            complete={contentCopied}
            description="复制后打开 CNB，把内容粘贴到新文件并保存"
            label="2. 复制内容并打开 CNB"
            onClick={() => {
              void copy(handoff.bundle.content, "content").then(
                async (copied) => {
                  if (!copied) return;
                  try {
                    await onOpenUrl(editorUrl);
                  } catch (caught) {
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "没有打开 CNB，请稍后重试",
                    );
                  }
                },
              );
            }}
          />
          {handoff.bundle.missingVariables.length > 0 ? (
            <p className="m-0 text-xs leading-5 text-[var(--muted-foreground)]">
              项目还有 {handoff.bundle.missingVariables.length}{" "}
              项运行配置未填写；完成这里后，系统会在上线时只让你补这些项目。
            </p>
          ) : null}
          <p className="m-0 text-xs leading-5 text-[var(--muted-foreground)]">
            如果你已经在 CNB
            保存过这份文件，可以直接继续。客户端会记住这次确认，文件内容会在真正构建时由
            CNB 校验。
          </p>
        </div>

        {error ? (
          <p className="m-0 text-xs text-[var(--destructive)]">{error}</p>
        ) : null}
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            稍后处理
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void onComplete().catch((caught) => {
                setBusy(false);
                setError(
                  caught instanceof Error ? caught.message : String(caught),
                );
              });
            }}
          >
            {busy ? <LoaderCircle className="animate-spin-slow" /> : null}
            我已在 CNB 保存，继续
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HandoffStep({
  complete,
  description,
  label,
  onClick,
}: {
  complete: boolean;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="truncate text-xs text-[var(--muted-foreground)]">
          {description}
        </div>
      </div>
      <Button onClick={onClick} size="sm" type="button" variant="secondary">
        {complete ? <Check /> : <Copy />}
        {complete ? "已复制" : "复制"}
      </Button>
    </div>
  );
}
