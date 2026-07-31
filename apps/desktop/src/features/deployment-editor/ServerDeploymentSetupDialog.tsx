import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type {
  ServerDeploymentSetupInspection,
  ServerDeploymentSetupOption,
} from "./server-deployment-setup-service";
import { routeHost } from "./server-deployment-setup-service";
import type { ServerDeploymentAuthorizationInput } from "./server-deployment-authorization";
import { ResourceSetupGuide } from "./ResourceSetupGuide";
import {
  CNB_RESOURCE_GUIDE,
  TCR_RESOURCE_GUIDE,
} from "./resource-setup-guides";
import {
  DeploymentSetupProgress,
  type DeploymentSetupMode,
} from "./DeploymentSetupProgress";

export type ServerDeploymentSetupDialogMode = DeploymentSetupMode;

interface ServerDeploymentSetupDialogProps {
  inspection: ServerDeploymentSetupInspection | null;
  mode?: ServerDeploymentSetupDialogMode;
  onClose: () => void;
  onAuthorize?: (input: ServerDeploymentAuthorizationInput) => Promise<void>;
  onRetry: () => Promise<void>;
  onOpenProviderSetup?: (url: string) => Promise<void>;
  onSave: (
    sourceConnectionId: string,
    registryConnectionId: string,
    serverId: string,
  ) => Promise<void>;
  open: boolean;
}

