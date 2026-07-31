import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import type { DeploymentPathRoute } from "../../types";
import {
  routeHost,
  type ServerDeploymentSetupInspection,
} from "./server-deployment-setup-service";
import { ResourceSetupGuide } from "./ResourceSetupGuide";
import { domainResourceGuide } from "./resource-setup-guides";
import type { ServerDeploymentSetupDialogMode } from "./ServerDeploymentSetupDialog";
import { DeploymentSetupProgress } from "./DeploymentSetupProgress";

interface ServerAddressDialogProps {
  inspection: ServerDeploymentSetupInspection | null;
  mode?: ServerDeploymentSetupDialogMode;
  onBack?: () => void;
  onClose: () => void;
  onOpenUrl?: (url: string) => Promise<void>;
  onSave: (routes: DeploymentPathRoute[]) => Promise<void>;
  open: boolean;
}

export function ServerAddressDialog({
  inspection,
  mode = "initial",
  onBack,
  onClose,
  onOpenUrl,
  onSave,
  open,
}: ServerAddressDialogProps) {
  const initialRoutes = useMemo(() => routeFields(inspection), [inspection]);
  const [routes, setRoutes] = useState<DeploymentPathRoute[]>(initialRoutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setRoutes(initialRoutes);
    setError("");
  }, [initialRoutes, open]);

  const complete =
    routes.length > 0 && routes.every((route) => routeHost(route.host));

  async function submit() {
    if (!complete || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(
        routes.map((route) => ({ ...route, host: routeHost(route.host) })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={(next) => !next && !busy && onClose()} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "settings" ? "部署设置" : "设置项目访问地址"}
          </DialogTitle>
          <DialogDescription>
            {mode === "settings"
              ? "第 2 步，共 2 步：确认下次更新上线使用的访问地址。保存不会重新构建、部署或重启服务；当前在线版本不变。"
              : inspection?.requiresRegisteredDomain
                ? "这台服务器不接受系统生成的临时域名。请为每个服务填写已备案域名；保存后只继续配置访问入口和验证。"
                : "服务已经启动。确认系统生成的地址，或换成你自己的域名；保存后只继续配置访问入口和验证。"}
          </DialogDescription>
        </DialogHeader>
        <DeploymentSetupProgress mode={mode} step={2} />
        <div className="space-y-4 py-1">
          {routes.map((route, index) => {
            const service = inspection?.publicServices.find(
              (candidate) => candidate.id === route.service,
            );
            const name = service?.name || route.service || "项目";
            return (
              <label className="block text-sm font-medium" key={route.service}>
                <span className="mb-1.5 block">{name}访问地址</span>
                <Input
                  aria-label={`${name}访问地址`}
                  onChange={(event) =>
                    setRoutes((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, host: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder="例如 app.example.com"
                  value={route.host}
                />
                <span className="mt-1 block text-xs font-normal text-[var(--muted-foreground)]">
                  {service?.detail || `项目服务 ${route.service}`}
                </span>
              </label>
            );
          })}
          <ResourceSetupGuide
            content={domainResourceGuide(
              Boolean(inspection?.requiresRegisteredDomain),
            )}
            onOpenUrl={onOpenUrl}
          />
          <p className="m-0 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
            {mode === "settings"
              ? "本次保存仅更新部署线路；这些地址会在下次更新上线时使用。"
              : "地址只用于把外部请求转给已经运行的服务，不会重新构建镜像，也不会重启已完成的步骤。"}
          </p>
        </div>
        {error ? (
          <p className="m-0 text-xs text-[var(--destructive)]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={mode === "settings" ? (onBack ?? onClose) : onClose}
            variant="secondary"
          >
            {mode === "settings" ? "返回部署设置" : "取消"}
          </Button>
          <Button disabled={!complete || busy} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin-slow" /> : null}
            {mode === "settings" ? "保存为下次上线设置" : "保存并继续上线"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function routeFields(inspection: ServerDeploymentSetupInspection | null) {
  if (!inspection) return [];
  const paths = inspection.paths ?? [];
  const currentPath = paths.length === 1 ? paths[0] : undefined;
  const current = currentPath?.routes ?? [];
  const known = current.length > 0 ? current : (inspection.defaultRoutes ?? []);
  const routes = (inspection.publicServices ?? []).map((service) => {
    const route = known.find((candidate) => candidate.service === service.id);
    return route ?? { service: service.id, host: "", path: "/" };
  });
  if (routes.length > 0) return routes;
  if (known.length > 0) return known;
  return [{ service: "web", host: "", path: "/" }];
}
