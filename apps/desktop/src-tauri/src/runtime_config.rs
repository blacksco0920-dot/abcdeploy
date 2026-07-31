use super::*;

#[tauri::command]
pub(super) fn runtime_secret_status(
    path: String,
    environment: String,
    variable: String,
) -> Result<RuntimeSecretStatus, String> {
    let key = runtime_secret_key(Path::new(&path), &environment, &variable)?;
    let stored = match read_keyring_secret(&key) {
        Ok(mut value) => {
            let stored = !value.is_empty();
            value.zeroize();
            stored
        }
        Err(error) if error == "missing" => false,
        Err(error) => return Err(error),
    };
    Ok(RuntimeSecretStatus {
        environment,
        variable,
        stored,
    })
}

#[allow(clippy::needless_pass_by_value)] // Tauri IPC deserializes owned arguments.
#[tauri::command]
pub(super) fn store_runtime_secret(
    path: String,
    environment: String,
    variable: String,
    mut value: String,
) -> Result<RuntimeSecretStatus, String> {
    if value.is_empty() {
        return Err("配置值不能为空".to_string());
    }
    let key = runtime_secret_key(Path::new(&path), &environment, &variable)?;
    let result = write_keyring_secret(&key, &value);
    value.zeroize();
    result?;
    Ok(RuntimeSecretStatus {
        environment,
        variable,
        stored: true,
    })
}
#[allow(clippy::needless_pass_by_value)] // Tauri IPC deserializes owned arguments.
#[tauri::command]
pub(super) fn generate_runtime_secret(
    path: String,
    environment: String,
    variable: String,
) -> Result<RuntimeSecretStatus, String> {
    let key = runtime_secret_key(Path::new(&path), &environment, &variable)?;
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in &bytes {
        write!(&mut value, "{byte:02x}").expect("writing to a String is infallible");
    }
    bytes.zeroize();
    let result = write_keyring_secret(&key, &value);
    value.zeroize();
    result?;
    Ok(RuntimeSecretStatus {
        environment,
        variable,
        stored: true,
    })
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri IPC deserializes owned arguments.
pub(super) fn load_runtime_config(
    path: String,
    environment: String,
    authorize: bool,
) -> Result<RuntimeConfigFile, String> {
    let environment_name = parse_runtime_environment(&environment)?;
    let root = PathBuf::from(path);
    let (template_content, source_files, required_variables) =
        runtime_config_template(&root, environment_name)?;
    let key = runtime_config_key(&root, &environment)?;
    let read_result = if authorize {
        read_keyring_secret(&key)
    } else {
        read_keyring_secret_without_prompt(&key)
    };
    let local_content = (environment_name == EnvironmentName::Development)
        .then(|| fs::read_to_string(root.join(".env")).ok())
        .flatten()
        .filter(|value| !value.trim().is_empty());
    let (content, stored, authorization_required) = match read_result {
        Ok(value) if !value.is_empty() => (
            if environment_name == EnvironmentName::Development {
                value
            } else {
                remote_runtime_content(&value, &BTreeSet::new(), false)
            },
            true,
            false,
        ),
        Ok(mut value) => {
            value.zeroize();
            local_content.clone().map_or_else(
                || (template_content.clone(), false, false),
                |value| (value, true, false),
            )
        }
        Err(error) if error == "missing" => local_content.clone().map_or_else(
            || (template_content.clone(), false, false),
            |value| (value, true, false),
        ),
        Err(_) if !authorize => local_content.map_or_else(
            || (template_content.clone(), false, true),
            |value| (value, true, false),
        ),
        Err(error) => return Err(error),
    };
    Ok(RuntimeConfigFile {
        filename: runtime_config_filename(&environment),
        environment,
        source_files,
        content,
        template_content,
        required_variables,
        stored,
        authorization_required,
    })
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri IPC deserializes owned arguments.
pub(super) fn load_existing_project_config(
    path: String,
    environment: String,
) -> Result<ExistingProjectConfig, String> {
    let environment = parse_deploy_environment(&environment)?;
    let root = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("项目目录无法读取：{error}"))?;
    let candidates = match environment {
        EnvironmentName::Staging => [".env", ".env.local", ".env.production", ".env.staging"],
        EnvironmentName::Production => [".env", ".env.local", ".env.staging", ".env.production"],
        EnvironmentName::Development => unreachable!("deploy environment excludes development"),
    };
    let mut source_files = Vec::new();
    let mut sections = Vec::new();
    for relative in candidates {
        let candidate = root.join(relative);
        if !candidate.is_file() {
            continue;
        }
        let metadata = fs::metadata(&candidate).map_err(public_error)?;
        if metadata.len() > 1024 * 1024 {
            return Err(format!("项目现有配置 {relative} 过大，已停止读取"));
        }
        let content = fs::read_to_string(&candidate).map_err(public_error)?;
        if content.contains('\0') {
            return Err(format!("项目现有配置 {relative} 包含无效字符"));
        }
        source_files.push(relative.to_string());
        sections.push(format!(
            "# ===== 项目已有配置：{relative} =====\n{}",
            content.trim_end_matches(['\r', '\n'])
        ));
    }
    if source_files.is_empty() {
        return Err("项目中没有可复用的 .env 配置".to_string());
    }
    Ok(ExistingProjectConfig {
        source_files,
        content: format!("{}\n", sections.join("\n\n")),
    })
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri IPC deserializes owned arguments.
pub(super) fn store_runtime_config(
    path: String,
    environment: String,
    mut content: String,
) -> Result<RuntimeConfigStatus, String> {
    if content.trim().is_empty() {
        return Err("运行配置文件不能为空".to_string());
    }
    if content.contains('\0') {
        return Err("运行配置文件包含无效字符".to_string());
    }
    let key = runtime_config_key(Path::new(&path), &environment)?;
    let result = write_keyring_secret(&key, &content);
    content.zeroize();
    result?;
    Ok(RuntimeConfigStatus {
        filename: runtime_config_filename(&environment),
        environment,
        stored: true,
    })
}

#[tauri::command]
pub(super) async fn runtime_config_sync_status(
    path: String,
    environment: String,
    server: ServerConnectionInput,
) -> Result<RuntimeConfigSyncStatus, String> {
    let environment_name = parse_deploy_environment(&environment)?;
    let root = PathBuf::from(&path);
    let manifest = load_manifest(&root.join(MANIFEST_FILE)).map_err(public_error)?;
    let runtime_file_key = runtime_config_key(&root, &environment)?;
    let mut content = match read_keyring_secret_without_prompt(&runtime_file_key) {
        Ok(value) if !value.is_empty() => value,
        Ok(mut value) => {
            value.zeroize();
            return Ok(RuntimeConfigSyncStatus {
                stored: false,
                synchronized: false,
            });
        }
        Err(error) if error == "missing" => {
            return Ok(RuntimeConfigSyncStatus {
                stored: false,
                synchronized: false,
            });
        }
        Err(error) => return Err(error),
    };
    let profile = verified_server_profile(&server).await?;
    let destination = remote_runtime_config_path(&manifest.project.name, environment_name);
    let command = format!(
        "if [ -f {destination} ]; then sha256sum {destination} | awk '{{print $1}}'; fi",
        destination = shell_quote(&destination),
    );
    let output = ssh::execute(&profile, &command, None, Duration::from_secs(20))
        .await
        .map_err(public_error)?;
    if output.exit_status != Some(0) {
        content.zeroize();
        return Ok(RuntimeConfigSyncStatus {
            stored: true,
            synchronized: false,
        });
    }
    let mut digest = Sha256::new();
    digest.update(content.as_bytes());
    let expected = format!("{:x}", digest.finalize());
    content.zeroize();
    Ok(RuntimeConfigSyncStatus {
        stored: true,
        synchronized: output.stdout.trim() == expected,
    })
}

#[tauri::command]
pub(super) async fn sync_runtime_config_to_server(
    path: String,
    environment: String,
    server: ServerConnectionInput,
) -> Result<RuntimeConfigSyncStatus, String> {
    let environment_name = parse_deploy_environment(&environment)?;
    let root = PathBuf::from(&path);
    let manifest = load_manifest(&root.join(MANIFEST_FILE)).map_err(public_error)?;
    let profile = verified_server_profile(&server).await?;
    let environment_config = manifest.environments.get(environment_name);
    let managed_dependencies =
        ensure_remote_runtime_dependencies(&root, environment_name, environment_config, &profile)
            .await?;
    let runtime_file_key = runtime_config_key(&root, &environment)?;
    let mut content = match read_keyring_secret(&runtime_file_key) {
        Ok(value) if !value.is_empty() => value,
        Ok(mut value) => {
            value.zeroize();
            return Err("请先保存运行配置".to_string());
        }
        Err(error) if error == "missing" => return Err("请先保存运行配置".to_string()),
        Err(error) => return Err(error),
    };
    let (filled, _) = fill_managed_runtime_dependencies(&content, &managed_dependencies);
    content.zeroize();
    content = filled;
    let missing = missing_runtime_variables(
        &content,
        &required_runtime_variables(&manifest, environment_name),
        environment_name,
    );
    if !missing.is_empty() {
        content.zeroize();
        return Err(format!("还有 {} 项必填配置没有值", missing.len()));
    }
    write_keyring_secret(&runtime_file_key, &content)?;
    let result =
        persist_remote_runtime_config(&profile, &manifest.project.name, environment_name, &content)
            .await;
    content.zeroize();
    result?;
    Ok(RuntimeConfigSyncStatus {
        stored: true,
        synchronized: true,
    })
}

#[tauri::command]
pub(super) async fn prepare_cnb_secret_bundle(
    path: String,
    environment: String,
    secret_repository: String,
    server: ServerConnectionInput,
) -> Result<CnbSecretBundle, String> {
    validate_repository_slug(&secret_repository)?;
    let environment_name = parse_deploy_environment(&environment)?;
    let root = PathBuf::from(&path);
    let manifest = load_manifest(&root.join(MANIFEST_FILE)).map_err(public_error)?;
    let profile = server.profile();
    let expected_fingerprint = profile
        .host_fingerprint
        .as_deref()
        .ok_or_else(|| "请先完成服务器身份验证".to_string())?;
    let host_identity = ssh::probe_host_identity(&profile)
        .await
        .map_err(public_error)?;
    if host_identity.fingerprint != expected_fingerprint {
        return Err("服务器身份指纹已变化，已停止生成持续部署配置".to_string());
    }
    let environment_config = manifest.environments.get(environment_name);
    let managed_dependencies =
        ensure_remote_runtime_dependencies(&root, environment_name, environment_config, &profile)
            .await?;
    let material = pipeline_identity(&root, false)?;
    let prefix = environment.to_ascii_uppercase();
    let host_label = if profile.port == 22 {
        profile.host.clone()
    } else {
        format!("[{}]:{}", profile.host, profile.port)
    };
    let mut values = BTreeMap::from([
        (format!("{prefix}_SERVER_HOST"), profile.host.clone()),
        (format!("{prefix}_SERVER_PORT"), profile.port.to_string()),
        (format!("{prefix}_SERVER_USER"), profile.user.clone()),
        (
            format!("{prefix}_SERVER_SSH_KEY"),
            material.private_key.to_string(),
        ),
        (
            format!("{prefix}_SERVER_KNOWN_HOSTS"),
            format!("{host_label} {}", host_identity.public_key),
        ),
    ]);
    let mut missing_variables = Vec::new();
    let required_variables = required_runtime_variables(&manifest, environment_name);
    let runtime_file_key = runtime_config_key(&root, &environment)?;
    let has_runtime_file = match read_keyring_secret(&runtime_file_key) {
        Ok(value) if !value.is_empty() => {
            let (value, _) = fill_managed_runtime_dependencies(&value, &managed_dependencies);
            write_keyring_secret(&runtime_file_key, &value)?;
            missing_variables.extend(missing_runtime_variables(
                &value,
                &required_variables,
                environment_name,
            ));
            values.insert(format!("{prefix}_RUNTIME_ENV_FILE"), value);
            true
        }
        Ok(mut value) => {
            value.zeroize();
            false
        }
        Err(error) if error == "missing" => false,
        Err(error) => return Err(error),
    };
    if !has_runtime_file {
        // Compatibility for projects configured before whole-file runtime settings.
        let mut variables = BTreeMap::new();
        for variable in manifest
            .services
            .iter()
            .flat_map(|service| &service.runtime_env)
        {
            variables
                .entry(variable.name.clone())
                .or_insert_with(|| variable.default.clone());
        }
        if environment_config.database.is_some() {
            variables.entry("DATABASE_URL".to_string()).or_insert(None);
        }
        if environment_config.redis_namespace.is_some() {
            variables.entry("REDIS_URL".to_string()).or_insert(None);
        }
        for (variable, default) in variables {
            let key = runtime_secret_key(&root, &environment, &variable)?;
            let value = match read_keyring_secret(&key) {
                Ok(value) if !value.is_empty() => Some(value),
                Ok(mut value) => {
                    value.zeroize();
                    None
                }
                Err(error) if error == "missing" => default,
                Err(error) => return Err(error),
            };
            let value = value.and_then(|value| {
                managed_dependencies
                    .get(&variable)
                    .filter(|_| remote_runtime_value_invalid(&value))
                    .cloned()
                    .or(Some(value))
            });
            let value = value.or_else(|| managed_dependencies.get(&variable).cloned());
            if let Some(value) = value {
                values.insert(format!("{prefix}_{variable}"), value);
            } else {
                values.insert(format!("{prefix}_{variable}"), String::new());
                missing_variables.push(variable);
            }
        }
    }
    if !matches!(manifest.providers.registry, RegistryConfig::Cnb { .. }) {
        let provider = RegistryProvider::new(&manifest.providers.registry);
        let (username, password) = provider.credential_names();
        let key_prefix = if matches!(manifest.providers.registry, RegistryConfig::Tcr { .. }) {
            TCR_SECRET_PREFIX
        } else {
            "registry.oci"
        };
        for (field, key) in [
            (username, format!("{key_prefix}.username")),
            (password, format!("{key_prefix}.password")),
        ] {
            match read_keyring_secret(&key) {
                Ok(value) if !value.is_empty() => {
                    values.insert(field.to_string(), value);
                }
                Ok(mut value) => {
                    value.zeroize();
                    missing_variables.push(field.to_string());
                }
                Err(error) if error == "missing" => {
                    missing_variables.push(field.to_string());
                }
                Err(error) => return Err(error),
            }
        }
    }
    missing_variables.sort();
    missing_variables.dedup();
    if missing_variables.is_empty()
        && let Some(runtime_content) = values.get(&format!("{prefix}_RUNTIME_ENV_FILE"))
    {
        persist_remote_runtime_config(
            &profile,
            &manifest.project.name,
            environment_name,
            runtime_content,
        )
        .await?;
    }
    let mut content = serde_yaml_ng::to_string(&values).map_err(public_error)?;
    content.insert_str(
        0,
        "# 由 ABCDeploy 在本机生成，仅粘贴到 CNB 密钥仓库 Web 编辑器。\n",
    );
    // A single CNB Secret repository can safely serve multiple projects as long
    // as each generated file has a project-scoped name. Existing manifests keep
    // their old references; only newly generated bundles use this convention.
    let filename = cnb_secret_filename(&manifest.project.name, &environment);
    Ok(CnbSecretBundle {
        environment,
        file_url: format!("https://cnb.cool/{secret_repository}/-/blob/main/{filename}"),
        filename,
        content,
        missing_variables,
        deploy_key_fingerprint: material.fingerprint,
    })
}

pub(super) async fn persist_remote_runtime_config(
    profile: &ssh::SshProfile,
    project: &str,
    environment: EnvironmentName,
    content: &str,
) -> Result<(), String> {
    if content.trim().is_empty() || content.contains('\0') {
        return Err("远程运行配置内容无效，已停止同步".to_string());
    }
    let directory = format!(".deploydesk/runtime-config/{project}");
    let destination = remote_runtime_config_path(project, environment);
    let temporary = format!("{destination}.next");
    let command = format!(
        "set -eu\numask 077\ninstall -d -m 700 {directory}\ncat > {temporary}\nchmod 600 {temporary}\nmv {temporary} {destination}",
        directory = shell_quote(&directory),
        temporary = shell_quote(&temporary),
        destination = shell_quote(&destination),
    );
    ssh::execute(
        profile,
        &command,
        Some(content.as_bytes()),
        Duration::from_secs(30),
    )
    .await
    .map_err(public_error)?;
    Ok(())
}

pub(super) fn remote_runtime_config_path(project: &str, environment: EnvironmentName) -> String {
    format!(
        ".deploydesk/runtime-config/{project}/{}.env",
        environment.as_str()
    )
}

pub(super) async fn verified_server_profile(
    server: &ServerConnectionInput,
) -> Result<ssh::SshProfile, String> {
    let profile = server.profile();
    let expected_fingerprint = profile
        .host_fingerprint
        .as_deref()
        .ok_or_else(|| "请先完成服务器身份验证".to_string())?;
    let host_identity = ssh::probe_host_identity(&profile)
        .await
        .map_err(public_error)?;
    if host_identity.fingerprint != expected_fingerprint {
        return Err("服务器身份指纹已变化，已停止同步运行配置".to_string());
    }
    Ok(profile)
}

pub(super) async fn ensure_remote_runtime_dependencies(
    root: &Path,
    environment: EnvironmentName,
    config: &EnvironmentConfig,
    profile: &ssh::SshProfile,
) -> Result<BTreeMap<String, String>, String> {
    ensure_remote_runtime_dependencies_scoped(root, environment.as_str(), config, profile).await
}

pub(super) async fn ensure_remote_runtime_dependencies_scoped(
    root: &Path,
    scope: &str,
    config: &EnvironmentConfig,
    profile: &ssh::SshProfile,
) -> Result<BTreeMap<String, String>, String> {
    let needs_postgres = config.database.is_some();
    let needs_redis = config.redis_namespace.is_some();
    if !needs_postgres && !needs_redis {
        return Ok(BTreeMap::new());
    }

    let (database_name, database_user) = config.database.as_ref().map_or_else(
        || (String::new(), String::new()),
        |database| (database.name.clone(), database.user.clone()),
    );
    for value in [&database_name, &database_user] {
        if !value.is_empty() && !safe_postgres_identifier(value) {
            return Err("AD-INF-201：项目声明的远程数据库名称不安全，已停止准备".to_string());
        }
    }

    let mut database_password = needs_postgres
        .then(|| {
            local_infrastructure_secret(&format!(
                "remote.database.{}.{}",
                &project_storage_id(root)[..24],
                scope
            ))
        })
        .transpose()?;
    let server_id = remote_server_id(profile);
    let mut postgres_admin_password =
        local_infrastructure_secret(&format!("remote.infrastructure.{server_id}.postgres"))?;
    let mut redis_password =
        local_infrastructure_secret(&format!("remote.infrastructure.{server_id}.redis"))?;

    let substitutions = [
        ("__NETWORK__", REMOTE_INFRA_NETWORK.to_string()),
        (
            "__POSTGRES_FLAG__",
            if needs_postgres { "1" } else { "0" }.to_string(),
        ),
        (
            "__REDIS_FLAG__",
            if needs_redis { "1" } else { "0" }.to_string(),
        ),
        ("__DB_NAME__", BASE64.encode(database_name.as_bytes())),
        ("__DB_USER__", BASE64.encode(database_user.as_bytes())),
        (
            "__DB_PASSWORD__",
            BASE64.encode(
                database_password
                    .as_ref()
                    .map_or(&[][..], |value| value.as_bytes()),
            ),
        ),
        (
            "__POSTGRES_ADMIN_PASSWORD__",
            BASE64.encode(postgres_admin_password.as_bytes()),
        ),
        (
            "__REDIS_PASSWORD__",
            BASE64.encode(redis_password.as_bytes()),
        ),
    ];
    let mut script = REMOTE_DEPENDENCY_SCRIPT.to_string();
    for (placeholder, value) in substitutions {
        script = script.replace(placeholder, &value);
    }
    let output = ssh::execute(
        profile,
        "sh -s",
        Some(script.as_bytes()),
        Duration::from_mins(12),
    )
    .await
    .map_err(public_error)?;
    script.zeroize();
    postgres_admin_password.zeroize();
    redis_password.zeroize();
    if output.exit_status != Some(0) {
        database_password.iter_mut().for_each(Zeroize::zeroize);
        let message = redact_text(&output.stderr);
        return Err(remote_dependency_error(&message));
    }
    let fields = output
        .stdout
        .lines()
        .filter_map(|line| line.split_once('='))
        .collect::<BTreeMap<_, _>>();
    let mut values = BTreeMap::new();
    if needs_postgres {
        let host = fields
            .get("POSTGRES_HOST")
            .copied()
            .filter(|value| valid_remote_container_name(value))
            .ok_or_else(|| "AD-INF-202：服务器没有返回可用的 PostgreSQL 地址".to_string())?;
        let password = database_password
            .as_deref()
            .ok_or_else(|| "AD-INF-202：无法读取环境数据库凭据".to_string())?;
        values.insert(
            "DATABASE_URL".to_string(),
            format!(
                "postgresql://{}:{}@{}:5432/{}",
                database_user,
                url_encode_userinfo(password),
                host,
                database_name
            ),
        );
        values.insert("POSTGRES_DB".to_string(), database_name.clone());
        values.insert("POSTGRES_USER".to_string(), database_user.clone());
        values.insert("POSTGRES_PASSWORD".to_string(), password.clone());
    }
    if needs_redis {
        let host = fields
            .get("REDIS_HOST")
            .copied()
            .filter(|value| valid_remote_container_name(value))
            .ok_or_else(|| "AD-INF-202：服务器没有返回可用的 Redis 地址".to_string())?;
        let encoded_password = fields
            .get("REDIS_PASSWORD_B64")
            .copied()
            .unwrap_or_default();
        let mut password = BASE64
            .decode(encoded_password)
            .map_err(|_| "AD-INF-202：服务器返回的 Redis 凭据格式无效".to_string())?;
        let database = remote_redis_database_for_scope(root, scope);
        let url = if password.is_empty() {
            format!("redis://{host}:6379/{database}")
        } else {
            let password_text = std::str::from_utf8(&password)
                .map_err(|_| "AD-INF-202：服务器返回的 Redis 凭据无法读取".to_string())?;
            format!(
                "redis://:{}@{host}:6379/{database}",
                url_encode_userinfo(password_text)
            )
        };
        password.zeroize();
        values.insert("REDIS_URL".to_string(), url);
    }
    database_password.iter_mut().for_each(Zeroize::zeroize);
    Ok(values)
}

pub(super) const REMOTE_DEPENDENCY_SCRIPT: &str = r#"set -eu
NETWORK='__NETWORK__'
NEEDS_POSTGRES='__POSTGRES_FLAG__'
NEEDS_REDIS='__REDIS_FLAG__'
mkdir -p "$HOME/.deploydesk/locks"
exec 8>"$HOME/.deploydesk/locks/runtime-dependencies.lock"
flock -w 900 8 || { echo 'AD-INF-202：服务器正在准备另一组运行依赖，请稍后继续' >&2; exit 75; }
decode() { printf '%s' "$1" | base64 -d; }
pull_with_timeout() {
  candidate="$1"
  if command -v timeout >/dev/null 2>&1; then
    timeout 150 docker pull "$candidate" >/dev/null 2>&1
  else
    docker pull "$candidate" >/dev/null 2>&1
  fi
}
resolve_runtime_image() {
  component="$1"
  digest="$2"
  local_image="$3"
  shift 3
  if docker image inspect "$local_image" >/dev/null 2>&1; then
    RESOLVED_IMAGE="$local_image"
    return 0
  fi
  for repository in "$@"; do
    candidate="$repository@$digest"
    if pull_with_timeout "$candidate"; then
      docker tag "$candidate" "$local_image"
      RESOLVED_IMAGE="$local_image"
      return 0
    fi
  done
  echo "AD-INF-202：服务器暂时无法下载${component}运行组件；系统已尝试国内来源" >&2
  return 1
}
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

if [ "$NEEDS_POSTGRES" = 1 ]; then
  POSTGRES_CONTAINER=''
  for candidate in abcdeploy-postgres infra-postgres; do
    if docker inspect "$candidate" >/dev/null 2>&1; then POSTGRES_CONTAINER="$candidate"; break; fi
  done
  if [ -z "$POSTGRES_CONTAINER" ]; then
    POSTGRES_ADMIN_PASSWORD="$(decode '__POSTGRES_ADMIN_PASSWORD__')"
    POSTGRES_DIGEST='sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'
    POSTGRES_LOCAL_IMAGE='abcdeploy/runtime-postgres:16-57c72fd2a128e416'
    resolve_runtime_image '数据库' "$POSTGRES_DIGEST" "$POSTGRES_LOCAL_IMAGE" \
      'mirror.ccs.tencentyun.com/library/postgres' \
      'm.daocloud.io/docker.io/library/postgres' \
      'postgres' || exit 1
    POSTGRES_IMAGE="$RESOLVED_IMAGE"
    docker volume create abcdeploy-postgres-data >/dev/null
    if ! docker run -d --name abcdeploy-postgres --restart unless-stopped \
      --network "$NETWORK" -e POSTGRES_PASSWORD="$POSTGRES_ADMIN_PASSWORD" \
      -v abcdeploy-postgres-data:/var/lib/postgresql/data "$POSTGRES_IMAGE" >/dev/null; then
      echo 'AD-INF-203：服务器数据库没有完成启动' >&2
      exit 1
    fi
    POSTGRES_CONTAINER=abcdeploy-postgres
  fi
  docker start "$POSTGRES_CONTAINER" >/dev/null 2>&1 || { echo 'AD-INF-203：服务器数据库无法重新启动' >&2; exit 1; }
  docker network connect "$NETWORK" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  if ! docker network inspect "$NETWORK" --format '{{range .Containers}}{{println .Name}}{{end}}' | grep -Fx -- "$POSTGRES_CONTAINER" >/dev/null; then
    echo 'AD-INF-203：服务器数据库无法连接项目运行网络' >&2
    exit 1
  fi
  ready=0
  for _ in $(seq 1 45); do
    if docker exec -u postgres "$POSTGRES_CONTAINER" pg_isready -d postgres >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" = 1 ] || { echo 'AD-INF-203：PostgreSQL 启动后未能就绪' >&2; exit 1; }
  DB_NAME="$(decode '__DB_NAME__')"
  DB_USER="$(decode '__DB_USER__')"
  DB_PASSWORD="$(decode '__DB_PASSWORD__')"
  docker exec -i -u postgres "$POSTGRES_CONTAINER" psql -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$abcdeploy\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '$DB_USER', '$DB_PASSWORD');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '$DB_USER', '$DB_PASSWORD');
  END IF;
