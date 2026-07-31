use std::path::PathBuf;
use std::time::Duration;

use deploy_core::mvp::{
    DeploymentEvidence, EvidenceProjection, VerificationAvailability, project_evidence,
};
use deploy_core::providers::{caddy, ssh};
use deploy_core::redact::redact_text;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::source_snapshots::snapshot_local_source;
use super::workspace::{
    DeploymentPath, DeploymentPathInput, DeploymentRun, ServerResource, WorkspaceState,
};
use super::{MANIFEST_FILE, create_deployment_task_inner, load_manifest};

const SERVER_CAPABILITY_PROBE: &str = r#"set -eu
printf 'os=%s\n' "$(uname -s)"
printf 'arch=%s\n' "$(uname -m)"
printf 'docker=%s\n' "$(docker version --format '{{.Server.Version}}')"
printf 'compose=%s\n' "$(docker compose version --short)"
"#;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedServerEnvironment {
    id: String,
    version: String,
    connection_id: String,
    name: String,
    host: String,
    user: String,
    port: u16,
    platform: String,
    architecture: String,
    docker_version: String,
    compose_version: String,
    verified_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PreparedManagedServerDeployment {
    environment: ManagedServerEnvironment,
    deployment_path: DeploymentPath,
    run: DeploymentRun,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ServerCapabilities {
    platform: String,
    architecture: String,
    docker_version: String,
    compose_version: String,
}

/// Resolve a saved server candidate into a stable deployment environment.
///
/// The probe is deliberately read-only. It verifies the pinned SSH host
/// identity and the minimum runtime capabilities before returning a stable
/// environment identity. A failed probe never initializes or changes the
/// remote server.
#[tauri::command]
pub(super) async fn resolve_managed_server_environment(
    server_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<ManagedServerEnvironment, String> {
    resolve_managed_server_environment_inner(&server_id, state.inner()).await
}

/// Prepare the minimum runtime on a verified saved server and return a fresh
/// capability projection. The underlying bootstrap is idempotent and refuses
/// to overwrite unknown services or reverse-proxy configuration.
#[tauri::command]
pub(super) async fn prepare_managed_server_environment(
    server_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<ManagedServerEnvironment, String> {
    let (_, profile, _) = verified_server_profile(&server_id, state.inner()).await?;
    let check = caddy::bootstrap_server(&profile, true)
        .await
        .map_err(|error| {
            format!(
                "AD-SRV-299：服务器运行环境没有准备完成；项目和服务器配置已保留。请重试或查看技术原因。技术原因：{}",
                redact_text(&error.to_string())
            )
        })?;
    if !check.ok {
        let code = check.code.as_deref().unwrap_or("AD-SRV-299");
        let next_step = check
            .next_steps
            .first()
            .map_or("请根据提示处理后重新自动准备服务器", String::as_str);
        return Err(format!(
            "{code}：{}；项目、服务器连接和已完成设置均已保留。下一步：{}",
            redact_text(&check.summary),
            redact_text(next_step)
        ));
    }
    resolve_managed_server_environment_inner(&server_id, state.inner()).await
}

async fn resolve_managed_server_environment_inner(
    server_id: &str,
    state: &WorkspaceState,
) -> Result<ManagedServerEnvironment, String> {
    let (server, profile, expected_fingerprint) = verified_server_profile(server_id, state).await?;

    let output = ssh::execute(
        &profile,
        SERVER_CAPABILITY_PROBE,
        None,
        Duration::from_secs(25),
    )
    .await
    .map_err(|error| {
        format!(
            "AD-ENV-206：服务器连接成功，但无法检查运行能力；服务器没有改动。请确认登录用户可以执行命令后重试。技术原因：{}",
            redact_text(&error.to_string())
        )
    })?;
    if output.exit_status != Some(0) {
        let detail = if output.stderr.trim().is_empty() {
            "服务器没有返回 Docker 和 Compose 版本"
        } else {
            output.stderr.trim()
        };
        return Err(format!(
            "AD-ENV-207：服务器已连接，但还没有运行项目所需的 Docker 环境；服务器没有改动。ABCDeploy 可以自动安装并启动。技术原因：{}",
            redact_text(detail)
        ));
    }
    let capabilities = parse_server_capabilities(&output.stdout)?;
    state.remember_checked_server(&profile).map_err(|error| {
        format!(
            "AD-ENV-208：服务器验证通过，但验证结果没有保存；服务器没有改动。请重试。技术原因：{}",
            redact_text(&error)
        )
    })?;

    Ok(stable_server_environment(
        server_id,
        server.name,
        server.host,
        server.user,
        server.port,
        &expected_fingerprint,
        capabilities,
        chrono::Utc::now().timestamp_millis(),
    ))
}

async fn verified_server_profile(
    server_id: &str,
    state: &WorkspaceState,
) -> Result<(ServerResource, ssh::SshProfile, String), String> {
    let server = state.server_by_id(server_id).map_err(|error| {
        format!(
            "AD-ENV-201：找不到所选服务器；现有服务器和部署都没有改动。请重新选择运行服务器。技术原因：{}",
            redact_text(&error)
        )
    })?;
    if !server.key_path_exists {
        return Err(
            "AD-ENV-202：服务器的登录密钥已移动或删除；服务器没有改动。请重新连接这台服务器。"
                .to_string(),
        );
    }
    let expected_fingerprint = server.host_fingerprint.clone().ok_or_else(|| {
        "AD-ENV-203：这台服务器还没有经过身份确认；服务器没有改动。请重新验证服务器身份。"
            .to_string()
    })?;
    let profile = ssh::SshProfile {
        name: server.name.clone(),
        host: server.host.clone(),
        user: server.user.clone(),
        port: server.port,
        key_path: PathBuf::from(&server.key_path),
        host_fingerprint: Some(expected_fingerprint.clone()),
    };

    let observed = ssh::probe_host_identity(&profile).await.map_err(|error| {
        format!(
            "AD-ENV-204：暂时无法读取服务器身份；服务器没有改动。请检查地址、安全组和 SSH 端口后重试。技术原因：{}",
            redact_text(&error.to_string())
        )
    })?;
    if observed.fingerprint != expected_fingerprint {
        return Err("AD-ENV-205：服务器身份与上次确认的不一致，已停止连接；服务器没有改动。请确认服务器是否被重装或更换。".to_string());
    }
    Ok((server, profile, expected_fingerprint))
}

/// Bridge the new source/environment editor to one already configured legacy
/// deployment path. This command only freezes a resumable deployment task; it
/// does not build or deploy anything and therefore cannot claim success.
///
/// A project with zero or multiple legacy paths is intentionally rejected:
/// selecting or inventing provider bindings here would be ambiguous and could
/// deploy to the wrong registry or server.
#[tauri::command]
pub(super) async fn prepare_managed_server_deployment(
    app: AppHandle,
    project_path: String,
    server_id: String,
    snapshot_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<PreparedManagedServerDeployment, String> {
    verify_source_snapshot(&app, &project_path, &snapshot_id)?;
    let environment = resolve_managed_server_environment_inner(&server_id, state.inner()).await?;
    let paths = state
        .list_deployment_paths(std::path::Path::new(&project_path))
        .map_err(|error| {
            format!(
                "AD-ENV-210：无法读取这个项目已有的上线配置；没有创建上线任务。请重新打开项目后重试。技术原因：{}",
                redact_text(error.as_str())
            )
        })?;
    let existing = select_single_deployment_path(&paths)?;
    let deployment_path = state.save_deployment_path(DeploymentPathInput {
        id: Some(existing.id.clone()),
        project_path: existing.project_path.clone(),
        name: existing.name.clone(),
        source_connection_id: existing.source_connection_id.clone(),
        registry_connection_id: existing.registry_connection_id.clone(),
        server_id: Some(server_id),
        config_profile_ids: existing.config_profile_ids.clone(),
        address: existing.address.clone(),
        routes: existing.routes.clone(),
        state: Some("ready".to_string()),
        last_run_id: existing.last_run_id.clone(),
        current_run_id: existing.current_run_id.clone(),
        last_successful_revision: existing.last_successful_revision.clone(),
    })?;
    let mut run = create_deployment_task_inner(
        project_path,
        "deployment".to_string(),
        None,
        Some(deployment_path.id.clone()),
        state.inner(),
    )?;
    let manifest = load_manifest(&PathBuf::from(&run.project_path).join(MANIFEST_FILE))
        .map_err(|error| {
            format!(
                "AD-ENV-213：无法读取项目的部署配置；服务器没有改动，也没有开始构建。请先完成项目配置。技术原因：{}",
                redact_text(&error.to_string())
            )
        })?;
    run.repository = manifest.providers.build.repository;
    run.branch = manifest.source.release_branch;
    state.save_deployment_run(&run)?;
    Ok(PreparedManagedServerDeployment {
        environment,
        deployment_path,
        run,
    })
}

/// Ensure the remote execution cannot silently read a changed working tree.
/// The legacy executor still consumes the project path, so we recalculate the
/// managed snapshot immediately before creating its task and reject drift.
fn verify_source_snapshot(
    app: &AppHandle,
    project_path: &str,
    expected_snapshot_id: &str,
) -> Result<(), String> {
    if !valid_snapshot_id(expected_snapshot_id) {
        return Err(
            "AD-SRC-120：本次上线的项目快照标识无效；尚未创建服务器任务。请重新读取项目。"
                .to_string(),
        );
    }
    let app_data = app.path().app_data_dir().map_err(|error| {
        format!(
            "AD-SRC-121：无法读取项目快照目录；服务器没有改动。请重新读取项目。技术原因：{error}"
        )
    })?;
    let current = snapshot_local_source(
        std::path::Path::new(project_path),
        &app_data.join("source-snapshots"),
    )?;
    if !current
        .snapshot_id
        .eq_ignore_ascii_case(expected_snapshot_id)
    {
        return Err(
            "AD-SRC-122：项目文件在检查后发生变化；服务器没有改动。请重新检查项目后再上线。"
                .to_string(),
        );
    }
    Ok(())
}

fn valid_snapshot_id(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Project raw verifier rounds through the Rust domain success gate.
///
/// Rounds are observations, not success claims. This command is the Tauri
/// boundary that enforces three spaced passes, freshness and public-access
/// recovery semantics before the renderer can show current success.
#[tauri::command]
pub(super) fn project_managed_deployment_evidence(
    evidence: DeploymentEvidence,
    now_ms: i64,
    online: bool,
) -> EvidenceProjection {
    project_evidence(
        &evidence,
        now_ms,
        if online {
            VerificationAvailability::Online
        } else {
            VerificationAvailability::Offline
        },
    )
}

fn parse_server_capabilities(output: &str) -> Result<ServerCapabilities, String> {
    let value = |key: &str| {
        output
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{key}=")))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let platform = value("os").ok_or_else(capability_output_error)?;
    if platform != "Linux" {
        return Err(format!(
            "AD-ENV-209：当前版本只支持 Linux 服务器，检测到 {platform}；服务器没有改动。请选择 Linux 服务器。"
        ));
    }
    Ok(ServerCapabilities {
        platform,
        architecture: value("arch").ok_or_else(capability_output_error)?,
        docker_version: value("docker").ok_or_else(capability_output_error)?,
        compose_version: value("compose").ok_or_else(capability_output_error)?,
    })
}

fn capability_output_error() -> String {
    "AD-ENV-207：服务器能力检查结果不完整；服务器没有改动。请确认 Docker 与 Docker Compose 可以正常使用后重试。"
        .to_string()
}

fn select_single_deployment_path(paths: &[DeploymentPath]) -> Result<&DeploymentPath, String> {
    match paths {
        [] => Err("AD-ENV-211：还没有完成首次上线设置；没有创建上线任务，服务器也没有改动。请先选择由哪个服务生成可运行版本，以及把版本保存在哪里。完成一次后，后续上线会自动复用。".to_string()),
        [path] => Ok(path),
        _ => Err("AD-ENV-212：这个项目有多条上线线路，当前页面无法安全判断要使用哪一条；没有创建上线任务。请先在已有部署中选择一条线路。".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn stable_server_environment(
    connection_id: &str,
    name: String,
    host: String,
    user: String,
    port: u16,
    fingerprint: &str,
    capabilities: ServerCapabilities,
    verified_at_ms: i64,
) -> ManagedServerEnvironment {
    let mut digest = Sha256::new();
    for value in [
        connection_id,
        fingerprint,
        &capabilities.platform,
        &capabilities.architecture,
        &capabilities.docker_version,
        &capabilities.compose_version,
    ] {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    let version = format!("{:x}", digest.finalize());
    ManagedServerEnvironment {
        id: format!("server-env:{}", &version[..16]),
        version,
        connection_id: connection_id.to_string(),
        name,
        host,
        user,
        port,
        platform: capabilities.platform,
        architecture: capabilities.architecture,
        docker_version: capabilities.docker_version,
        compose_version: capabilities.compose_version,
        verified_at_ms,
    }
}

#[cfg(test)]
mod tests {
    use deploy_core::mvp::{
        DeploymentEvidence, EvidenceCheck, EvidenceCheckKind, EvidenceRequirement, EvidenceRound,
        EvidenceStatus,
    };

    use super::*;

    #[test]
    fn parses_only_complete_linux_capabilities() {
        let capabilities =
            parse_server_capabilities("os=Linux\narch=aarch64\ndocker=27.5.1\ncompose=2.33.0\n")
                .expect("capabilities");
        assert_eq!(capabilities.platform, "Linux");
        assert_eq!(capabilities.architecture, "aarch64");
        assert_eq!(capabilities.docker_version, "27.5.1");
        assert_eq!(capabilities.compose_version, "2.33.0");
    }

    #[test]
    fn rejects_non_linux_and_incomplete_servers_without_claiming_success() {
        let unsupported =
            parse_server_capabilities("os=Darwin\narch=arm64\ndocker=27.5.1\ncompose=2.33.0\n")
                .expect_err("non-linux must be rejected");
        assert!(unsupported.contains("只支持 Linux"));

        let incomplete = parse_server_capabilities("os=Linux\narch=x86_64\n")
            .expect_err("missing Docker facts must be rejected");
        assert!(incomplete.contains("检查结果不完整"));
        assert!(incomplete.contains("服务器没有改动"));
    }

    #[test]
    fn missing_deployment_setup_explains_the_next_step_before_mutation() {
        let error = select_single_deployment_path(&[]).expect_err("missing setup must block");
        assert!(error.contains("还没有完成首次上线设置"));
        assert!(error.contains("服务器也没有改动"));
        assert!(error.contains("生成可运行版本"));
        assert!(error.contains("版本保存在哪里"));
    }

    #[test]
    fn environment_identity_changes_when_verified_capabilities_change() {
        let environment = |docker_version: &str| {
            stable_server_environment(
                "server-1",
                "运行服务器".to_string(),
                "203.0.113.10".to_string(),
                "ubuntu".to_string(),
                22,
                "SHA256:server",
                ServerCapabilities {
                    platform: "Linux".to_string(),
                    architecture: "x86_64".to_string(),
                    docker_version: docker_version.to_string(),
                    compose_version: "2.33.0".to_string(),
                },
                10_000,
            )
        };
        let first = environment("27.5.1");
        let same = environment("27.5.1");
        let changed = environment("28.0.0");
        assert_eq!(first.id, same.id);
        assert_eq!(first.version, same.version);
        assert_ne!(first.id, changed.id);
    }

    #[test]
    fn tauri_projection_requires_three_real_spaced_rounds() {
        let requirements = vec![
            EvidenceRequirement {
                id: "source".to_string(),
                kind: EvidenceCheckKind::SourceIdentity,
            },
            EvidenceRequirement {
                id: "runtime".to_string(),
                kind: EvidenceCheckKind::RuntimeIdentity,
            },
            EvidenceRequirement {
                id: "health".to_string(),
                kind: EvidenceCheckKind::ServiceHealth,
            },
            EvidenceRequirement {
                id: "public".to_string(),
                kind: EvidenceCheckKind::PublicAccess,
            },
        ];
        let round = |checked_at_ms| EvidenceRound {
            checked_at_ms,
            checks: requirements
                .iter()
                .map(|requirement| EvidenceCheck {
                    requirement_id: requirement.id.clone(),
                    kind: requirement.kind,
                    expected: "expected".to_string(),
                    actual: "expected".to_string(),
                    location: "verifier".to_string(),
                    passed: true,
                    raw_evidence_ref: None,
                })
                .collect(),
        };
        let two_rounds = project_managed_deployment_evidence(
            DeploymentEvidence {
                requirements: requirements.clone(),
                rounds: vec![round(0), round(5_000)],
            },
            5_000,
            true,
        );
        assert_eq!(two_rounds.status, EvidenceStatus::Verifying);
        assert!(!two_rounds.can_show_current_success);

        let stable = project_managed_deployment_evidence(
            DeploymentEvidence {
                requirements: requirements.clone(),
                rounds: vec![round(0), round(5_000), round(10_000)],
            },
            10_000,
            true,
        );
        assert_eq!(stable.status, EvidenceStatus::VerifiedCurrent);
        assert!(stable.can_show_current_success);
    }

    #[test]
    fn legacy_bridge_never_guesses_between_zero_or_multiple_paths() {
        let none = select_single_deployment_path(&[]).expect_err("missing path must block");
        assert!(none.contains("没有创建上线任务"));

        let path = |id: &str| DeploymentPath {
            id: id.to_string(),
            project_path: "/tmp/project".to_string(),
            name: "上线".to_string(),
            source_connection_id: Some("cnb".to_string()),
            registry_connection_id: Some("tcr".to_string()),
            server_id: Some("server".to_string()),
            config_profile_ids: Vec::new(),
            address: String::new(),
            routes: Vec::new(),
            state: "ready".to_string(),
            last_run_id: None,
            current_run_id: None,
            last_successful_revision: None,
            created_at: "2026-07-24T00:00:00Z".to_string(),
            updated_at: "2026-07-24T00:00:00Z".to_string(),
        };
        let ambiguous = select_single_deployment_path(&[path("one"), path("two")])
            .expect_err("ambiguous paths must block");
        assert!(ambiguous.contains("无法安全判断"));
        assert!(ambiguous.contains("没有创建上线任务"));
    }

    #[test]
    fn snapshot_identity_must_be_a_content_digest() {
        assert!(valid_snapshot_id(&"a".repeat(64)));
        assert!(!valid_snapshot_id("snapshot-1"));
        assert!(!valid_snapshot_id(&"g".repeat(64)));
    }
}
