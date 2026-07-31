use super::{
    Arc, BTreeMap, BTreeSet, Command, DeploymentPlan, Duration, InspectionReport, Instant,
    LOCAL_START_CANCELLED, LOCAL_START_PROCESSES, LocalPreviewService, LocalPreviewStatus,
    ManagedLocalPortOwner, Mutex, Path, PathBuf, ProjectManifest, Read, ServiceKind, Stdio,
    TcpListener, WorkspaceState, fs, local_compose_path, public_error, system_command,
};

#[derive(Clone, Copy)]
pub(super) struct LocalCommandLimits {
    pub(super) idle: Duration,
    pub(super) total: Duration,
}

pub(super) fn local_build_command_limits() -> LocalCommandLimits {
    LocalCommandLimits {
        idle: Duration::from_mins(3),
        total: Duration::from_mins(30),
    }
}

pub(super) fn local_start_command_limits() -> LocalCommandLimits {
    LocalCommandLimits {
        idle: Duration::from_secs(210),
        total: Duration::from_mins(4),
    }
}

pub(super) fn local_start_cancelled(task_key: &str) -> bool {
    LOCAL_START_CANCELLED
        .get_or_init(|| Mutex::new(BTreeSet::new()))
        .lock()
        .is_ok_and(|cancelled| cancelled.contains(task_key))
}

pub(super) fn set_local_start_pid(task_key: &str, pid: Option<u32>) -> std::io::Result<()> {
    let mut processes = LOCAL_START_PROCESSES
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .map_err(|_| std::io::Error::other("local start task state is unavailable"))?;
    if let Some(active) = processes.get_mut(task_key) {
        *active = pid;
    }
    Ok(())
}

pub(super) fn terminate_local_process_group(pid: u32, force: bool) {
    #[cfg(unix)]
    {
        let signal = if force { "-KILL" } else { "-TERM" };
        let _ = system_command("kill")
            .arg(signal)
            .arg("--")
            .arg(format!("-{pid}"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let mut command = system_command("taskkill");
        command.args(["/PID", &pid.to_string(), "/T"]);
        if force {
            command.arg("/F");
        }
        let _ = command.status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = (pid, force);
}

pub(super) fn stop_local_start_processes() {
    let pids = LOCAL_START_PROCESSES
        .get_or_init(|| Mutex::new(BTreeMap::new()))
        .lock()
        .map(|mut processes| {
            let pids = processes.values().flatten().copied().collect::<Vec<_>>();
            processes.clear();
            pids
        })
        .unwrap_or_default();
    for pid in pids {
        terminate_local_process_group(pid, true);
    }
    if let Ok(mut cancelled) = LOCAL_START_CANCELLED
        .get_or_init(|| Mutex::new(BTreeSet::new()))
        .lock()
    {
        cancelled.clear();
    }
}

pub(super) fn capture_local_command_output<R: Read + Send + 'static>(
    mut reader: R,
    buffer: Arc<Mutex<Vec<u8>>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut chunk = [0_u8; 8 * 1024];
        while let Ok(read) = reader.read(&mut chunk) {
            if read == 0 {
                break;
            }
            let Ok(mut bytes) = buffer.lock() else {
                break;
            };
            bytes.extend_from_slice(&chunk[..read]);
        }
    })
}

pub(super) fn local_command_output_len(
    stdout: &Arc<Mutex<Vec<u8>>>,
    stderr: &Arc<Mutex<Vec<u8>>>,
) -> usize {
    stdout.lock().map_or(0, |bytes| bytes.len()) + stderr.lock().map_or(0, |bytes| bytes.len())
}

