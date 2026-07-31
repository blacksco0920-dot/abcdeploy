use super::*;

pub(super) fn local_project_plan(
    root: &Path,
) -> Result<
    (
        InspectionReport,
        deploy_core::ProjectManifest,
        DeploymentPlan,
    ),
    String,
> {
    let inspection = inspect_project(root).map_err(public_error)?;
    let manifest_path = root.join(MANIFEST_FILE);
    let mut manifest = if manifest_path.is_file() {
        load_manifest(&manifest_path).map_err(public_error)?
    } else {
        create_default_manifest(&inspection)
    };
    reconcile_detected_services(&inspection, &mut manifest);
    let plan = build_plan(root, &inspection, &manifest).map_err(public_error)?;
    Ok((inspection, manifest, plan))
}

pub(super) fn local_infrastructure_compose() -> &'static str {
    r#"name: abcdeploy-local-infrastructure

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: abcdeploy-local-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: postgres
      TZ: Asia/Shanghai
    ports:
      - "127.0.0.1:${POSTGRES_PORT}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d postgres"]
      interval: 5s
      timeout: 5s
      retries: 30

  redis:
    image: redis:7-alpine
    container_name: abcdeploy-local-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      TZ: Asia/Shanghai
    ports:
      - "127.0.0.1:${REDIS_PORT}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a $${REDIS_PASSWORD} ping | grep -q PONG"]
      interval: 5s
      timeout: 5s
      retries: 30

volumes:
  postgres-data:
  redis-data:
"#
}

pub(super) fn local_infrastructure_port(
    state: &WorkspaceState,
    setting: &str,
    preferred: u16,
    container_name: &str,
) -> Result<u16, String> {
    if let Some(port) = state
        .setting(setting)?
        .and_then(|value| value.parse::<u16>().ok())
        && (local_container_exists(container_name)
            || std::net::TcpListener::bind(("127.0.0.1", port)).is_ok())
    {
        return Ok(port);
    }
    let port = (preferred..=preferred.saturating_add(50))
        .find(|port| std::net::TcpListener::bind(("127.0.0.1", *port)).is_ok())
        .ok_or_else(|| "AD-INF-103：本机没有可用于基础服务的空闲端口".to_string())?;
    state.set_setting(setting, &port.to_string())?;
    Ok(port)
}

pub(super) fn local_container_exists(name: &str) -> bool {
    system_command("docker")
        .args([
            "ps",
            "-a",
            "--filter",
            &format!("name=^/{name}$"),
            "--format",
            "{{.Names}}",
        ])
        .output()
        .is_ok_and(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|candidate| candidate.trim() == name)
        })
}

pub(super) fn local_infrastructure_secret(key: &str) -> Result<Zeroizing<String>, String> {
    match read_keyring_secret(key) {
        Ok(value) if !value.is_empty() => Ok(Zeroizing::new(value)),
        Ok(_) => generate_local_infrastructure_secret(key),
        Err(error) if error == "missing" => generate_local_infrastructure_secret(key),
        Err(error) => Err(error),
    }
}

pub(super) fn generate_local_infrastructure_secret(key: &str) -> Result<Zeroizing<String>, String> {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let mut value = String::with_capacity(64);
    for byte in &bytes {
        write!(&mut value, "{byte:02x}").expect("writing to a String is infallible");
    }
    bytes.zeroize();
    write_keyring_secret(key, &value)?;
    Ok(Zeroizing::new(value))
}

