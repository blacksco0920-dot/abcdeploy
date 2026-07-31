import type { DeploymentRun } from "../../types";

const terminalServerDeploymentStatuses = new Set<DeploymentRun["status"]>([
  "needs_action",
  "failed",
  "cancelled",
  "success",
]);

export function isTerminalServerDeployment(run: DeploymentRun) {
  return terminalServerDeploymentStatuses.has(run.status);
}
import { issueFromUnknown } from "../../lib/errors";
import type { DeploymentRunStepView, DeploymentRunView } from "./model";

export function runningRun(
  message: string,
  activeStep: number,
): DeploymentRunView {
  return {
    state: "running",
    message,
    canCloseClient: true,
    steps: runSteps(activeStep),
  };
}

export function completedRun(success: boolean): DeploymentRunView {
  return {
    state: "completed",
    message: success ? "运行结果已经连续验证通过" : "服务状态已经检查",
    canCloseClient: true,
    steps: runSteps(4),
  };
}

export function failedRun(message: string, failedStep = 3): DeploymentRunView {
  return {
    state: "failed",
    message,
    canCloseClient: true,
    steps: runSteps(failedStep, true),
  };
}

export function runSteps(
  activeStep: number,
  failed = false,
): DeploymentRunStepView[] {
  return ["读取源码", "准备运行版本", "启动服务", "验证结果"].map(
    (label, index) => ({
      id: `step-${index}`,
      label,
      status:
        index < activeStep
          ? "completed"
          : index === activeStep
            ? failed
              ? "failed"
              : "running"
            : "pending",
      detail:
        index < activeStep
          ? "已完成"
          : index === activeStep
            ? failed
              ? "没有完成，已保留前面结果"
              : "正在处理"
            : "等待开始",
    }),
  );
}

export function serverDeploymentRunView(
  run: DeploymentRun,
  nowMs: number,
): DeploymentRunView {
  const failed = ["needs_action", "failed", "cancelled"].includes(run.status);
  const completed = run.status === "success";
  const activeStep = serverRunActiveStep(run);
  const steps = runSteps(completed ? 4 : activeStep, failed);
  if (!completed) {
    const current = steps[activeStep];
    if (current) {
      current.label = serverStageLabel(run.currentStage) ?? current.label;
      current.detail = failed
        ? "没有完成，前面结果已保留"
        : serverStageDetail(activeStep, run);
    }
  }
  const startedAtMs = Date.parse(run.startedAt);
  const updatedAtMs = Date.parse(run.updatedAt);
  const quietForMs = Number.isFinite(updatedAtMs)
    ? Math.max(0, nowMs - updatedAtMs)
    : 0;
  const currentLabel =
    serverStageLabel(run.currentStage) ??
    steps.find((step) => step.status === "running" || step.status === "failed")
      ?.label ??
    steps[steps.length - 1]?.label ??
    "准备任务";

  return {
    state: completed ? "completed" : failed ? "failed" : "running",
    message: run.message || "正在读取后台任务状态",
    canCloseClient: true,
    steps,
    progress: {
      completed: steps.filter((step) => step.status === "completed").length,
      total: steps.length,
      currentLabel,
      elapsedLabel: `已运行 ${formatDuration(Math.max(0, nowMs - startedAtMs))}`,
      updatedLabel: progressUpdatedLabel(quietForMs),
      waitingHint:
        run.status === "running" && quietForMs >= 30_000
          ? "这个步骤耗时较长，系统仍在等待远端返回；可以关闭客户端，任务和已完成结果都会保留。"
          : null,
    },
    details: deploymentRunDetails(run),
    recovery: failed ? deploymentRunRecovery(run) : null,
  };
}