pub(super) fn run_tracked_local_command(
    task_key: &str,
    command: &mut Command,
    limits: LocalCommandLimits,
) -> std::io::Result<std::process::Output> {
    if local_start_cancelled(task_key) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "local start was cancelled",
        ));
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let pid = child.id();
    if let Err(error) = set_local_start_pid(task_key, Some(pid)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let stdout = Arc::new(Mutex::new(Vec::new()));
    let stderr = Arc::new(Mutex::new(Vec::new()));
    let stdout_reader = child
        .stdout
        .take()
        .map(|reader| capture_local_command_output(reader, Arc::clone(&stdout)));
    let stderr_reader = child
        .stderr
        .take()
        .map(|reader| capture_local_command_output(reader, Arc::clone(&stderr)));
    let started = Instant::now();
    let mut last_activity = started;
    let mut output_len = 0;
    let stopped = loop {
        if local_start_cancelled(task_key) {
            break Some(std::io::ErrorKind::Interrupted);
        }
        if child.try_wait()?.is_some() {
            break None;
        }
        let next_output_len = local_command_output_len(&stdout, &stderr);
        if next_output_len != output_len {
            output_len = next_output_len;
            last_activity = Instant::now();
        }
        if started.elapsed() >= limits.total || last_activity.elapsed() >= limits.idle {
            break Some(std::io::ErrorKind::TimedOut);
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    if stopped.is_some() {
        terminate_local_process_group(pid, false);
        for _ in 0..10 {
            if child.try_wait()?.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if child.try_wait()?.is_none() {
            terminate_local_process_group(pid, true);
            let _ = child.kill();
        }
    }
    let status = child.wait()?;
    let _ = set_local_start_pid(task_key, None);
    if let Some(reader) = stdout_reader {
        let _ = reader.join();
    }
    if let Some(reader) = stderr_reader {
        let _ = reader.join();
    }
    if let Some(kind) = stopped {
        let message = if kind == std::io::ErrorKind::TimedOut {
            "docker command stopped after making no progress"
        } else {
            "local start was cancelled"
        };
        return Err(std::io::Error::new(kind, message));
    }
    let stdout = stdout
        .lock()
        .map_or_else(|_| Vec::new(), |bytes| bytes.clone());
    let stderr = stderr
        .lock()
        .map_or_else(|_| Vec::new(), |bytes| bytes.clone());
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

pub(super) fn local_command_error(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::TimedOut => {
            "AD-LOC-117：Docker 下载或构建长时间没有进展，已自动停止；请检查 Docker 网络后重试"
                .to_string()
        }
        std::io::ErrorKind::Interrupted => {
            "AD-LOC-118：本次启动已停止，已经运行的其他服务不会受影响".to_string()
        }
        _ => format!("AD-LOC-106：无法启动 Docker：{}", public_error(error)),
    }
}

pub(super) struct LocalBuildResult {
    pub(super) output: std::process::Output,
    pub(super) clear_proxy: bool,
    pub(super) switched_mode: bool,
}

pub(super) fn preferred_local_build_clear_proxy(state: &WorkspaceState) -> bool {
    state
        .setting("local.build.clear-proxy")
        .ok()
        .flatten()
        .as_deref()
        == Some("true")
}

pub(super) fn remember_local_build_proxy_mode(state: &WorkspaceState, result: &LocalBuildResult) {
    if result.switched_mode
        && (result.output.status.success()
            || !looks_like_dependency_network_failure(&result.output))
    {
        let _ = state.set_setting(
            "local.build.clear-proxy",
            if result.clear_proxy { "true" } else { "false" },
        );
    }
}

pub(super) fn local_build_proxy_attempts(preferred_clear_proxy: bool) -> [bool; 2] {
    [preferred_clear_proxy, !preferred_clear_proxy]
}

pub(super) fn run_local_compose_build_with_recovery(
    root: &Path,
    compose_path: &Path,
    task_key: &str,
    preferred_clear_proxy: bool,
    with_dependencies: bool,
    services: &[String],
    use_public_generated_images: bool,
) -> std::io::Result<LocalBuildResult> {
    run_local_build_with_recovery(preferred_clear_proxy, |clear_proxy| {
        run_local_compose_build(
            root,
            compose_path,
            task_key,
            clear_proxy,
            with_dependencies,
            services,
            use_public_generated_images,
        )
    })
}

pub(super) fn run_local_build_with_recovery(
    preferred_clear_proxy: bool,
    mut attempt: impl FnMut(bool) -> std::io::Result<std::process::Output>,
) -> std::io::Result<LocalBuildResult> {
    let [initial_mode, fallback_mode] = local_build_proxy_attempts(preferred_clear_proxy);
    let initial = attempt(initial_mode)?;
    if initial.status.success() || !looks_like_dependency_network_failure(&initial) {
        return Ok(LocalBuildResult {
            output: initial,
            clear_proxy: initial_mode,
            switched_mode: false,
        });
    }
    let fallback = attempt(fallback_mode)?;
    Ok(LocalBuildResult {
        output: fallback,
        clear_proxy: fallback_mode,
        switched_mode: true,
    })
}

pub(super) fn run_local_compose_build(
    root: &Path,
    compose_path: &Path,
    task_key: &str,
    clear_proxy: bool,
    with_dependencies: bool,
    services: &[String],
    use_public_generated_images: bool,
) -> std::io::Result<std::process::Output> {
    let mut command = system_command("docker");
    if use_public_generated_images {
        configure_public_docker_access(&mut command);
    }
    command
        .current_dir(root)
        .args(["compose", "-f"])
        .arg(compose_path)
        .arg("build");
    if with_dependencies {
        command.arg("--with-dependencies");
    }
    if clear_proxy {
        command.args([
            "--build-arg",
            "HTTP_PROXY=",
            "--build-arg",
            "HTTPS_PROXY=",
            "--build-arg",
            "http_proxy=",
            "--build-arg",
            "https_proxy=",
        ]);
    }
    command.args(services);
    run_tracked_local_command(task_key, &mut command, local_build_command_limits())
}

pub(super) fn services_use_public_generated_dockerfiles(
    manifest: &ProjectManifest,
    services: &[String],
) -> bool {
    !services.is_empty()
        && services.iter().all(|service_id| {
            manifest.services.iter().any(|service| {
                service.id == *service_id
                    && service
                        .dockerfile
                        .starts_with(".deploydesk/generated/build/Dockerfile.")
            })
        })
}

pub(super) fn configure_public_docker_access(command: &mut Command) {
    let Some(host) = local_docker_engine_host() else {
        return;
    };
    let plugin_dirs = public_docker_cli_plugin_dirs();
    if plugin_dirs.is_empty() {
        return;
    }
    let config_dir =
        std::env::temp_dir().join(format!("abcdeploy-public-docker-{}", std::process::id()));
    let config = serde_json::json!({ "cliPluginsExtraDirs": plugin_dirs });
    if fs::create_dir_all(&config_dir).is_err()
        || fs::write(
            config_dir.join("config.json"),
            config.to_string().as_bytes(),
        )
        .is_err()
    {
        return;
    }
    command
        .env("DOCKER_CONFIG", config_dir)
        .env("DOCKER_HOST", host);
}

pub(super) fn public_docker_cli_plugin_dirs() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(config_dir) = std::env::var_os("DOCKER_CONFIG") {
        candidates.push(PathBuf::from(config_dir).join("cli-plugins"));
    } else if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))
    {
        candidates.push(PathBuf::from(home).join(".docker/cli-plugins"));
    }
    candidates.extend([
        PathBuf::from("/Applications/Docker.app/Contents/Resources/cli-plugins"),
        PathBuf::from("/usr/local/lib/docker/cli-plugins"),
        PathBuf::from("/usr/local/libexec/docker/cli-plugins"),
        PathBuf::from("/usr/lib/docker/cli-plugins"),
    ]);
    candidates
        .into_iter()
        .filter(|path| path.is_dir())
        .filter_map(|path| path.to_str().map(ToOwned::to_owned))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub(super) fn local_docker_engine_host() -> Option<String> {
    let output = system_command("docker")
        .args([
            "context",
            "inspect",
            "--format",
            "{{.Endpoints.docker.Host}}",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let host = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (host.starts_with("unix://") || host.starts_with("npipe://")).then_some(host)
}

pub(super) fn compose_output_text(output: &std::process::Output) -> String {
    format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

pub(super) fn looks_like_dependency_network_failure(output: &std::process::Output) -> bool {
    looks_like_dependency_network_text(&compose_output_text(output))
}

pub(super) fn looks_like_dependency_network_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "econnrefused",
        "econnreset",
        "enotfound",
        "etimedout",
        "connection refused",
        "performing the request",
        "network timeout",
        "network is unreachable",
        "temporary failure in name resolution",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub(super) fn local_build_failure(output: &std::process::Output) -> String {
    let details = compose_output_text(output);
    let lower = details.to_ascii_lowercase();
    if looks_like_dependency_network_text(&details) {
        "AD-LOC-110：项目依赖下载失败，已自动切换下载方式重试；请检查网络后再试".to_string()
    } else if lower.contains("dockerfile")
        && (lower.contains("no such file") || lower.contains("failed to read"))
    {
        "AD-LOC-111：有服务缺少可用的 Dockerfile，请返回运行方案确认构建方式".to_string()
    } else {
        format!("AD-LOC-112：{}", local_build_failure_summary(&details))
    }
}

pub(super) fn local_build_failure_summary(details: &str) -> String {
    let service = failed_local_build_target(details).map_or_else(
        || "项目服务".to_string(),
        |target| local_build_target_label(&target),
    );
    let mut typescript_issues = BTreeSet::new();
    let mut missing_modules = BTreeSet::new();

    for line in details.lines() {
        if let Some(error_at) = line.find("error TS") {
            let prefix = &line[..error_at];
            let signature_at = ["apps/", "packages/", "src/"]
                .iter()
                .filter_map(|marker| prefix.rfind(marker))
                .max()
                .unwrap_or(error_at);
            typescript_issues.insert(line[signature_at..].trim().to_string());
        }
        if let Some(module) = quoted_value_after(line, "Cannot find module '")
            && module.len() <= 120
            && module
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "@/_-.".contains(character))
        {
            missing_modules.insert(module.to_string());
        }
    }

    if !typescript_issues.is_empty() {
        let issue_count = typescript_issues.len();
        if !missing_modules.is_empty() {
            let modules = missing_modules.into_iter().collect::<Vec<_>>().join("、");
            return format!(
                "{service}没有构建成功：发现 {issue_count} 个 TypeScript 编译问题，其中缺少项目模块 {modules}"
            );
        }
        return format!("{service}没有构建成功：发现 {issue_count} 个 TypeScript 编译问题");
    }

    if !missing_modules.is_empty() {
        let modules = missing_modules.into_iter().collect::<Vec<_>>().join("、");
        return format!("{service}没有构建成功：缺少项目模块 {modules}");
    }

    format!("{service}没有通过代码构建")
}

pub(super) fn failed_local_build_target(details: &str) -> Option<String> {
    details.lines().rev().find_map(|line| {
        let marker_at = line.find("target ")? + "target ".len();
        let target = line[marker_at..].split(':').next()?.trim();
        (!target.is_empty()
            && target.len() <= 80
            && target
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character)))
        .then(|| target.to_string())
    })
}

pub(super) fn local_build_target_label(target: &str) -> String {
    let lower = target.to_ascii_lowercase();
    if lower == "api" || lower.contains("backend") || lower.contains("server") {
        format!("后端服务（{target}）")
    } else if lower.contains("web")
        || lower.contains("front")
        || lower.contains("h5")
        || lower.contains("miniapp")
    {
        format!("网页服务（{target}）")
    } else if lower.contains("worker") || lower.contains("job") {
        format!("后台任务（{target}）")
    } else {
        format!("服务 {target}")
    }
}

pub(super) fn quoted_value_after<'a>(line: &'a str, marker: &str) -> Option<&'a str> {
    let start = line.find(marker)? + marker.len();
    let value = &line[start..];
    let end = value.find('\'')?;
    Some(&value[..end])
}