pub(super) fn save_local_infrastructure_profiles(
    state: &WorkspaceState,
    postgres_port: u16,
    redis_port: u16,
    postgres_password: &Zeroizing<String>,
    redis_password: &Zeroizing<String>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let postgres = ConfigProfile {
        id: LOCAL_POSTGRES_PROFILE_ID.to_string(),
        kind: "database".to_string(),
        provider: "abcdeploy_local_postgres".to_string(),
        name: "ABCDeploy 本机 PostgreSQL".to_string(),
        scope: "local".to_string(),
        values: BTreeMap::from([
            ("host".to_string(), "127.0.0.1".to_string()),
            ("port".to_string(), postgres_port.to_string()),
            ("user".to_string(), "abcdeploy".to_string()),
        ]),
        secret_fields: vec!["password".to_string()],
        configured_secret_fields: Vec::new(),
        is_default: true,
        updated_at: now.clone(),
    };
    let redis = ConfigProfile {
        id: LOCAL_REDIS_PROFILE_ID.to_string(),
        kind: "redis".to_string(),
        provider: "abcdeploy_local_redis".to_string(),
        name: "ABCDeploy 本机 Redis".to_string(),
        scope: "local".to_string(),
        values: BTreeMap::from([
            ("host".to_string(), "127.0.0.1".to_string()),
            ("port".to_string(), redis_port.to_string()),
        ]),
        secret_fields: vec!["password".to_string()],
        configured_secret_fields: Vec::new(),
        is_default: true,
        updated_at: now,
    };
    write_keyring_secret(
        &config_profile_secret_key(LOCAL_POSTGRES_PROFILE_ID, "password"),
        postgres_password,
    )?;
    write_keyring_secret(
        &config_profile_secret_key(LOCAL_REDIS_PROFILE_ID, "password"),
        redis_password,
    )?;
    state.save_config_profile(&postgres)?;
    state.save_config_profile(&redis)
}

pub(super) fn local_infrastructure_status(
    app_data: &Path,
    state: &WorkspaceState,
) -> Result<LocalInfrastructureStatus, String> {
    let compose_exists = app_data
        .join("local-infrastructure/docker-compose.yml")
        .is_file();
    let postgres_port = state
        .setting("local.infra.postgres.port")?
        .and_then(|value| value.parse().ok())
        .unwrap_or(55_432);
    let redis_port = state
        .setting("local.infra.redis.port")?
        .and_then(|value| value.parse().ok())
        .unwrap_or(56_379);
    let profiles_ready = state.config_profile(LOCAL_POSTGRES_PROFILE_ID)?.is_some()
        && state.config_profile(LOCAL_REDIS_PROFILE_ID)?.is_some();
    if !compose_exists {
        return Ok(LocalInfrastructureStatus {
            state: "not_prepared".to_string(),
            message: "本机数据库和 Redis 尚未准备".to_string(),
            postgres_running: false,
            redis_running: false,
            postgres_port,
            redis_port,
            profiles_ready,
        });
    }
    let Some((postgres_running, redis_running)) = local_container_readiness() else {
        return Ok(LocalInfrastructureStatus {
            state: "unavailable".to_string(),
            message: "Docker 当前不可用，启动 Docker Desktop 后可以继续".to_string(),
            postgres_running: false,
            redis_running: false,
            postgres_port,
            redis_port,
            profiles_ready,
        });
    };
    let (status, message) = if postgres_running && redis_running {
        ("running", "本机数据库和 Redis 运行正常")
    } else if postgres_running || redis_running {
        ("partial", "部分本机基础服务仍在启动")
    } else {
        ("stopped", "本机基础服务已停止，可以重新启动")
    };
    Ok(LocalInfrastructureStatus {
        state: status.to_string(),
        message: message.to_string(),
        postgres_running,
        redis_running,
        postgres_port,
        redis_port,
        profiles_ready,
    })
}

