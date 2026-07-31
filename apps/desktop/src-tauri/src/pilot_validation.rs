use super::{
    BTreeSet, DeploymentArtifact, DeploymentPathInput, DeploymentRun, Duration, Instant,
    MANIFEST_FILE, Path, PathBuf, Serialize, WorkspaceState, Zeroize, Zeroizing, apply_plan,
    build_plan, caddy, create_deployment_task_inner, ensure_cnb_repository, fs, inspect_project,
    load_manifest, open_project_preview, prepare_deployment_path_retry_inner, public_error,
    read_keyring_secret, reconcile_compat_connections, reconcile_detected_services,
    refresh_deployment_path, remote_runtime_content, runtime_config_key,
    start_deployment_path_inner, sync_project_to_cnb_inner, take_over_deployment_path_routes_inner,
    validate_manifest, verified_deployment_path_profile, write_keyring_secret,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PilotDeploymentEvidence {
    project: String,
    deployment_path_id: String,
    task_id: String,
    status: String,
    build_serial: Option<String>,
    commit_sha: Option<String>,
    artifacts: Vec<DeploymentArtifact>,
    public_urls: Vec<String>,
}

/// Runs the same path engine as the desktop UI for a real-project acceptance
/// pilot. This intentionally lives behind a hidden binary argument: it is a
/// local QA entry point, not a second deployment implementation or a user
/// workflow. Output contains only immutable identifiers and public URLs.
pub fn run_pilot_validation_cli(project_path: &str) -> Result<(), String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位当前用户目录".to_string())?;
    let database = home
        .join("Library")
        .join("Application Support")
        .join("cloud.finagent.abcdeploy")
        .join("workspace.sqlite3");
    let state = WorkspaceState::open(&database)?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(public_error)?;
    let evidence = runtime.block_on(run_pilot_validation(PathBuf::from(project_path), &state))?;
    let output = serde_json::to_string_pretty(&evidence).map_err(public_error)?;
    println!("{output}");
    Ok(())
}