pub(super) fn local_start_failure(output: &std::process::Output) -> String {
    let details = compose_output_text(output).to_ascii_lowercase();
    if details.contains("port is already allocated") || details.contains("address already in use") {
        "AD-LOC-116：项目要使用的本机端口已经被其他程序占用，关闭占用程序后再启动".to_string()
    } else {
        "AD-LOC-113：容器已经构建，但服务没有全部通过运行检查".to_string()
    }
}

pub(super) fn ensure_local_service_ports_available(
    root: &Path,
    inspection: &InspectionReport,
    manifest: &ProjectManifest,
    requested_services: &[String],
) -> Result<(), String> {
    let current = local_preview_status(root, inspection, manifest, Vec::new());
    for (index, service) in manifest.services.iter().enumerate() {
        if (!requested_services.is_empty() && !requested_services.contains(&service.id))
            || service.kind == ServiceKind::Worker
            || current
                .services
                .iter()
                .any(|candidate| candidate.id == service.id && candidate.running)
        {
            continue;
        }
        let port = deploy_core::render::local_service_host_port(service, index);
        let port_number =
            u16::try_from(port).map_err(|_| format!("AD-LOC-116：本机端口 {port} 超出可用范围"))?;
        if TcpListener::bind(("127.0.0.1", port_number)).is_err() {
            if let Some(owner) = managed_local_port_owner(port_number) {
                return Err(format!(
                    "AD-LOC-120：项目 {} 正在使用本项目需要的 {port} 端口",
                    owner.project
                ));
            }
            return Err(format!(
                "AD-LOC-116：本机端口 {port} 已被其他程序占用，关闭占用程序后再启动"
            ));
        }
    }
    Ok(())
}