pub(super) fn local_container_readiness() -> Option<(bool, bool)> {
    let output = system_command("docker")
        .args([
            "ps",
            "-a",
            "--filter",
            "name=^/abcdeploy-local-",
            "--format",
            "{{.Names}}\t{{.State}}\t{{.Status}}",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Some(parse_local_container_readiness(&text))
}

pub(super) fn parse_local_container_readiness(text: &str) -> (bool, bool) {
    let ready = |name: &str| {
        text.lines().any(|line| {
            let mut fields = line.splitn(3, '\t');
            let container = fields.next().unwrap_or_default();
            let state = fields.next().unwrap_or_default();
            let status = fields.next().unwrap_or_default();
            container == name
                && state == "running"
                && !status.contains("(unhealthy)")
                && !status.contains("(health: starting)")
        })
    };
    (
        ready("abcdeploy-local-postgres"),
        ready("abcdeploy-local-redis"),
    )
}

pub(super) fn local_infrastructure_failure(output: &std::process::Output) -> String {
    let details = compose_output_text(output).to_ascii_lowercase();
    if details.contains("port is already allocated") || details.contains("address already in use") {
        "AD-INF-103：本机基础服务端口被其他程序占用".to_string()
    } else if details.contains("pull access denied")
        || details.contains("failed to resolve")
        || details.contains("connection refused")
        || details.contains("timeout")
    {
        "AD-INF-102：基础服务镜像下载失败，请检查网络后重试".to_string()
    } else {
        "AD-INF-104：本机数据库或 Redis 没有正常启动".to_string()
    }
}

pub(super) fn local_development_services(
    root: &Path,
    inspection: &InspectionReport,
    manifest: &ProjectManifest,
) -> Vec<LocalDevelopmentService> {
    let mut result = Vec::new();
    for service in &manifest.services {
        let Some(detected) = inspection
            .services
            .iter()
            .find(|candidate| candidate.id == service.id)
        else {
            continue;
        };
        let dockerfile = root.join(&service.dockerfile);
        let dockerfile_content = fs::read_to_string(&dockerfile).unwrap_or_default();
        let normalized_dockerfile = dockerfile_content.to_ascii_uppercase();
        let generated = service
            .dockerfile
            .starts_with(".deploydesk/generated/build/Dockerfile.");
        if !generated && !normalized_dockerfile.contains("WORKDIR /APP") {
            continue;
        }

        let mut volumes = development_source_volumes(root, detected);
        if volumes.is_empty() {
            continue;
        }
        let (command, container_port, build_target, health_command) = if detected.framework
            == Framework::FastApi
        {
            let Some(start) = detected.start_command.as_deref() else {
                continue;
            };
            (
                if start.contains("--reload") {
                    start.to_string()
                } else {
                    format!("{start} --reload")
                },
                service.container_port,
                None,
                format!(
                    "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:{}{}', timeout=4)\"",
                    service.container_port, service.healthcheck.path
                ),
            )
        } else {
            let package_path = root.join(&detected.path).join("package.json");
            let package: serde_json::Value = fs::read_to_string(&package_path)
                .ok()
                .and_then(|content| serde_json::from_str(&content).ok())
                .unwrap_or_default();
            let scripts = package
                .get("scripts")
                .and_then(serde_json::Value::as_object);
            let candidates: &[&str] = match detected.framework {
                Framework::NestJs => &["start:dev", "dev"],
                Framework::Taro | Framework::UniApp => &["dev:h5", "dev"],
                Framework::NextJs | Framework::Vite => &["dev"],
                _ => &["dev", "start:dev"],
            };
            let Some(script) = candidates
                .iter()
                .find(|candidate| scripts.is_some_and(|items| items.contains_key(**candidate)))
            else {
                continue;
            };
            let script_value = scripts
                .and_then(|items| items.get(*script))
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let mut command =
                development_package_command(inspection.package_manager, &detected.path, script);
            if matches!(
                detected.framework,
                Framework::Vite | Framework::Taro | Framework::UniApp
            ) && !script_value.contains("--host")
            {
                command.push_str(" -- --host 0.0.0.0");
            }
            if detected.framework == Framework::NextJs
                && !script_value.contains("--hostname")
                && !script_value.contains("-H ")
            {
                command.push_str(" -- --hostname 0.0.0.0");
            }
            let container_port =
                development_script_port(script_value).unwrap_or(match detected.framework {
                    Framework::Vite | Framework::Taro | Framework::UniApp => 5173,
                    _ => service.container_port,
                });
            let build_target = (generated
                || normalized_dockerfile.contains(" AS BUILD")
                || normalized_dockerfile.contains(" AS BUILDER"))
            .then(|| {
                if normalized_dockerfile.contains(" AS BUILDER") {
                    "builder".to_string()
                } else {
                    "build".to_string()
                }
            });
            let Some(build_target) = build_target else {
                continue;
            };
            volumes.extend(development_shared_package_volumes(root));
            (
                command,
                container_port,
                Some(build_target),
                format!(
                    "node -e \"fetch('http://127.0.0.1:{}{}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
                    container_port, service.healthcheck.path
                ),
            )
        };
        result.push(LocalDevelopmentService {
            id: service.id.clone(),
            command,
            container_port,
            build_target,
            volumes,
            health_command,
        });
    }
    result
}

pub(super) fn development_package_command(
    manager: PackageManager,
    package_path: &str,
    script: &str,
) -> String {
    let directory = shell_quote(&format!("/app/{}", package_path.trim_matches('/')));
    match manager {
        PackageManager::Pnpm => format!(
            "corepack pnpm --config.verify-deps-before-run=warn --dir {directory} run {script}"
        ),
        PackageManager::Yarn => format!("corepack yarn --cwd {directory} {script}"),
        PackageManager::Bun => format!("bun --cwd {directory} run {script}"),
        PackageManager::Npm | PackageManager::Unknown => {
            format!("npm --prefix {directory} run {script}")
        }
    }
}

pub(super) fn development_script_port(command: &str) -> Option<u16> {
    let parts = command.split_whitespace().collect::<Vec<_>>();
    for (index, part) in parts.iter().enumerate() {
        if let Some(value) = part.strip_prefix("--port=") {
            return value.parse().ok();
        }
        if *part == "--port"
            && let Some(value) = parts.get(index + 1)
            && let Ok(port) = value.parse()
        {
            return Some(port);
        }
    }
    None
}

pub(super) fn development_source_volumes(
    root: &Path,
    detected: &deploy_core::model::DetectedService,
) -> Vec<serde_json::Value> {
    let service_root = root.join(&detected.path);
    let mut paths = Vec::new();
    if detected.framework == Framework::FastApi {
        let source = service_root.join("src");
        if source.is_dir() {
            paths.push((source, "/app/src".to_string()));
        }
    } else {
        for name in ["src", "public"] {
            let source = service_root.join(name);
            if source.exists() {
                paths.push((
                    source,
                    format!("/app/{}/{name}", detected.path.trim_matches('/')),
                ));
            }
        }
        for name in [
            "index.html",
            "vite.config.ts",
            "vite.config.js",
            "nest-cli.json",
        ] {
            let source = service_root.join(name);
            if source.is_file() {
                paths.push((
                    source,
                    format!("/app/{}/{name}", detected.path.trim_matches('/')),
                ));
            }
        }
    }
    paths
        .into_iter()
        .map(|(source, target)| development_bind_mount(&source, &target))
        .collect()
}

pub(super) fn development_shared_package_volumes(root: &Path) -> Vec<serde_json::Value> {
    let packages = root.join("packages");
    let Ok(entries) = fs::read_dir(packages) else {
        return Vec::new();
    };
    entries
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let source = entry.path().join("src");
            if !source.is_dir() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            Some(development_bind_mount(
                &source,
                &format!("/app/packages/{name}/src"),
            ))
        })
        .collect()
}