async fn run_pilot_validation(
    root: PathBuf,
    state: &WorkspaceState,
) -> Result<PilotDeploymentEvidence, String> {
    let root = root.canonicalize().map_err(public_error)?;
    if !root.join(MANIFEST_FILE).is_file() {
        return Err("试点项目缺少 deploy.yaml".to_string());
    }
    reconcile_compat_connections(state)?;
    open_project_preview(root.clone(), state)?;
    if state.project_adoption(&root)?.mode == "pending" {
        state.continue_existing_deployment(&root)?;
    }

    let inspection = inspect_project(&root).map_err(public_error)?;
    let mut manifest = load_manifest(&root.join(MANIFEST_FILE)).map_err(public_error)?;
    reconcile_detected_services(&inspection, &mut manifest);
    let (namespace, repository_name) = manifest
        .providers
        .build
        .repository
        .split_once('/')
        .ok_or_else(|| "构建仓库格式不正确".to_string())?;
    let setup = ensure_cnb_repository(namespace.to_string(), repository_name.to_string()).await?;
    manifest
        .providers
        .build
        .repository
        .clone_from(&setup.repository);
    if manifest.source.repository.starts_with("owner/")
        || manifest.source.repository.contains("replace-me")
    {
        manifest.source.repository.clone_from(&setup.repository);
    }
    let validation = validate_manifest(&manifest);
    if !validation.valid {
        return Err("试点项目的部署配置没有通过校验".to_string());
    }
    let plan = build_plan(&root, &inspection, &manifest).map_err(public_error)?;
    apply_plan(&root, &plan).map_err(public_error)?;
    state.mark_project_fresh_draft_saved(&root)?;
    state.set_project_step(&root, "workspace")?;

    // The pilot must exercise the same line that the user sees in the UI.
    // Creating a hidden parallel line would let it take over the same public
    // host while the visible line still reported an older version as online.
    let existing = state
        .list_deployment_paths(&root)?
        .into_iter()
        .find(|path| path.name == "上线")
        .or_else(|| state.list_deployment_paths(&root).ok()?.into_iter().next())
        .ok_or_else(|| "请先在客户端创建并配置一条可见的上线线路".to_string())?;
    if existing.routes.is_empty() {
        return Err("请先在线路的运行服务器节点设置访问地址".to_string());
    }
    let source_id = existing
        .source_connection_id
        .as_deref()
        .ok_or_else(|| "请先在线路中选择构建服务".to_string())?;
    let source = state.connection_by_id(source_id)?;
    if source.kind != "source" || source.provider != "cnb" || source.status != "ready" {
        return Err("线路当前选择的构建服务尚未验证".to_string());
    }
    let registry_id = existing
        .registry_connection_id
        .as_deref()
        .ok_or_else(|| "请先在线路中选择版本仓库".to_string())?;
    let registry = state.connection_by_id(registry_id)?;
    if registry.kind != "registry" || registry.status != "ready" {
        return Err("线路当前选择的版本仓库尚未验证".to_string());
    }
    let server_id = existing
        .server_id
        .as_deref()
        .ok_or_else(|| "请先在线路中选择运行服务器".to_string())?;
    let server = state.server_by_id(server_id)?;
    if !server.key_path_exists || server.host_fingerprint.is_none() {
        return Err("线路当前选择的运行服务器尚未验证".to_string());
    }
    let path = state.save_deployment_path(DeploymentPathInput {
        id: Some(existing.id.clone()),
        project_path: root.to_string_lossy().into_owned(),
        name: existing.name.clone(),
        source_connection_id: Some(source.id),
        registry_connection_id: Some(registry.id),
        server_id: Some(server.id),
        config_profile_ids: existing.config_profile_ids.clone(),
        address: existing.address.clone(),
        routes: existing.routes.clone(),
        state: Some("ready".to_string()),
        last_run_id: existing.last_run_id.clone(),
        current_run_id: existing.current_run_id.clone(),
        last_successful_revision: existing.last_successful_revision,
    })?;
    seed_pilot_runtime_config(&root, &path.id)?;

    let profile = verified_deployment_path_profile(&path, state).await?;
    let caddy_check = caddy::bootstrap_server(&profile, true)
        .await
        .map_err(public_error)?;
    if !caddy_check.ok {
        return Err(caddy_check.summary);
    }
    state.remember_checked_server(&profile)?;

    // A repaired address resumes the same immutable task. This is the same
    // continuation rule as the visible UI: completed build/registry work is
    // retained, only the server node gets a fresh append-only attempt.
    if let Some(last_run_id) = path.last_run_id.as_deref()
        && let Ok(previous) = state.deployment_run(last_run_id)
        && matches!(previous.status.as_str(), "queued" | "running")
    {
        let run = await_pilot_deployment(&manifest.project.name, previous, state).await?;
        return Ok(pilot_evidence(manifest.project.name, path.id, run));
    }
    if let Some(last_run_id) = path.last_run_id.as_deref()
        && let Ok(previous) = state.deployment_run(last_run_id)
        && previous.status == "needs_action"
        && !previous.artifacts.is_empty()
        && pilot_can_resume_existing_artifacts(&previous)
    {
        let prepared =
            prepare_deployment_path_retry_inner(previous.id, "server".to_string(), state)?;
        // The visible “继续上线” button invokes refresh after a repaired node
        // has been selected. The pilot must exercise that exact continuation
        // boundary as well instead of treating the prepared needs-action
        // record as a terminal error.
        let run = refresh_deployment_path(prepared, state).await?;
        let run = await_pilot_deployment(&manifest.project.name, run, state).await?;
        return Ok(pilot_evidence(manifest.project.name, path.id, run));
    }

    let task = create_deployment_task_inner(
        root.to_string_lossy().into_owned(),
        "deployment".to_string(),
        None,
        Some(path.id.clone()),
        state,
    )?;
    state.begin_deployment_attempt(&task.id)?;
    let source = sync_project_to_cnb_inner(
        root.to_string_lossy().into_owned(),
        manifest.providers.build.repository.clone(),
        manifest.source.release_branch.clone(),
        true,
        Some(task.id.clone()),
        state,
    )?;
    let run = start_deployment_path_inner(
        root.to_string_lossy().into_owned(),
        source.commit_sha,
        task.id,
        state,
    )
    .await?;
    let run = await_pilot_deployment(&manifest.project.name, run, state).await?;
    Ok(pilot_evidence(manifest.project.name, path.id, run))
}