END
\$abcdeploy\$;
SELECT format('CREATE DATABASE %I OWNER %I', '$DB_NAME', '$DB_USER')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', '$DB_NAME', '$DB_USER') \gexec
SQL
  printf 'POSTGRES_HOST=%s\n' "$POSTGRES_CONTAINER"
fi

if [ "$NEEDS_REDIS" = 1 ]; then
  REDIS_PASSWORD="$(decode '__REDIS_PASSWORD__')"
  REDIS_CONTAINER=''
  for candidate in abcdeploy-redis infra-redis; do
    if docker inspect "$candidate" >/dev/null 2>&1; then REDIS_CONTAINER="$candidate"; break; fi
  done
  if [ -z "$REDIS_CONTAINER" ]; then
    REDIS_DIGEST='sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99'
    REDIS_LOCAL_IMAGE='abcdeploy/runtime-redis:7-6ab0b6e738177933'
    resolve_runtime_image '缓存' "$REDIS_DIGEST" "$REDIS_LOCAL_IMAGE" \
      'mirror.ccs.tencentyun.com/library/redis' \
      'm.daocloud.io/docker.io/library/redis' \
      'redis' || exit 1
    REDIS_IMAGE="$RESOLVED_IMAGE"
    docker volume create abcdeploy-redis-data >/dev/null
    if ! docker run -d --name abcdeploy-redis --restart unless-stopped --network "$NETWORK" \
      -v abcdeploy-redis-data:/data "$REDIS_IMAGE" \
      redis-server --appendonly yes --requirepass "$REDIS_PASSWORD" >/dev/null; then
      echo 'AD-INF-204：服务器缓存服务没有完成启动' >&2
      exit 1
    fi
    REDIS_CONTAINER=abcdeploy-redis
  fi
  docker start "$REDIS_CONTAINER" >/dev/null 2>&1 || { echo 'AD-INF-204：服务器缓存服务无法重新启动' >&2; exit 1; }
  docker network connect "$NETWORK" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  if ! docker network inspect "$NETWORK" --format '{{range .Containers}}{{println .Name}}{{end}}' | grep -Fx -- "$REDIS_CONTAINER" >/dev/null; then
    echo 'AD-INF-204：服务器缓存服务无法连接项目运行网络' >&2
    exit 1
  fi
  ready=0
  for _ in $(seq 1 30); do
    if [ -n "$REDIS_PASSWORD" ]; then
      docker exec "$REDIS_CONTAINER" redis-cli -a "$REDIS_PASSWORD" ping >/dev/null 2>&1 && ready=1 && break
    else
      docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1 && ready=1 && break
    fi
    sleep 1
  done
  [ "$ready" = 1 ] || { echo 'AD-INF-204：Redis 已存在但认证方式无法自动识别' >&2; exit 1; }
  printf 'REDIS_HOST=%s\n' "$REDIS_CONTAINER"
  printf 'REDIS_PASSWORD_B64=%s\n' "$(printf '%s' "$REDIS_PASSWORD" | base64 | tr -d '\n')"