export function ServerDeploymentSetupDialog({
  inspection,
  mode = "initial",
  onClose,
  onAuthorize,
  onRetry,
  onOpenProviderSetup,
  onSave,
  open,
}: ServerDeploymentSetupDialogProps) {
  const [sourceId, setSourceId] = useState("");
  const [registryId, setRegistryId] = useState("");
  const [serverId, setServerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingSettings, setEditingSettings] = useState(false);
  const [authorization, setAuthorization] =
    useState<ServerDeploymentAuthorizationInput>(emptyAuthorization());

  useEffect(() => {
    if (!open || !inspection) return;
    setSourceId(
      inspection.selectedSourceConnectionId ||
        (inspection.sourceOptions.length === 1
          ? inspection.sourceOptions[0].id
          : ""),
    );
    setRegistryId(
      inspection.selectedRegistryConnectionId ||
        (inspection.registryOptions.length === 1
          ? inspection.registryOptions[0].id
          : ""),
    );
    const serverOptions = inspection.serverOptions ?? [];
    setServerId(
      inspection.serverId ||
        (serverOptions.length === 1 ? serverOptions[0].id : ""),
    );
    setError("");
    setEditingSettings(false);
    setAuthorization({
      ...emptyAuthorization(),
      repository: inspection.repository ?? "",
      registryEndpoint: inspection.registryEndpoint || "ccr.ccs.tencentyun.com",
      registryNamespace: inspection.registryNamespace || "abcdeploy",
      secretRepository: inspection.secretRepository ?? "",
    });
  }, [inspection, open]);

  async function submit() {
    if (!sourceId || !registryId || !serverId || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(sourceId, registryId, serverId);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onRetry();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function authorize() {
    if (!onAuthorize || busy) return;
    setBusy(true);
    setError("");
    try {
      await onAuthorize(authorization);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const authorizable =
    Boolean(onAuthorize) &&
    ["missing_connections", "incomplete_project"].includes(
      inspection?.issue ?? "",
    );
  const selectable =
    inspection?.issue === "choose_connections" ||
    (mode === "settings" &&
      Boolean(inspection) &&
      !authorizable &&
      Boolean(inspection?.sourceOptions.length) &&
      Boolean(inspection?.registryOptions.length));
  const showSettingsSummary =
    mode === "settings" && selectable && !editingSettings;
  return (
    <Dialog onOpenChange={(next) => !next && !busy && onClose()} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle(inspection, mode)}</DialogTitle>
          <DialogDescription>
            {dialogDescription(inspection, mode)}
          </DialogDescription>
        </DialogHeader>

        {!showSettingsSummary ? (
          <DeploymentSetupProgress mode={mode} step={1} />
        ) : null}

        {showSettingsSummary && inspection ? (
          <div className="space-y-3 py-1">
            <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
              <ConnectionSummaryRow
                label="生成运行版本"
                option={selectedOption(inspection.sourceOptions, sourceId)}
              />
              <ConnectionSummaryRow
                label="保存运行版本"
                option={selectedOption(inspection.registryOptions, registryId)}
              />
              <ConnectionSummaryRow
                label="运行服务器"
                option={selectedOption(
                  inspection.serverOptions ?? [],
                  serverId,
                )}
              />
              <AddressSummaryRow inspection={inspection} />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => setEditingSettings(true)}
                type="button"
                variant="secondary"
              >
                修改部署设置
              </Button>
            </div>
            <p className="m-0 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
              这里只保存部署线路；不会启动构建、部署、重启服务或替换当前在线版本。
            </p>
          </div>
        ) : null}

        {selectable && inspection && !showSettingsSummary ? (
          <div className="space-y-4 py-1">
            <ConnectionSelect
              label="生成运行版本"
              onChange={setSourceId}
              options={inspection.sourceOptions}
              value={sourceId}
            />
            <ConnectionSelect
              label="保存运行版本"
              onChange={setRegistryId}
              options={inspection.registryOptions}
              value={registryId}
            />
            {mode === "settings" ? (
              <ConnectionSelect
                label="运行服务器"
                onChange={setServerId}
                options={inspection.serverOptions ?? []}
                value={serverId}
              />
            ) : null}
            <p className="m-0 text-xs leading-5 text-[var(--muted-foreground)]">
              这里只选择已保存的连接，不需要重新填写地址、账号或密码。
            </p>
            {mode === "settings" ? (
              <p className="m-0 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
                这里只保存部署线路；不会启动构建、部署、重启服务或替换当前在线版本。
              </p>
            ) : null}
          </div>
        ) : null}

        {authorizable && inspection ? (
          <div className="space-y-3 py-1">
            <PreparationSection
              description={
                inspection.needsSourceAuthorization
                  ? "授权后，系统会在你的默认团队中自动创建一个私有代码仓库。"
                  : "将复用已验证的 CNB 账号，并自动补齐当前项目的私有代码仓库。"
              }
              ready={!inspection.needsSourceAuthorization}
              title="生成运行版本"
            >
              {inspection.needsSourceAuthorization ? (
                <>
                  <ResourceSetupGuide
                    content={CNB_RESOURCE_GUIDE}
                    onOpenUrl={onOpenProviderSetup}
                  />
                  <AuthorizationField
                    label="CNB 访问令牌"
                    onChange={(cnbToken) =>
                      setAuthorization((current) => ({ ...current, cnbToken }))
                    }
                    secret
                    value={authorization.cnbToken}
                  />
                </>
              ) : null}
              <p className="m-0 text-xs leading-5 text-[var(--muted-foreground)]">
                系统会自动创建私有代码仓库；仓库名称建议为{" "}
                {projectSlug(inspection.projectName)}。
              </p>
            </PreparationSection>

            <PreparationSection
              description={
                inspection.needsRegistryAuthorization
                  ? "腾讯云需要先开通个人版并创建一个命名空间，然后把登录信息填在这里。"
                  : "将复用已验证的腾讯云 TCR 登录信息。"
              }
              ready={!inspection.needsRegistryAuthorization}
              title="保存运行版本"
            >
              {inspection.needsRegistryAuthorization ? (
                <>
                  <ResourceSetupGuide
                    content={TCR_RESOURCE_GUIDE}
                    onOpenUrl={onOpenProviderSetup}
                  />
                  <AuthorizationField
                    label="版本仓库命名空间"
                    onChange={(registryNamespace) =>
                      setAuthorization((current) => ({
                        ...current,
                        registryNamespace,
                      }))
                    }
                    value={authorization.registryNamespace}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <AuthorizationField
                      label="版本仓库用户名"
                      onChange={(registryUsername) =>
                        setAuthorization((current) => ({
                          ...current,
                          registryUsername,
                        }))
                      }
                      value={authorization.registryUsername}
                    />
                    <AuthorizationField
                      label="版本仓库访问密码"
                      onChange={(registryPassword) =>
                        setAuthorization((current) => ({
                          ...current,
                          registryPassword,
                        }))
                      }
                      secret
                      value={authorization.registryPassword}
                    />
                  </div>
                </>
              ) : !inspection.registryNamespace ? (
                <AuthorizationField
                  label="版本仓库命名空间"
                  onChange={(registryNamespace) =>
                    setAuthorization((current) => ({
                      ...current,
                      registryNamespace,
                    }))
                  }
                  value={authorization.registryNamespace}
                />
              ) : null}
            </PreparationSection>

            <p className="m-0 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
              完成后会保存为可复用连接。首次上线还会生成一份安全配置清单，只需按提示在
              CNB 网页保存一次。
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="m-0 text-xs text-[var(--destructive)]" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {showSettingsSummary ? (
            <Button disabled={busy} onClick={onClose} variant="secondary">
              关闭
            </Button>
          ) : (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  mode === "settings" && editingSettings
                    ? setEditingSettings(false)
                    : onClose()
                }
                variant="secondary"
              >
                {mode === "settings" && editingSettings ? "取消修改" : "取消"}
              </Button>
              <Button
                disabled={
                  busy ||
                  (selectable &&
                    (!sourceId ||
                      !registryId ||
                      (mode === "settings" && !serverId)))
                }
                onClick={() =>
                  void (selectable
                    ? submit()
                    : authorizable
                      ? authorize()
                      : retry())
                }
              >
                {busy ? <LoaderCircle className="animate-spin-slow" /> : null}
                {mode === "settings"
                  ? authorizable
                    ? "更新授权并继续"
                    : "下一步：确认访问地址"
                  : selectable || authorizable
                    ? "准备并继续"
                    : "重新检查"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AuthorizationField({
  label,
  onChange,
  placeholder,
  secret = false,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secret?: boolean;
  value: string;
}) {
  return (
    <label className="block text-sm font-medium">
      <span className="mb-1.5 block">{label}</span>
      <Input
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={secret ? "password" : "text"}
        value={value}
      />
    </label>
  );
}

function emptyAuthorization(): ServerDeploymentAuthorizationInput {
  return {
    repository: "",
    cnbToken: "",
    registryEndpoint: "ccr.ccs.tencentyun.com",
    registryNamespace: "abcdeploy",
    registryUsername: "",
    registryPassword: "",
    secretRepository: "",
  };
}

function PreparationSection({
  children,
  description,
  ready,
  title,
}: {
  children: ReactNode;
  description: string;
  ready: boolean;
  title: string;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-sm font-semibold">{title}</h3>
          <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {description}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--muted)] px-2 py-1 text-[11px] text-[var(--muted-foreground)]">
          {ready ? "已复用" : "需要连接"}
        </span>
      </div>
      {children}
    </section>
  );
}

function projectSlug(value = "") {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 64) || "abcdeploy-project"
  );
}

function ConnectionSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: ServerDeploymentSetupOption[];
  value: string;
}) {
  return (
    <label className="block text-sm font-medium">
      <span className="mb-1.5 block">{label}</span>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue placeholder="请选择" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name} · {option.detail}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ConnectionSummaryRow({
  label,
  option,
}: {
  label: string;
  option?: ServerDeploymentSetupOption;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
      <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
      <span className="min-w-0 text-right">
        <strong className="block truncate text-sm font-medium">
          {option?.name || "尚未选择"}
        </strong>
        {option?.detail ? (
          <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
            {option.detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function AddressSummaryRow({
  inspection,
}: {
  inspection: ServerDeploymentSetupInspection;
}) {
  const hosts = deploymentHosts(inspection);
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-3">
      <span className="text-sm text-[var(--muted-foreground)]">访问地址</span>
      <span className="min-w-0 text-right">
        <strong className="block truncate text-sm font-medium">
          {hosts[0] || "尚未设置"}
        </strong>
        {hosts.length > 1 ? (
          <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
            共 {hosts.length} 个地址
          </span>
        ) : null}
      </span>
    </div>
  );
}

function deploymentHosts(inspection: ServerDeploymentSetupInspection) {
  const currentRoutes =
    inspection.paths?.length === 1 ? inspection.paths[0].routes : [];
  const routes =
    currentRoutes && currentRoutes.length > 0
      ? currentRoutes
      : (inspection.defaultRoutes ?? []);
  return Array.from(
    new Set(routes.map((route) => routeHost(route.host)).filter(Boolean)),
  );
}

function selectedOption(options: ServerDeploymentSetupOption[], id: string) {
  return options.find((option) => option.id === id);
}

function dialogTitle(
  inspection: ServerDeploymentSetupInspection | null,
  mode: ServerDeploymentSetupDialogMode,
) {
  if (mode === "settings") return "部署设置";
  if (inspection?.issue === "choose_connections") return "选择本次上线服务";
  if (inspection?.issue === "missing_connections")
    return "还缺少可用的上线服务";
  if (inspection?.issue === "incomplete_project") return "项目上线信息还不完整";
  if (inspection?.issue === "multiple_paths") return "检测到多套历史上线设置";
  return "检查首次上线设置";
}

function dialogDescription(
  inspection: ServerDeploymentSetupInspection | null,
  mode: ServerDeploymentSetupDialogMode,
) {
  if (mode === "settings") {
    return "首次上线时建立的同一套设置。默认只读；点击修改后按“部署资源 → 访问地址”两步完成。保存只影响下次更新上线，当前在线版本不变。";
  }
  if (inspection?.issue === "choose_connections") {
    return "存在多个可用连接，系统只需要你各选一个；其他信息会自动复用。";
  }
  if (inspection?.issue === "missing_connections") {
    return "已保存的构建服务或版本仓库目前不可用。更新授权后回到这里重新检查，项目和服务器选择都会保留。";
  }
  if (inspection?.issue === "incomplete_project") {
    return "系统还没有从项目中得到完整的代码仓库和版本仓库信息。项目与服务器选择已经保留。";
  }
  if (inspection?.issue === "multiple_paths") {
    return "这个项目保留了多套旧上线线路，系统不会擅自合并。请先保留一套再继续。";
  }
  return "系统会优先复用已经保存且有效的连接。";
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
