import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import type {
  NewServerInput,
  PreparedServerConnection,
} from "./server-connection";
import { ResourceSetupGuide } from "./ResourceSetupGuide";
import { SERVER_RESOURCE_GUIDE } from "./resource-setup-guides";

interface ServerConnectionDialogProps {
  initialInput?: NewServerInput | null;
  onClose: () => void;
  onConnected: () => void;
  onConfirm: (
    prepared: PreparedServerConnection,
    password: string,
  ) => Promise<void>;
  onPrepare: (input: NewServerInput) => Promise<PreparedServerConnection>;
  onOpenUrl?: (url: string) => Promise<void>;
  open: boolean;
}

export function ServerConnectionDialog({
  initialInput = null,
  onClose,
  onConnected,
  onConfirm,
  onOpenUrl,
  onPrepare,
  open,
}: ServerConnectionDialogProps) {
  const [name, setName] = useState("运行服务器");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("ubuntu");
  const [port, setPort] = useState("22");
  const [password, setPassword] = useState("");
  const [prepared, setPrepared] = useState<PreparedServerConnection | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initialInput?.name ?? "运行服务器");
      setHost(initialInput?.host ?? "");
      setUser(initialInput?.user ?? "ubuntu");
      setPort(String(initialInput?.port ?? 22));
      setPassword("");
      setPrepared(null);
      setError("");
      return;
    }
    setPassword("");
    setPrepared(null);
    setBusy(false);
    setError("");
  }, [initialInput, open]);

  const valid =
    Boolean(name.trim() && host.trim() && user.trim()) &&
    Number.isInteger(Number(port)) &&
    Number(port) > 0 &&
    Number(port) <= 65_535;

  async function prepare() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      setPrepared(
        await onPrepare({
          name: name.trim(),
          host: host.trim(),
          user: user.trim(),
          port: Number(port),
        }),
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!prepared || !password || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(prepared, password);
      setPassword("");
      onConnected();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={(next) => !next && !busy && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initialInput ? "重新连接服务器" : "连接新服务器"}
          </DialogTitle>
          <DialogDescription>
            只需填写服务器登录信息。ABCDeploy
            会在后台生成专用密钥，密码不会保存。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {!initialInput ? (
            <ResourceSetupGuide
              content={SERVER_RESOURCE_GUIDE}
              onOpenUrl={onOpenUrl}
            />
          ) : null}
          <Field label="名称">
            <Input
              disabled={busy || Boolean(prepared)}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <Field label="服务器地址">
            <Input
              autoFocus
              disabled={busy || Boolean(prepared)}
              onChange={(event) => setHost(event.target.value)}
              placeholder="203.0.113.24"
              value={host}
            />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <Field label="登录用户">
              <Input
                disabled={busy || Boolean(prepared)}
                onChange={(event) => setUser(event.target.value)}
                value={user}
              />
            </Field>
            <Field label="端口">
              <Input
                disabled={busy || Boolean(prepared)}
                inputMode="numeric"
                onChange={(event) => setPort(event.target.value)}
                value={port}
              />
            </Field>
          </div>

          {prepared ? (
            <div className="space-y-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-3">
              <div>
                <strong className="text-sm">确认连接这台服务器</strong>
                <p className="mb-0 mt-1 break-all text-xs leading-5 text-[var(--muted-foreground)]">
                  服务器身份指纹：{prepared.fingerprint}
                </p>
              </div>
              <Field label="服务器登录密码">
                <Input
                  autoComplete="off"
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </Field>
              <p className="m-0 text-xs leading-5 text-[var(--muted-foreground)]">
                密码只用于第一次安装专用公钥。成功后只使用密钥连接。
              </p>
            </div>
          ) : null}

          {error ? (
            <p
              className="m-0 text-xs leading-5 text-[var(--destructive)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="secondary">
            取消
          </Button>
          <Button
            disabled={busy || (prepared ? !password : !valid)}
            onClick={() => void (prepared ? confirm() : prepare())}
          >
            {busy ? <LoaderCircle className="animate-spin-slow" /> : null}
            {prepared ? "确认并连接" : "检查服务器"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block text-sm font-medium">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