pub(super) fn pilot_can_resume_existing_artifacts(run: &DeploymentRun) -> bool {
    let unhealthy_container =
        run.message.contains("container ") && run.message.contains(" is unhealthy");
    let artifact_failure = run.issue_code.as_deref().is_some_and(|code| {
        ["AD-BLD-", "AD-PKG-", "AD-IMG-", "AD-CTR-"]
            .iter()
            .any(|prefix| code.starts_with(prefix))
    });
    !unhealthy_container && !artifact_failure
}

async fn await_pilot_deployment(
    project_name: &str,
    mut run: DeploymentRun,
    state: &WorkspaceState,
) -> Result<DeploymentRun, String> {
    let started = Instant::now();
    let mut retries = 0_u8;
    let mut last_progress = String::new();
    loop {
        let progress = format!("{}:{}", run.status, run.current_stage);
        if progress != last_progress {
            eprintln!("ABCDeploy pilot {project_name} {progress}");
            last_progress = progress;
        }
        match run.status.as_str() {
            "success" => break,
            "needs_action"
                if run.action_kind.as_deref() == Some("deployment-path-route-takeover") =>
            {
                run = take_over_deployment_path_routes_inner(run.id, true, state).await?;
                continue;
            }
            "needs_action" if run.action_kind.as_deref() == Some("deployment-path-route-check") => {
                if retries >= 12 {
                    return Err(run.message);
                }
                retries += 1;
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            "failed" | "cancelled" | "needs_action" => return Err(run.message),
            "queued" | "running" => {
                tokio::time::sleep(Duration::from_secs(8)).await;
            }
            _ => return Err("上线任务返回了无法识别的状态".to_string()),
        }
        if started.elapsed() > Duration::from_mins(90) {
            return Err("试点上线超过 90 分钟，已停止本次验收".to_string());
        }
        run = refresh_deployment_path(run, state).await?;
    }
    Ok(run)
}

fn pilot_evidence(
    project: String,
    deployment_path_id: String,
    run: DeploymentRun,
) -> PilotDeploymentEvidence {
    PilotDeploymentEvidence {
        project,
        deployment_path_id,
        task_id: run.id,
        status: run.status,
        build_serial: run.build_serial,
        commit_sha: run.commit_sha,
        artifacts: run.artifacts,
        public_urls: run
            .route_checks
            .into_iter()
            .filter(|check| check.reachable)
            .map(|check| check.url)
            .collect(),
    }
}

fn seed_pilot_runtime_config(root: &Path, path_id: &str) -> Result<(), String> {
    let target_key = runtime_config_key(root, path_id)?;
    let mut content = match read_keyring_secret(&target_key) {
        Ok(value) if !value.trim().is_empty() => Zeroizing::new(value),
        Ok(mut value) => {
            value.zeroize();
            Zeroizing::new(String::new())
        }
        Err(error) if error == "missing" => Zeroizing::new(String::new()),
        Err(error) => return Err(error),
    };
    if content.trim().is_empty() {
        for scope in ["production", "staging", "development"] {
            let key = runtime_config_key(root, scope)?;
            if let Ok(mut value) = read_keyring_secret(&key)
                && !value.trim().is_empty()
            {
                *content = remote_runtime_content(&value, &BTreeSet::new(), false);
                value.zeroize();
                break;
            }
        }
    }
    if content.trim().is_empty() {
        for filename in [".env.production", ".env.staging", ".env"] {
            let path = root.join(filename);
            if let Ok(mut value) = fs::read_to_string(path)
                && !value.trim().is_empty()
            {
                *content = remote_runtime_content(&value, &BTreeSet::new(), false);
                value.zeroize();
                break;
            }
        }
    }

    if !content.trim().is_empty() {
        write_keyring_secret(&target_key, &content)?;
    }
    Ok(())
}