function deploymentRunRecovery(run: DeploymentRun) {
  const code = run.issueCode ?? "AD-DEP-201";
  const registryFailure =
    code === "AD-REG-201" ||
    run.actionKind === "deployment-path-registry-retry";
  const routingConfigurationRetry =
    code === "AD-NET-201" && run.message.includes("无法读取公网路由配置");
  const issue = registryFailure
    ? {
        title: "运行版本没有保存到版本仓库",
        message:
          "服务镜像已经生成，但当前腾讯云 TCR 连接不能写入这个项目使用的命名空间。",
      }
    : routingConfigurationRetry
      ? {
          title: "访问地址需要继续验证",
          message: "应用和访问地址都已保留，客户端需要重新读取这条线路的配置。",
        }
      : issueFromUnknown(
          new Error(`${code}：${run.message || "服务器状态还没有确认完成"}`),
          "服务器状态还没有确认完成",
        );
  const artifactCount = run.artifacts?.length ?? 0;
  const configureRuntime =
    code === "AD-CFG-201" ||
    run.actionKind === "deployment-path-runtime-config";
  const addressFailure =
    code === "AD-NET-201" || run.actionKind === "deployment-path-route-check";
  const replaceAddress = addressFailure && routeRequiresReplacement(run);
  const configureAddress =
    addressFailure && ((run.routeChecks?.length ?? 0) < 1 || replaceAddress);
  const recheckAddress = addressFailure && !configureAddress;
  const actionLabel = registryFailure
    ? "更新版本仓库授权"
    : configureRuntime
      ? "补全运行配置"
      : configureAddress
        ? replaceAddress
          ? "更换访问地址"
          : "设置访问地址"
        : routingConfigurationRetry
          ? "继续验证访问地址"
          : recheckAddress
            ? "重新检查访问地址"
            : "核对服务器状态并继续";
  const missingConfigurationVariables = configureRuntime
    ? runtimeConfigurationVariables(run.message)
    : [];
  const nextSteps = registryFailure
    ? [
        "点击“更新版本仓库授权”，确认命名空间，并重新填写有推送权限的用户名和访问密码。",
        "验证通过后会从上传版本继续，不会重新读取源码或构建镜像。",
      ]
    : configureRuntime
      ? [
          "点击“补全运行配置”，只填写页面列出的必要项目。",
          "保存后系统会从“启动服务”继续，已经生成的版本不会重复构建。",
        ]
      : configureAddress
        ? replaceAddress
          ? [
              "点击“更换访问地址”，为需要公网访问的服务填写已备案域名。",
              "保存后只更新访问入口并继续验证，已运行的服务和已生成版本都会保留。",
            ]
          : [
              "点击“设置访问地址”，确认系统生成的地址，或填写你自己的域名。",
              "保存后只继续配置访问入口并验证，已运行的服务和已生成版本都会保留。",
            ]
        : routingConfigurationRetry
          ? [
              "点击“继续验证访问地址”，系统会重新读取这条线路并核对已有地址。",
              "不需要修改域名、重新部署服务或重新构建版本。",
            ]
          : recheckAddress
            ? [
                "点击“重新检查访问地址”，系统会继续等待证书签发并重新验证现有地址。",
                "不会重新部署服务或构建版本，也不需要重新填写已经保存的域名。",
              ]
            : [
                `点击“${actionLabel}”，系统会核对服务器上正在运行的服务和本次镜像版本。`,
                "如果本次版本已经正常运行，系统会跳过重复部署，直接继续配置访问地址；否则只重试启动服务。",
              ];
  return {
    title: issue.title,
    message: issue.message,
    preserved:
      artifactCount > 0
        ? `已生成的 ${artifactCount} 个服务镜像和前两步结果都已保留，无需重新构建。`
        : "已经完成的步骤和填写内容都已保留，无需从头开始。",
    nextSteps,
    action: registryFailure
      ? ("configure_registry" as const)
      : configureRuntime
        ? ("configure_runtime" as const)
        : configureAddress
          ? ("configure_address" as const)
          : recheckAddress
            ? ("recheck_address" as const)
            : ("retry" as const),
    actionLabel,
    ...(missingConfigurationVariables.length > 0
      ? { missingConfigurationVariables }
      : {}),
  };
}

function routeRequiresReplacement(run: DeploymentRun): boolean {
  const evidence = [
    run.message,
    ...(run.routeChecks ?? []).map((check) => check.message),
  ].join("\n");
  return /未备案(?:域名)?|备案域名|域名策略(?:拦截|限制)|请改用[^\n。；;]*域名/.test(
    evidence,
  );
}

export function addressRecheckProgressMessage(actionLabel?: string): string {
  return actionLabel === "继续验证访问地址"
    ? "正在重新读取线路配置并验证已有地址"
    : "正在等待证书签发并重新检查访问地址";
}

function runtimeConfigurationVariables(message: string) {
  const match = message.match(
    /运行服务器还缺少\s+\d+\s+项必要配置[：:]\s*([^。；;\n]+)/,
  );
  if (!match?.[1]) return [];
  return Array.from(
    new Set(
      match[1]
        .split(/[、,，\s]+/)
        .map((key) => key.trim())
        .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)),
    ),
  );
}

function serverRunActiveStep(run: DeploymentRun) {
  if (
    ["complete", "healthcheck", "routes", "verify", "public"].includes(
      run.currentStage,
    )
  ) {
    return 3;
  }
  if (["deploy", "server"].includes(run.currentStage)) return 2;
  if (["build", "registry"].includes(run.currentStage)) return 1;
  return 0;
}

function serverStageDetail(activeStep: number, run?: DeploymentRun) {
  if (run?.currentStage === "build") return "构建服务正在生成服务镜像";
  if (run?.currentStage === "registry") {
    const count = run.artifacts?.length ?? 0;
    return count > 0
      ? `正在把 ${count} 个服务镜像上传到版本仓库`
      : "正在把服务镜像上传到版本仓库";
  }
  return (
    [
      "正在读取源码和任务输入",
      "构建服务正在生成并保存可运行版本",
      "正在更新服务器上的项目服务",
      "正在检查服务状态和访问地址",
    ][activeStep] ?? "正在处理"
  );
}

function serverStageLabel(stage: string) {
  if (stage === "build") return "生成运行版本";
  if (stage === "registry") return "保存运行版本";
  return null;
}

function deploymentRunDetails(run: DeploymentRun) {
  return [
    { label: "任务编号", value: run.id },
    run.buildSerial ? { label: "构建编号", value: run.buildSerial } : null,
    run.commitSha
      ? { label: "代码版本", value: run.commitSha.slice(0, 12) }
      : null,
    (run.artifacts?.length ?? 0) > 0
      ? { label: "已生成版本", value: `${run.artifacts.length} 个服务镜像` }
      : null,
    { label: "当前技术阶段", value: run.currentStage || "准备中" },
    run.issueCode ? { label: "问题编号", value: run.issueCode } : null,
  ].filter(
    (detail): detail is { label: string; value: string } => detail !== null,
  );
}

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs)) return "不足 1 秒";
  const seconds = Math.floor(durationMs / 1_000);
  if (seconds < 60) return `${Math.max(1, seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0
    ? `${minutes} 分 ${remainingSeconds} 秒`
    : `${minutes} 分钟`;
}

function progressUpdatedLabel(quietForMs: number) {
  const seconds = Math.floor(quietForMs / 1_000);
  if (seconds < 15) return "刚刚有新进展";
  if (seconds < 60) return `${seconds} 秒前有新进展`;
  return `${Math.floor(seconds / 60)} 分钟前有新进展`;
}