pub(super) fn development_bind_mount(source: &Path, target: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "bind",
        "source": source.to_string_lossy(),
        "target": target,
    })
}

pub(super) fn write_local_development_compose(
    root: &Path,
    inspection: &InspectionReport,
    manifest: &ProjectManifest,
) -> Result<PathBuf, String> {
    let services = local_development_services(root, inspection, manifest);
    if services.len() != manifest.services.len() {
        return Err("AD-LOC-115：项目没有为全部服务提供可靠的开发命令，请使用稳定运行".to_string());
    }
    let base_path = local_compose_path(root);
    let raw = fs::read_to_string(&base_path).map_err(public_error)?;
    let mut compose: serde_json::Value = serde_yaml_ng::from_str(&raw).map_err(public_error)?;
    let compose_services = compose
        .get_mut("services")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| "AD-LOC-115：本机运行配置缺少服务定义".to_string())?;
    for service in services {
        let value = compose_services
            .get_mut(&service.id)
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| format!("AD-LOC-115：找不到服务 {} 的本机配置", service.id))?;
        if let Some(target) = service.build_target {
            value
                .get_mut("build")
                .and_then(serde_json::Value::as_object_mut)
                .ok_or_else(|| "AD-LOC-115：开发模式缺少镜像构建配置".to_string())?
                .insert("target".to_string(), serde_json::Value::String(target));
        }
        value.insert(
            "command".to_string(),
            serde_json::json!(["sh", "-lc", service.command]),
        );
        value.insert("working_dir".to_string(), serde_json::json!("/app"));
        value.insert("init".to_string(), serde_json::json!(true));
        value.insert(
            "volumes".to_string(),
            serde_json::Value::Array(service.volumes),
        );
        if let Some(ports) = value
            .get_mut("ports")
            .and_then(serde_json::Value::as_array_mut)
            && let Some(port) = ports.first_mut()
            && let Some(current) = port.as_str()
            && let Some((host, _)) = current.rsplit_once(':')
        {
            *port = serde_json::json!(format!("{host}:{}", service.container_port));
        }
        if let Some(environment) = value
            .get_mut("environment")
            .and_then(serde_json::Value::as_object_mut)
        {
            environment.insert("CHOKIDAR_USEPOLLING".to_string(), serde_json::json!("true"));
            environment.insert("WATCHPACK_POLLING".to_string(), serde_json::json!("true"));
            environment.insert(
                "WATCHFILES_FORCE_POLLING".to_string(),
                serde_json::json!("true"),
            );
        }
        if let Some(healthcheck) = value
            .get_mut("healthcheck")
            .and_then(serde_json::Value::as_object_mut)
        {
            healthcheck.insert(
                "test".to_string(),
                serde_json::json!(["CMD-SHELL", service.health_command]),
            );
            healthcheck.insert("start_period".to_string(), serde_json::json!("45s"));
        }
    }
    let directory = root.join(".deploydesk/runtime/development");
    fs::create_dir_all(&directory).map_err(public_error)?;
    let path = directory.join("docker-compose.development.yml");
    let mut content = serde_yaml_ng::to_string(&compose).map_err(public_error)?;
    content.insert_str(
        0,
        "# 由 ABCDeploy 生成，仅用于本机开发调试，不参与测试或正式发布。\n",
    );
    fs::write(&path, content).map_err(public_error)?;
    Ok(path)
}

pub(super) fn local_development_build_services(
    root: &Path,
    inspection: &InspectionReport,
    manifest: &ProjectManifest,
) -> Vec<String> {
    let services = local_development_services(root, inspection, manifest);
    let namespace = &manifest.environments.development.target.namespace;
    services
        .into_iter()
        .filter(|service| {
            if service.build_target.is_some() {
                return true;
            }
            let image = format!("{namespace}-{}", service.id);
            !system_command("docker")
                .args(["image", "inspect", &image])
                .output()
                .is_ok_and(|output| output.status.success())
        })
        .map(|service| service.id)
        .collect()
}

pub(super) fn local_compose_path(root: &Path) -> PathBuf {
    root.join(".deploydesk/generated/development/docker-compose.yml")
}