fi
"#;

pub(super) fn remote_dependency_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with("AD-") && (line.contains('：') || line.contains(':')))
        .or_else(|| {
            stderr
                .lines()
                .rev()
                .map(str::trim)
                .find(|line| !line.is_empty())
        })
        .unwrap_or("AD-INF-202：服务器运行依赖准备失败")
        .to_string()
}

pub(super) fn safe_postgres_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && value.as_bytes()[0].is_ascii_lowercase()
}

pub(super) fn valid_remote_container_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

pub(super) fn remote_server_id(profile: &ssh::SshProfile) -> String {
    let mut digest = Sha256::new();
    digest.update(profile.host.as_bytes());
    digest.update(profile.port.to_be_bytes());
    let digest = format!("{:x}", digest.finalize());
    digest[..24].to_string()
}

pub(super) fn remote_redis_database_for_scope(root: &Path, scope: &str) -> u8 {
    let mut digest = Sha256::new();
    digest.update(project_storage_id(root).as_bytes());
    digest.update(scope.as_bytes());
    let bytes = digest.finalize();
    (bytes[0] % 15) + 1
}

pub(super) fn url_encode_userinfo(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            write!(&mut encoded, "%{byte:02X}").expect("writing to a String is infallible");
        }
    }
    encoded
}