pub(super) fn managed_local_port_owner(port: u16) -> Option<ManagedLocalPortOwner> {
    let filter = format!("publish={port}");
    let format = concat!(
        "{{.ID}}\t",
        "{{.Label \"deploydesk.project\"}}\t",
        "{{.Label \"deploydesk.environment\"}}"
    );
    let output = system_command("docker")
        .args(["ps", "--filter", &filter, "--format", format])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_managed_local_port_owner(&String::from_utf8_lossy(&output.stdout))
}

pub(super) fn parse_managed_local_port_owner(value: &str) -> Option<ManagedLocalPortOwner> {
    value.lines().find_map(|line| {
        let mut fields = line.splitn(3, '\t');
        let container_id = fields.next()?.trim();
        let project = fields.next()?.trim();
        let environment = fields.next()?.trim();
        if environment != "development"
            || !(6..=64).contains(&container_id.len())
            || !container_id
                .chars()
                .all(|character| character.is_ascii_hexdigit())
            || project.is_empty()
            || project.chars().any(char::is_control)
        {
            return None;
        }
        Some(ManagedLocalPortOwner {
            container_id: container_id.to_string(),
            project: project.chars().take(80).collect(),
        })
    })
}

pub(super) fn local_preview_status(
    root: &Path,
    inspection: &InspectionReport,
    manifest: &deploy_core::ProjectManifest,
    written_files: Vec<String>,
) -> LocalPreviewStatus {
    let compose_path = local_compose_path(root);
    let running_services = if compose_path.is_file() {
        system_command("docker")
            .current_dir(root)
            .args(["compose", "-f"])
            .arg(&compose_path)
            .args(["ps", "--services", "--filter", "status=running"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
    } else {
        Some(Vec::new())
    };
    let services = manifest
        .services
        .iter()
        .enumerate()
        .map(|(index, service)| {
            let detected = inspection
                .services
                .iter()
                .find(|candidate| candidate.id == service.id);
            let host_port = (service.kind != deploy_core::ServiceKind::Worker)
                .then(|| deploy_core::render::local_service_host_port(service, index));
            let build_strategy = if detected.and_then(|item| item.dockerfile.as_ref()).is_some() {
                "existing"
            } else if service
                .dockerfile
                .starts_with(".deploydesk/generated/build/Dockerfile.")
                && root.join(&service.dockerfile).is_file()
            {
                "generated"
            } else {
                "needs_input"
            };
            LocalPreviewService {
                id: service.id.clone(),
                kind: match &service.kind {
                    deploy_core::ServiceKind::Api => "api",
                    deploy_core::ServiceKind::Web => "web",
                    deploy_core::ServiceKind::Worker => "worker",
                    deploy_core::ServiceKind::Static => "static",
                }
                .to_string(),
                build_strategy: build_strategy.to_string(),
                dockerfile: service.dockerfile.clone(),
                host_port,
                url: host_port.map(|port| format!("http://127.0.0.1:{port}")),
                running: running_services
                    .as_ref()
                    .is_some_and(|running| running.iter().any(|id| id == &service.id)),
            }
        })
        .collect::<Vec<_>>();
    let running_count = services.iter().filter(|service| service.running).count();
    let (state, message) = if running_services.is_none() {
        (
            "unavailable",
            "Docker 当前不可用，启动 Docker Desktop 后可以继续",
        )
    } else if running_count == services.len() && !services.is_empty() {
        ("running", "本地容器均已通过运行检查")
    } else if running_count > 0 {
        ("partial", "部分本地服务仍在启动或需要处理")
    } else if compose_path.is_file() {
        ("stopped", "本地容器预览尚未启动")
    } else {
        ("not_prepared", "本地容器方案尚未生成")
    };
    LocalPreviewStatus {
        state: state.to_string(),
        message: message.to_string(),
        compose_path: compose_path.to_string_lossy().into_owned(),
        env_ready: root.join(".env").is_file(),
        services,
        written_files,
    }
}

pub(super) fn runnable_local_service_ids(status: &LocalPreviewStatus) -> Vec<String> {
    status
        .services
        .iter()
        .filter(|service| service.build_strategy != "needs_input")
        .map(|service| service.id.clone())
        .collect()
}

pub(super) fn planned_local_preview_status(
    root: &Path,
    inspection: &InspectionReport,
    manifest: &deploy_core::ProjectManifest,
    plan: &DeploymentPlan,
    written_files: Vec<String>,
) -> LocalPreviewStatus {
    let mut status = local_preview_status(root, inspection, manifest, written_files);
    let blocked_services = plan
        .blockers
        .iter()
        .filter(|blocker| blocker.code == "AD-CTR-101")
        .filter_map(|blocker| blocker.service.clone())
        .collect::<BTreeSet<_>>();
    apply_planned_local_build_strategies(&mut status, &blocked_services);
    status
}

pub(super) fn apply_planned_local_build_strategies(
    status: &mut LocalPreviewStatus,
    blocked_services: &BTreeSet<String>,
) {
    for service in &mut status.services {
        if service.build_strategy == "needs_input" && !blocked_services.contains(&service.id) {
            service.build_strategy = "generated".to_string();
        }
    }
}
