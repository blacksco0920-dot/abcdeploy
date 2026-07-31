import { useCallback, useEffect, useRef, useState } from "react";
import { issueFromUnknown } from "../../lib/errors";
import type {
  DeploymentPath,
  DeploymentRun,
  ManagedLocalRunWorkspace,
  ManagedServerEnvironment,
  ManagedSourceSnapshot,
} from "../../types";
import type { DeploymentEvidenceRound } from "../deployment-evidence/model";
import { DeploymentEditorPage } from "./DeploymentEditorPage";
import { DeploymentEditorServerConnectionDialog } from "./DeploymentEditorServerConnectionDialog";
import { DeploymentSetupDialogs } from "./DeploymentSetupDialogs";
import { defaultDeploymentEditorServices } from "./deployment-editor-services";
import { serverEvidenceView } from "./server-evidence";
import {
  resolveServerReadiness,
  serverReadinessFailure,
} from "./server-readiness";
import {
  inferredFolderName,
  SERVER_DEPLOYMENT_SETUP_CHECK_ID,
} from "./server-deployment-setup";
import {
  addressRecheckProgressMessage,
  failedRun,
  isTerminalServerDeployment,
  runningRun,
  serverDeploymentRunView,
} from "./run-view";
import type { NewServerInput } from "./server-connection";
import { editorViewModel } from "./editor-view-model";
import { recheckServerDeploymentAddress } from "./server-route-recovery";
import { restoredServerDeploymentState } from "./restored-server-deployment";
import type {
  DeploymentEditorAction,
  DeploymentEditorControllerProps,
  EditorSystemFailure,
} from "./model";
import {
  createDeploymentEditorSession,
  transitionDeploymentEditorSession,
  type DeploymentEditorSessionEvent,
} from "./session";
import { useSavedDeploymentServers } from "./use-saved-deployment-servers";
import { useDeploymentAdoption } from "./use-deployment-adoption";
import { useRuntimeConfigurationRecovery } from "./use-runtime-configuration-recovery";
import { useDeploymentSetupDialog } from "./use-deployment-setup-dialog";
import { useSourceReadiness } from "./use-source-readiness";
import { useLocalRunVerification } from "./use-local-run-verification";
export function DeploymentEditorController({
  initialLocalPath = null,
  mode = "initial",
  onBack,
  onDeploymentChanged,
  onError,
  services = defaultDeploymentEditorServices,
}: DeploymentEditorControllerProps) {
  const [session, setSession] = useState(() => createDeploymentEditorSession());
  const [systemChecks, setSystemChecks] = useState<string[]>([]);
  const [systemFailure, setSystemFailure] = useState<EditorSystemFailure>(null);
  const sessionRef = useRef(session);
  const localSnapshotRef = useRef<ManagedSourceSnapshot | null>(null);
  const localRunRef = useRef<ManagedLocalRunWorkspace | null>(null);
  const evidenceRoundsRef = useRef<DeploymentEvidenceRound[]>([]);
  const candidateSequence = useRef(0);
  const revisionSequence = useRef(0);
  const runSequence = useRef(0);
  const initialPathHandled = useRef(false);
  const {
    resources: serverResourcesRef,
    servers: savedServers,
    setServers: setSavedServers,
  } = useSavedDeploymentServers(services);
  const [serverConnectionOpen, setServerConnectionOpen] = useState(false);
  const [serverConnectionTarget, setServerConnectionTarget] =
    useState<NewServerInput | null>(null);
  const deploymentSetupDialog = useDeploymentSetupDialog({ onError, services });
  const selectedServerIdRef = useRef<string | null>(null);
  const serverEnvironmentRef = useRef<ManagedServerEnvironment | null>(null);
  const serverDeploymentPathIdRef = useRef<string | null>(null);
  const serverDeploymentRunIdRef = useRef<string | null>(null);
  const serverDeploymentRoutesRef = useRef<DeploymentPath["routes"]>([]);
  const adoption = useDeploymentAdoption({ onError, services });
  const applyEvent = useCallback((event: DeploymentEditorSessionEvent) => {
    const transition = transitionDeploymentEditorSession(
      sessionRef.current,
      event,
    );
    if (transition.accepted) {
      sessionRef.current = transition.state;
      setSession(transition.state);
    }
    return transition;
  }, []);
  const { evaluateReadiness, refreshLocalSourceBeforeRun } = useSourceReadiness(
    {
      applyEvent,
      localSnapshotRef,
      revisionSequence,
      selectedServerIdRef,
      services,
      setInspection: deploymentSetupDialog.setInspection,
      setSystemChecks,
      setSystemFailure,
    },
  );
  const resolveLocalPath = useCallback(
    async (path: string) => {
      const candidateId = `local-${++candidateSequence.current}`;
      localSnapshotRef.current = null;
      localRunRef.current = null;
      evidenceRoundsRef.current = [];
      serverDeploymentRoutesRef.current = [];
      setSystemChecks([]);
      setSystemFailure(null);
      adoption.clear();
      applyEvent({
        type: "local_source_selected",
        candidateId,
        path,
        name: inferredFolderName(path),
      });
      try {
        const snapshot = await services.resolveLocalFolder(path);
        if (snapshot.httpServiceCount < 1) {
          applyEvent({
            type: "source_resolution_failed",
            candidateId,
            message:
              "当前版本只支持至少包含一个网页或 HTTP 服务的项目。项目文件没有改动；请换一个可通过地址访问的项目。",
          });
          return;
        }
        localSnapshotRef.current = snapshot;
        const resolved = applyEvent({
          type: "source_resolution_succeeded",
          candidateId,
          identity: snapshot.snapshotId,
          serviceCount: snapshot.serviceCount,
          name: snapshot.projectName,
        });
        if (
          mode !== "update" &&
          resolved.accepted &&
          (await adoption.inspect(path)) &&
          sessionRef.current.sourceCandidateId === candidateId
        ) {
          return;
        }
        if (resolved.accepted && services.loadLatestServerDeployment) {
          const restored = await services
            .loadLatestServerDeployment(path)
            .catch(() => null);
          if (
            restored &&
            sessionRef.current.sourceCandidateId === candidateId
          ) {
            const projected = restoredServerDeploymentState(
              restored,
              snapshot,
              services.now(),
              savedServers,
            );
            serverResourcesRef.current.set(restored.server.id, restored.server);
            setSavedServers(projected.servers);
            selectedServerIdRef.current = restored.server.id;
            serverEnvironmentRef.current = projected.environment;
            serverDeploymentPathIdRef.current = projected.pathId;
            serverDeploymentRunIdRef.current = projected.runId;
            serverDeploymentRoutesRef.current = restored.path.routes;
            deploymentSetupDialog.reset();
            if (mode === "update") {
              const selected = applyEvent({
                type: "server_environment_selected",
                environmentVersion: projected.environment.version,
                serverId: restored.server.id,
                servers: projected.servers,
              });
              if (selected.accepted) await evaluateReadiness(selected.state);
            } else {
              applyEvent({
                type: "server_deployment_restored",
                environmentVersion: projected.environment.version,
                serverId: restored.server.id,
                servers: projected.servers,
                runId: projected.runId,
                run: projected.run,
                evidence: projected.evidence,
              });
            }
          }
        }
      } catch (error) {
        const issue = issueFromUnknown(error, "项目没有读取完成");
        applyEvent({
          type: "source_resolution_failed",
          candidateId,
          message: `${issue.message} 项目文件没有改动；请重新选择或稍后重试。`,
        });
      }
    },
    [adoption, applyEvent, evaluateReadiness, mode, savedServers, services],
  );
  const resolveAdoptionDecision = useCallback(
    (action: "continue" | "reset") => {
      const projectPath = localSnapshotRef.current?.sourcePath;
      if (!projectPath) return;
      void adoption.resolve(action, projectPath, async () => {
        const freshSession = createDeploymentEditorSession();
        sessionRef.current = freshSession;
        setSession(freshSession);
        selectedServerIdRef.current = null;
        serverEnvironmentRef.current = null;
        serverDeploymentPathIdRef.current = null;
        serverDeploymentRunIdRef.current = null;
        serverDeploymentRoutesRef.current = [];
        deploymentSetupDialog.reset();
        await resolveLocalPath(projectPath);
      });
    },
    [adoption, resolveLocalPath],
  );
  useEffect(() => {
    if (initialPathHandled.current || !initialLocalPath) return;
    initialPathHandled.current = true;
    void resolveLocalPath(initialLocalPath);
  }, [initialLocalPath, resolveLocalPath]);
  const chooseRepository = useCallback(() => {
    const candidateId = `repository-${++candidateSequence.current}`;
    localSnapshotRef.current = null;
    setSystemChecks([]);
    setSystemFailure(null);
    applyEvent({
      type: "repository_source_selected",
      candidateId,
      repositoryUrl: "",
    });
  }, [applyEvent]);
  const changeRepositoryUrl = useCallback(
    (repositoryUrl: string) => {
      const candidateId = `repository-${++candidateSequence.current}`;
      const selected = applyEvent({
        type: "repository_source_selected",
        candidateId,
        repositoryUrl,
      });
      if (!selected.command || selected.command.kind !== "resolve_source")
        return;
      void services
        .resolveRepository(repositoryUrl.trim())
        .then((resolved) => {
          applyEvent({
            type: "source_resolution_succeeded",
            candidateId,
            identity: resolved.identity,
            serviceCount: resolved.serviceCount,
            name: resolved.name,
          });
        })
        .catch((error) => {
          const issue = issueFromUnknown(error, "代码仓库没有读取完成");
          applyEvent({
            type: "source_resolution_failed",
            candidateId,
            message: `${issue.message} 其他选择没有丢失；请检查地址或授权后重试。`,
          });
        });
    },
    [applyEvent, services],
  );
  const selectServer = useCallback(
    async (serverId: string, serverCandidates = savedServers) => {
      selectedServerIdRef.current = serverId;
      serverEnvironmentRef.current = null;
      setSystemChecks(["正在验证服务器身份和运行能力"]);
      setSystemFailure(null);
      const selected = applyEvent({
        type: "server_environment_selected",
        environmentVersion: `server-candidate-${serverId}`,
        serverId,
        servers: serverCandidates,
      });
      if (!selected.accepted) return;
      try {
        const environment = await resolveServerReadiness({
          serverId,
          resolveEnvironment: services.resolveServerEnvironment,
          prepareRuntime: services.prepareServerRuntime,
          onPreparing: () =>
            setSystemChecks(["服务器已连接，正在自动准备服务器运行环境"]),
        });
        serverEnvironmentRef.current = environment;
        setSavedServers((servers) =>
          servers.map((server) =>
            server.id === serverId ? { ...server, verified: true } : server,
          ),
        );
        const resolved = applyEvent({
          type: "server_environment_selected",
          environmentVersion: environment.version,
          serverId,
          servers: serverCandidates,
        });
        if (resolved.accepted) void evaluateReadiness(resolved.state);
      } catch (error) {
        const failure = serverReadinessFailure(error);
        setSystemChecks([]);
        setSystemFailure(failure);
        if (failure.action === "reconnect") {
          setSavedServers((servers) =>
            servers.map((server) =>
              server.id === serverId ? { ...server, verified: false } : server,
            ),
          );
        }
      }
    },
    [applyEvent, evaluateReadiness, savedServers, services],
  );
  const verifyLocalRun = useLocalRunVerification({
    applyEvent,
    evidenceRoundsRef,
    services,
  });
  const startLocal = useCallback(async () => {
    const snapshot = await refreshLocalSourceBeforeRun();
    const revisionId = sessionRef.current.checklist.revision?.id;
    if (!snapshot || !revisionId) return;
    const uiRunId = `local-run-${++runSequence.current}`;
    const requested = applyEvent({
      type: "start_run_requested",
      runId: uiRunId,
      revisionId,
    });
    if (!requested.accepted) return;
    evidenceRoundsRef.current = [];
    applyEvent({
      type: "run_updated",
      runId: uiRunId,
      run: runningRun("正在准备受管运行副本", 1),
    });
    try {
      const managedRun = await services.createLocalRunWorkspace(
        snapshot.snapshotId,
      );
      localRunRef.current = managedRun;
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: runningRun("正在启动项目服务", 2),
      });
      await services.startLocalRun(managedRun.workspacePath);
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: runningRun("正在连续验证运行结果", 3),
      });
      await verifyLocalRun(uiRunId, managedRun, snapshot);
    } catch (error) {
      const issue = issueFromUnknown(error, "本机运行没有完成");
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: failedRun(
          `${issue.message} 项目快照和已填写内容已保留；请处理后重试运行。`,
        ),
      });
      onError(issue.message);
    }
  }, [
    applyEvent,
    onError,
    refreshLocalSourceBeforeRun,
    services,
    verifyLocalRun,
  ]);
  const startServer = useCallback(async () => {
    const snapshot = await refreshLocalSourceBeforeRun();
    const environment = serverEnvironmentRef.current;
    const revisionId = sessionRef.current.checklist.revision?.id;
    if (
      !snapshot ||
      !environment ||
      !revisionId ||
      !services.prepareServerDeployment
    )
      return;
    const uiRunId = `server-run-${++runSequence.current}`;
    const requested = applyEvent({
      type: "start_run_requested",
      runId: uiRunId,
      revisionId,
    });
    if (!requested.accepted) return;
    applyEvent({
      type: "run_updated",
      runId: uiRunId,
      run: runningRun("正在准备服务器上线任务", 1),
    });
    let failedStep = 1;
    try {
      const prepared = await services.prepareServerDeployment(
        snapshot.sourcePath,
        environment.connectionId,
        snapshot.snapshotId,
      );
      serverDeploymentPathIdRef.current = prepared.deploymentPath.id;
      serverDeploymentRunIdRef.current = prepared.run.id;
      serverDeploymentRoutesRef.current = prepared.deploymentPath.routes;
      if (!services.syncServerSource) {
        throw new Error(
          "服务器上线所需的源码同步能力尚未就绪；任务已保存，请稍后重试",
        );
      }
      if (!prepared.run.repository || !prepared.run.branch) {
        throw new Error(
          "服务器上线任务缺少代码仓库配置；服务器没有改动，请先完善部署线路",
        );
      }
      await services.syncServerSource(
        snapshot.sourcePath,
        prepared.run.repository,
        prepared.run.branch,
        true,
        prepared.run.id,
      );
      failedStep = 2;
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: runningRun("运行版本已经准备，正在启动服务器服务", 2),
      });
      if (!services.startServerDeployment) {
        throw new Error("服务器上线执行器尚未就绪；任务已保存，请稍后重试");
      }
      let polling = true;
      let observedTerminalRun: DeploymentRun | null = null;
      const pollProgress = async () => {
        if (
          !services.getServerDeploymentRun ||
          !services.waitForServerProgressInterval
        ) {
          return;
        }
        while (polling) {
          await services.waitForServerProgressInterval();
          if (!polling) return;
          try {
            const durableRun = await services.getServerDeploymentRun(
              snapshot.sourcePath,
              prepared.run.id,
            );
            if (!polling || !durableRun) continue;
            applyEvent({
              type: "run_updated",
              runId: uiRunId,
              run: serverDeploymentRunView(durableRun, services.now()),
            });
            if (isTerminalServerDeployment(durableRun)) {
              observedTerminalRun = durableRun;
              polling = false;
            }
          } catch {
            // A transient progress read must not interrupt the deployment.
          }
        }
      };
      void pollProgress();
      let started: DeploymentRun;
      try {
        while (true) {
          const refreshed = await services.startServerDeployment(
            prepared.run.id,
          );
          started = observedTerminalRun ?? refreshed;
          applyEvent({
            type: "run_updated",
            runId: uiRunId,
            run: serverDeploymentRunView(started, services.now()),
          });
          if (isTerminalServerDeployment(started)) break;
          if (!services.waitForServerProgressInterval) break;
          await services.waitForServerProgressInterval();
          if (observedTerminalRun) {
            started = observedTerminalRun;
            break;
          }
        }
      } finally {
        polling = false;
      }
      const serverEvidence =
        started.status === "success"
          ? serverEvidenceView(
              started,
              environment,
              snapshot,
              services.now(),
              prepared.deploymentPath.routes,
            )
          : null;
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: serverDeploymentRunView(started, services.now()),
      });
      if (serverEvidence) {
        applyEvent({
          type: "evidence_received",
          runId: uiRunId,
          evidence: serverEvidence,
        });
        onDeploymentChanged?.({
          projectPath: snapshot.sourcePath,
          projectName: snapshot.projectName,
          run: started,
        });
      }
    } catch (error) {
      const issue = issueFromUnknown(error, "服务器上线没有完成");
      applyEvent({
        type: "run_updated",
        runId: uiRunId,
        run: failedRun(
          `${issue.message} 已完成的准备和服务器连接都已保留。`,
          failedStep,
        ),
      });
      if (issue.code === "AD-ADOPT-101")
        await adoption.inspect(snapshot.sourcePath);
    }
  }, [
    adoption,
    applyEvent,
    onDeploymentChanged,
    refreshLocalSourceBeforeRun,
    services,
  ]);
  const runtimeConfiguration = useRuntimeConfigurationRecovery({
    deploymentPathId: () => serverDeploymentPathIdRef.current,
    onError,
    onSaved: startServer,
    projectPath: () => localSnapshotRef.current?.sourcePath,
    services,
  });
  const handlePrimaryAction = useCallback(
    (action: DeploymentEditorAction) => {
      if (action.kind === "start_local") {
        void startLocal();
        return;
      }
      if (action.kind === "retry_run") {
        if (sessionRef.current.environment.kind === "server") {
          void startServer();
        } else {
          void startLocal();
        }
        return;
      }
      if (action.kind === "configure_runtime") {
        runtimeConfiguration.open(
          sessionRef.current.run.recovery?.missingConfigurationVariables,
        );
        return;
      }
      if (action.kind === "configure_registry") {
        deploymentSetupDialog.openRegistryAuthorization();
        return;
      }
      if (action.kind === "configure_address") {
        void deploymentSetupDialog.openAddressConfiguration(
          localSnapshotRef.current?.sourcePath ?? null,
          selectedServerIdRef.current,
        );
        return;
      }
      if (action.kind === "recheck_address") {
        const uiRunId = sessionRef.current.activeRunId;
        const durableRunId = serverDeploymentRunIdRef.current;
        const snapshot = localSnapshotRef.current;
        const environment = serverEnvironmentRef.current;
        if (!uiRunId || !durableRunId || !snapshot || !environment) {
          onError("无法读取当前访问地址检查；服务和已生成版本都已保留");
          return;
        }
        const recheckMessage = addressRecheckProgressMessage(
          sessionRef.current.run.recovery?.actionLabel,
        );
        applyEvent({
          type: "run_updated",
          runId: uiRunId,
          run: runningRun(recheckMessage, 3),
        });
        void recheckServerDeploymentAddress(
          services,
          snapshot.sourcePath,
          durableRunId,
          environment,
          snapshot,
          serverDeploymentRoutesRef.current,
        )
          .then(({ run, evidence }) => {
            applyEvent({ type: "run_updated", runId: uiRunId, run });
            if (evidence) {
              applyEvent({
                type: "evidence_received",
                runId: uiRunId,
                evidence,
              });
            }
          })
          .catch((error) =>
            onError(issueFromUnknown(error, "访问地址没有检查完成").message),
          );
        return;
      }
      if (action.kind === "retry_checks") {
        evaluateReadiness(sessionRef.current);
        return;
      }
      if (action.kind === "recheck_evidence") {
        const runId = sessionRef.current.activeRunId;
        const managedRun = localRunRef.current;
        const snapshot = localSnapshotRef.current;
        if (runId && managedRun && snapshot) {
          applyEvent({ type: "verification_requested", runId });
          applyEvent({
            type: "run_updated",
            runId,
            run: runningRun("正在重新检查访问结果", 3),
          });
          void verifyLocalRun(runId, managedRun, snapshot);
        }
        return;
      }
      if (action.kind === "open_result") {
        const address = sessionRef.current.evidence?.primaryAddress;
        if (address) void services.openAddress(address).catch(onError);
        return;
      }
      if (action.kind === "start_server") {
        void startServer();
      }
    },
    [
      applyEvent,
      evaluateReadiness,
      onError,
      onDeploymentChanged,
      deploymentSetupDialog,
      runtimeConfiguration,
      services,
      startLocal,
      startServer,
      verifyLocalRun,
    ],
  );
  const baseModel = editorViewModel(
    session,
    systemChecks,
    systemFailure,
    services,
  );
  const model = {
    ...baseModel,
    adoptionDecision: adoption.decision,
    serverDeploymentAvailable:
      mode === "update" && session.environment.kind === "server"
        ? Boolean(serverDeploymentPathIdRef.current)
        : baseModel.serverDeploymentAvailable,
  };
  return (
    <>
      <DeploymentEditorPage
        mode={mode}
        model={model}
        onBack={onBack}
        onChooseLocalEnvironment={() => {
          const selected = applyEvent({
            type: "local_environment_selected",
            environmentVersion: "local-managed-v1",
          });
          if (selected.accepted) void evaluateReadiness(selected.state);
        }}
        onChooseLocalSource={() => {
          void services.chooseLocalFolder().then((path) => {
            if (path) void resolveLocalPath(path);
          });
        }}
        onChooseRepositorySource={chooseRepository}
        onChooseServerEnvironment={() => {
          serverEnvironmentRef.current = null;
          applyEvent({
            type: "server_environment_selected",
            environmentVersion: "server-unselected",
            serverId: null,
            servers: savedServers,
          });
        }}
        onConnectServer={() => setServerConnectionOpen(true)}
        onOpenDeploymentSettings={() =>
          void deploymentSetupDialog.openSettings(
            localSnapshotRef.current?.sourcePath ?? null,
            selectedServerIdRef.current,
          )
        }
        onContinueExistingDeployment={() =>
          void resolveAdoptionDecision("continue")
        }
        onResetExistingDeployment={() => void resolveAdoptionDecision("reset")}
        onSystemFailureAction={(action) => {
          const serverId = selectedServerIdRef.current;
          if (!serverId) return;
          if (action === "reconnect") {
            const server = serverResourcesRef.current.get(serverId);
            if (!server) return;
            setServerConnectionTarget({
              name: server.name,
              host: server.host,
              user: server.user,
              port: server.port,
              keyPath: server.keyPath,
            });
            setServerConnectionOpen(true);
            return;
          }
          if (action === "choose_server") {
            applyEvent({
              type: "server_environment_selected",
              environmentVersion: "server-unselected",
              serverId: null,
              servers: savedServers,
            });
            return;
          }
          void selectServer(serverId);
        }}
        onPrimaryAction={handlePrimaryAction}
        onRepositoryUrlChange={changeRepositoryUrl}
        onResolveAction={(itemId) => {
          if (itemId.startsWith(`${SERVER_DEPLOYMENT_SETUP_CHECK_ID}:`)) {
            deploymentSetupDialog.openCurrent();
            return;
          }
          void evaluateReadiness(sessionRef.current);
        }}
        onSelectServer={(serverId) => void selectServer(serverId)}
        configurationDialog={runtimeConfiguration.dialog}
      />
      <DeploymentEditorServerConnectionDialog
        onClose={() => {
          setServerConnectionOpen(false);
          setServerConnectionTarget(null);
        }}
        onConfirmed={async (resource, nextServers) => {
          setSavedServers(nextServers);
          serverResourcesRef.current.set(resource.id, resource);
          await selectServer(resource.id, nextServers);
        }}
        open={serverConnectionOpen}
        savedServers={savedServers}
        services={services}
        sourcePath={localSnapshotRef.current?.sourcePath ?? null}
        target={serverConnectionTarget}
      />
      <DeploymentSetupDialogs
        addressRequired={session.run.recovery?.action === "configure_address"}
        inspection={deploymentSetupDialog.inspection}
        mode={deploymentSetupDialog.mode}
        onClose={deploymentSetupDialog.close}
        onResolved={async (continueRun, inspection) => {
          if (deploymentSetupDialog.mode === "settings") {
            if (
              inspection?.issue &&
              [
                "missing_connections",
                "incomplete_project",
                "choose_connections",
              ].includes(inspection.issue)
            ) {
              deploymentSetupDialog.setInspection(inspection);
              return;
            }
            deploymentSetupDialog.close();
            return;
          }
          if (inspection?.issue)
            return deploymentSetupDialog.setInspection(inspection);
          deploymentSetupDialog.close();
          if (continueRun) await startServer();
          else await evaluateReadiness(sessionRef.current, inspection);
        }}
        open={deploymentSetupDialog.open}
        services={services}
      />
    </>
  );
}