pub(super) fn ensure_runtime_template_variables(
    mut content: String,
    required: &[String],
) -> String {
    let existing = content
        .lines()
        .filter_map(|line| {
            let left = line.split_once('=')?.0;
            let key = left
                .trim()
                .strip_prefix("export ")
                .unwrap_or_else(|| left.trim())
                .trim();
            valid_environment_variable(key).then(|| key.to_string())
        })
        .collect::<BTreeSet<_>>();
    let missing = required
        .iter()
        .filter(|variable| !existing.contains(*variable))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return content;
    }
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    if !content.is_empty() {
        content.push_str("\n# ABCDeploy 检测到的必要配置\n");
    }
    for variable in missing {
        writeln!(&mut content, "{variable}=").expect("writing to a String is infallible");
    }
    content
}

pub(super) fn runtime_defaults(
    content: &str,
    secret_variables: &BTreeSet<String>,
) -> BTreeMap<String, String> {
    content
        .lines()
        .filter_map(|line| {
            let (left, raw_value) = line.split_once('=')?;
            let key = left
                .trim()
                .strip_prefix("export ")
                .unwrap_or_else(|| left.trim())
                .trim();
            let value = raw_value.trim().trim_matches(['\'', '"']);
            if !valid_environment_variable(key)
                || secret_variables.contains(key)
                || value.is_empty()
                || remote_runtime_value_invalid(raw_value)
            {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

pub(super) fn postgres_runtime_url(value: &str) -> bool {
    let value = value.trim().trim_matches(['\'', '"']);
    value.starts_with("postgresql://") || value.starts_with("postgres://")
}

pub(super) fn fill_managed_runtime_dependencies(
    content: &str,
    suggestions: &BTreeMap<String, String>,
) -> (String, Vec<String>) {
    let mut filled = Vec::new();
    let mut seen_suggestions = BTreeSet::new();
    let mut output = content
        .lines()
        .map(|line| {
            let Some((left, raw_value)) = line.split_once('=') else {
                return line.to_string();
            };
            let key = left
                .trim()
                .strip_prefix("export ")
                .unwrap_or_else(|| left.trim())
                .trim();
            let Some(suggestion) = suggestions.get(key) else {
                return line.to_string();
            };
            seen_suggestions.insert(key.to_string());
            let value = raw_value.trim().trim_matches(['\'', '"']);
            let wrong_managed_protocol = key == "DATABASE_URL"
                && postgres_runtime_url(suggestion)
                && !postgres_runtime_url(value);
            if !value.is_empty()
                && !remote_runtime_value_invalid(raw_value)
                && !wrong_managed_protocol
            {
                return line.to_string();
            }
            filled.push(key.to_string());
            format!("{left}={}", dotenv_value(suggestion))
        })
        .collect::<Vec<_>>()
        .join("\n");
    for (key, suggestion) in suggestions {
        if seen_suggestions.contains(key) {
            continue;
        }
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        writeln!(&mut output, "{key}={}", dotenv_value(suggestion))
            .expect("writing to a String is infallible");
        filled.push(key.clone());
    }
    if content.ends_with('\n') && !output.ends_with('\n') {
        output.push('\n');
    }
    (output, filled)
}

pub(super) fn replace_managed_runtime_dependencies(
    content: &str,
    suggestions: &BTreeMap<String, String>,
    managed_keys: &BTreeSet<String>,
) -> (String, Vec<String>) {
    let mut replaced = Vec::new();
    let mut seen = BTreeSet::new();
    let mut output = content
        .lines()
        .map(|line| {
            let Some((left, _)) = line.split_once('=') else {
                return line.to_string();
            };
            let key = left
                .trim()
                .strip_prefix("export ")
                .unwrap_or_else(|| left.trim())
                .trim();
            if !managed_keys.contains(key) {
                return line.to_string();
            }
            let Some(suggestion) = suggestions.get(key) else {
                return line.to_string();
            };
            seen.insert(key.to_string());
            replaced.push(key.to_string());
            format!("{left}={}", dotenv_value(suggestion))
        })
        .collect::<Vec<_>>()
        .join("\n");
    for key in managed_keys {
        if seen.contains(key) {
            continue;
        }
        let Some(suggestion) = suggestions.get(key) else {
            continue;
        };
        if !output.is_empty() && !output.ends_with('\n') {
            output.push('\n');
        }
        writeln!(&mut output, "{key}={}", dotenv_value(suggestion))
            .expect("writing to a String is infallible");
        replaced.push(key.clone());
    }
    if content.ends_with('\n') && !output.ends_with('\n') {
        output.push('\n');
    }
    (output, replaced)
}

#[tauri::command]
pub(super) async fn rollback_environment(
    path: String,
    environment: String,
    server: ServerConnectionInput,
    confirmed: bool,
    state: State<'_, WorkspaceState>,
) -> Result<DeploymentRun, String> {
    if !confirmed {
        return Err("回滚前必须明确确认目标环境".to_string());
    }
    parse_deploy_environment(&environment)?;
    let root = PathBuf::from(&path);
    let manifest = load_manifest(&root.join(MANIFEST_FILE)).map_err(public_error)?;
    let rollback_source = if environment == "production" {
        Some(
            state
                .production_rollback_source_run(&root)?
                .ok_or_else(|| {
                    "本机没有可核对的上一生产版本，已停止回滚以免切换到未知镜像".to_string()
                })?,
        )
    } else {
        None
    };
    let mut run = state.create_deployment_run(
        &root,
        &manifest.project.name,
        &environment,
        &manifest.providers.build.repository,
        &manifest.source.release_branch,
    )?;
    if let Some(source) = &rollback_source {
        run.commit_sha.clone_from(&source.commit_sha);
        run.source_title.clone_from(&source.source_title);
        run.source_run_id = Some(source.id.clone());
        run.candidate_tag.clone_from(&source.candidate_tag);
    }
    run.status = "running".to_string();
    run.current_stage = "rollback".to_string();
    run.message = format!(
        "正在把{}恢复到上一健康版本",
        if environment == "production" {
            "生产环境"
        } else {
            "测试环境"
        }
    );
    run.completed_steps.clear();
    state.save_deployment_run(&run)?;

    let script = rollback_script(&manifest.project.name, &environment);
    let profile = server.profile();
    match ssh::execute(
        &profile,
        "sh -s",
        Some(script.as_bytes()),
        Duration::from_mins(5),
    )
    .await
    {
        Ok(output) if output.exit_status == Some(0) => {
            let release = output
                .stdout
                .lines()
                .find_map(|line| line.strip_prefix("ROLLED_BACK_TO="))
                .unwrap_or("上一健康版本");
            run.status = "success".to_string();
            run.current_stage = "complete".to_string();
            run.message = format!("已安全回滚到 {release}");
            run.completed_steps = vec!["rollback".to_string(), "healthcheck".to_string()];
            if environment == "production" {
                finalize_successful_deployment(&mut run, &state).await;
                if run.status == "success" {
                    run.message = format!("已安全回滚到 {release}，并核对为历史测试通过版本");
                }
            }
        }
        Ok(output) => {
            run.status = "failed".to_string();
            run.message = redact_text(&output.stderr)
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("回滚未完成，已尝试恢复回滚前版本")
                .to_string();
        }
        Err(error) => {
            run.status = "failed".to_string();
            run.message = public_error(error);
        }
    }
    run.updated_at = Utc::now().to_rfc3339();
    state.save_deployment_run(&run)?;
    Ok(run)
}

pub(super) fn rollback_script(project_name: &str, environment: &str) -> String {
    let remote_directory = format!("$HOME/.deploydesk/apps/{project_name}/{environment}");
    format!(
        r#"set -eu
cd "{remote_directory}"
test -f docker-compose.yml
test -f .runtime.env
test -f .release.env
current_release="$(sed -n 's/^DEPLOYDESK_RELEASE_ID=//p' .release.env | head -n 1)"
previous_file=""
for candidate in $(ls -1t .history/*.env 2>/dev/null || true); do
  candidate_release="$(basename "$candidate" .env)"
  if [ "$candidate_release" != "$current_release" ]; then
    previous_file="$candidate"
    break
  fi
done
test -n "$previous_file" || {{ echo '没有可回滚的上一健康版本' >&2; exit 2; }}
cp .release.env .release.env.before-rollback
cp "$previous_file" .release.env
chmod 600 .release.env
compose='docker compose --env-file .release.env -f docker-compose.yml'
if $compose config --quiet && $compose pull && $compose up -d --remove-orphans --wait --wait-timeout 180; then
  rolled_back_to="$(basename "$previous_file" .env)"
  printf 'ROLLED_BACK_TO=%s\n' "$rolled_back_to"
else
  rollback_status=$?
  cp .release.env.before-rollback .release.env
  $compose pull || true
  $compose up -d --remove-orphans --wait --wait-timeout 180 || true
  exit "$rollback_status"
fi
"#
    )
}
