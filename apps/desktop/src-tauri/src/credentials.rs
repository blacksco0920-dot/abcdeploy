use super::*;

pub(super) fn registry_check(
    ok: bool,
    summary: &str,
    code: Option<&str>,
    next_steps: Vec<String>,
    retryable: bool,
) -> ProviderCheck {
    ProviderCheck {
        provider: "registry".to_string(),
        ok,
        summary: summary.to_string(),
        details: Vec::new(),
        code: code.map(ToString::to_string),
        next_steps,
        retryable,
    }
}

pub(super) fn valid_registry_host(value: &str) -> bool {
    let value = value.trim();
    value.len() <= 253
        && value.split('.').count() >= 2
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment.len() <= 63
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                && segment
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && segment
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
        })
}

pub(super) fn valid_registry_namespace(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 100
        && value == value.to_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
}

pub(super) fn check_registry_login(
    registry: &str,
    username: &str,
    password: &str,
) -> Result<ProviderCheck, String> {
    let registry = registry.trim();
    let username = username.trim();
    if !valid_registry_host(registry) {
        return Err("AD-REG-101：项目版本保存位置地址格式不正确".to_string());
    }
    if username.is_empty() || password.is_empty() {
        return Ok(registry_check(
            false,
            "登录信息还没有填写完整",
            Some("AD-REG-102"),
            vec!["填写登录用户名和访问密码后重新验证".to_string()],
            false,
        ));
    }

    // Docker login normally writes into ~/.docker/config.json. Use an isolated
    // one-shot config directory so credential validation never changes the
    // user's existing Docker login state. The password is sent only on stdin.
    let check_directory = std::env::temp_dir().join(format!(
        "abcdeploy-registry-check-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::create_dir_all(&check_directory).map_err(public_error)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if let Err(error) = fs::set_permissions(&check_directory, fs::Permissions::from_mode(0o700))
        {
            let _ = fs::remove_dir_all(&check_directory);
            return Err(public_error(error));
        }
    }
    let mut command = system_command("docker");
    command
        .args(["--config"])
        .arg(&check_directory)
        .args([
            "login",
            registry,
            "--username",
            username,
            "--password-stdin",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let Ok(mut child) = command.spawn() else {
        let _ = fs::remove_dir_all(&check_directory);
        return Ok(registry_check(
            false,
            "本机暂时无法验证镜像仓库",
            Some("AD-REG-103"),
            vec!["确认 Docker Desktop 已安装，然后重新验证".to_string()],
            true,
        ));
    };
    let write_result = match child.stdin.take() {
        Some(mut stdin) => stdin
            .write_all(password.as_bytes())
            .and_then(|()| stdin.write_all(b"\n")),
        None => Err(std::io::Error::other("无法安全提交镜像仓库密码")),
    };
    if let Err(error) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_dir_all(&check_directory);
        return Err(public_error(error));
    }

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < Duration::from_secs(20) => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_dir_all(&check_directory);
                return Err(public_error(error));
            }
        }
    };
    let _ = fs::remove_dir_all(&check_directory);
    match status {
        Some(status) if status.success() => Ok(registry_check(
            true,
            "镜像仓库登录信息可用",
            None,
            Vec::new(),
            false,
        )),
        Some(_) => Ok(registry_check(
            false,
            "镜像仓库没有接受这组登录信息",
            Some("AD-REG-102"),
            vec!["重新获取登录用户名和访问密码后再试".to_string()],
            false,
        )),
        None => Ok(registry_check(
            false,
            "连接镜像仓库超时",
            Some("AD-REG-103"),
            vec!["检查本机网络后重新验证".to_string()],
            true,
        )),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct RegistryBearerChallenge {
    realm: String,
    service: Option<String>,
}

fn registry_bearer_challenge(value: &str) -> Option<RegistryBearerChallenge> {
    let (scheme, parameters) = value.trim().split_once(char::is_whitespace)?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    let mut realm = None;
    let mut service = None;
    let mut quoted = false;
    let mut parameter_start = 0;
    let mut parsed_parameters = Vec::new();
    for (index, character) in parameters.char_indices() {
        match character {
            '"' => quoted = !quoted,
            ',' if !quoted => {
                parsed_parameters.push(&parameters[parameter_start..index]);
                parameter_start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    parsed_parameters.push(&parameters[parameter_start..]);

    for parameter in parsed_parameters {
        let Some((key, value)) = parameter.trim().split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        if key.trim().eq_ignore_ascii_case("realm") && !value.is_empty() {
            realm = Some(value);
        } else if key.trim().eq_ignore_ascii_case("service") && !value.is_empty() {
            service = Some(value);
        }
    }
    Some(RegistryBearerChallenge {
        realm: realm?,
        service,
    })
}

fn registry_write_denied(namespace: &str) -> ProviderCheck {
    registry_check(
        false,
        &format!("当前登录信息不能向 {namespace} 命名空间保存运行版本"),
        Some("AD-REG-201"),
        vec![
            "确认命名空间填写正确，并使用拥有推送权限的用户名和访问密码".to_string(),
            "如果命名空间还不存在，请先在腾讯云 TCR 创建后重新验证".to_string(),
        ],
        false,
    )
}

async fn check_registry_write_access(
    registry: &str,
    namespace: &str,
    username: &str,
    password: &str,
) -> Result<ProviderCheck, String> {
    let namespace = namespace.trim();
    if !valid_registry_namespace(namespace) {
        return Err("AD-REG-101：版本仓库命名空间格式不正确".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(public_error)?;
    let repository = format!("{namespace}/abcdeploy-permission-check");
    let upload_url = format!("https://{registry}/v2/{repository}/blobs/uploads/");
    let probe = client
        .post(&upload_url)
        .send()
        .await
        .map_err(|_| "暂时无法连接版本仓库，请检查网络后重新验证".to_string())?;
    if probe.status() == reqwest::StatusCode::ACCEPTED {
        cleanup_registry_upload(&client, registry, &probe, None).await;
        return Ok(registry_check(
            true,
            "版本仓库登录信息和命名空间写入权限可用",
            None,
            Vec::new(),
            false,
        ));
    }
    let Some(challenge) = probe
        .headers()
        .get(reqwest::header::WWW_AUTHENTICATE)
        .and_then(|value| value.to_str().ok())
        .and_then(registry_bearer_challenge)
    else {
        return if matches!(
            probe.status(),
            reqwest::StatusCode::UNAUTHORIZED
                | reqwest::StatusCode::FORBIDDEN
                | reqwest::StatusCode::NOT_FOUND
        ) {
            Ok(registry_write_denied(namespace))
        } else {
            Ok(registry_check(
                false,
                "版本仓库暂时无法验证目标命名空间",
                Some("AD-REG-103"),
                vec!["检查网络和版本仓库地址后重新验证".to_string()],
                true,
            ))
        };
    };

    let mut token_url = url::Url::parse(&challenge.realm)
        .map_err(|_| "版本仓库返回了无法识别的授权地址".to_string())?;
    token_url
        .query_pairs_mut()
        .append_pair("scope", &format!("repository:{repository}:pull,push"));
    if let Some(service) = challenge.service {
        token_url.query_pairs_mut().append_pair("service", &service);
    }
    let token_response = client
        .get(token_url)
        .basic_auth(username, Some(password))
        .send()
        .await
        .map_err(|_| "暂时无法验证版本仓库授权，请检查网络后重试".to_string())?;
    if !token_response.status().is_success() {
        return Ok(registry_write_denied(namespace));
    }
    let token_payload = token_response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "版本仓库返回了无法识别的授权结果".to_string())?;
    let Some(token) = token_payload
        .get("token")
        .or_else(|| token_payload.get("access_token"))
        .and_then(serde_json::Value::as_str)
    else {
        return Ok(registry_write_denied(namespace));
    };
    let upload = client
        .post(&upload_url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "验证版本仓库写入权限时连接中断，请重新验证".to_string())?;
    if upload.status() != reqwest::StatusCode::ACCEPTED {
        return Ok(registry_write_denied(namespace));
    }
    cleanup_registry_upload(&client, registry, &upload, Some(token)).await;
    Ok(registry_check(
        true,
        "版本仓库登录信息和命名空间写入权限可用",
        None,
        Vec::new(),
        false,
    ))
}

async fn cleanup_registry_upload(
    client: &reqwest::Client,
    registry: &str,
    response: &reqwest::Response,
    bearer_token: Option<&str>,
) {
    let Some(location) = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
    else {
        return;
    };
    let cleanup_url = if location.starts_with("http://") || location.starts_with("https://") {
        location.to_string()
    } else {
        format!("https://{registry}{location}")
    };
    let request = client.delete(cleanup_url);
    let request = if let Some(token) = bearer_token {
        request.bearer_auth(token)
    } else {
        request
    };
    // Upload cleanup is best-effort. Some registries accept the permission
    // probe immediately but keep DELETE requests open for a long time. That
    // must not delay a successful credential check in the user flow.
    let _ = request.timeout(Duration::from_secs(2)).send().await;
}

pub(super) fn optional_keyring_secret(key: &str) -> Result<Option<Zeroizing<String>>, String> {
    match read_keyring_secret(key) {
        Ok(value) => Ok(Some(Zeroizing::new(value))),
        Err(error) if error == "missing" => Ok(None),
        Err(error) => Err(error),
    }
}

pub(super) fn restore_keyring_secret(
    key: &str,
    value: Option<&Zeroizing<String>>,
) -> Result<(), String> {
    if let Some(value) = value {
        write_keyring_secret(key, value.as_str())
    } else {
        match delete_keyring_secret(key) {
            Ok(()) => Ok(()),
            Err(error) if error == "missing" => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[tauri::command]
pub(super) async fn replace_registry_credentials(
    registry: String,
    secret_prefix: String,
    username: String,
    password: String,
    namespace: Option<String>,
    state: State<'_, WorkspaceState>,
) -> Result<ProviderCheck, String> {
    if !matches!(secret_prefix.as_str(), TCR_SECRET_PREFIX | "registry.oci") {
        return Err("镜像仓库凭据类型不正确".to_string());
    }
    let registry_for_connection = registry.clone();
    let is_tcr = secret_prefix == TCR_SECRET_PREFIX;
    let namespace = namespace
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if is_tcr && namespace.is_none() {
        return Err("请先填写版本仓库命名空间".to_string());
    }
    let login_registry = registry.clone();
    let login_username = username.clone();
    let login_password = password.clone();
    let login = tauri::async_runtime::spawn_blocking(move || {
        let password = Zeroizing::new(login_password);
        check_registry_login(&login_registry, &login_username, password.as_str())
    })
    .await
    .map_err(public_error)??;
    if !login.ok {
        return Ok(login);
    }
    if let Some(namespace) = namespace.as_deref() {
        let write_check =
            check_registry_write_access(&registry, namespace, username.trim(), &password).await?;
        if !write_check.ok {
            return Ok(write_check);
        }
    }
    let permit = tokio::time::timeout(Duration::from_secs(5), KEYCHAIN_WRITE_GATE.acquire())
        .await
        .map_err(|_| "系统密钥库正在处理上一项操作，请稍后再试".to_string())?
        .map_err(public_error)?;
    let replace = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let username = Zeroizing::new(username.trim().to_string());
        let password = Zeroizing::new(password);
        let username_key = format!("{secret_prefix}.username");
        let password_key = format!("{secret_prefix}.password");
        let previous_username = optional_keyring_secret(&username_key)?;
        let previous_password = optional_keyring_secret(&password_key)?;

        write_keyring_secret(&username_key, username.as_str())?;
        if let Err(error) = write_keyring_secret(&password_key, password.as_str()) {
            // 两个字段必须作为一组生效。第二项写入失败时恢复旧值，避免
            // 留下“新用户名 + 旧密码”的混合连接。
            let username_restore =
                restore_keyring_secret(&username_key, previous_username.as_ref());
            let password_restore =
                restore_keyring_secret(&password_key, previous_password.as_ref());
            if username_restore.is_err() || password_restore.is_err() {
                return Err(
                    "AD-REG-104：新登录信息没有完整保存，旧连接恢复也未完成，请重新填写后验证"
                        .to_string(),
                );
            }
            return Err(error);
        }
        Ok(login)
    });
    let result = tokio::time::timeout(Duration::from_secs(40), replace)
        .await
        .map_err(|_| "验证并保存镜像仓库登录信息超时，请重新尝试".to_string())?
        .map_err(public_error)??;
    if result.ok && is_tcr {
        let mut metadata = BTreeMap::from([("endpoint".to_string(), registry_for_connection)]);
        if let Some(namespace) = namespace {
            metadata.insert("namespace".to_string(), namespace);
        }
        let checked_at = Utc::now().to_rfc3339();
        state.upsert_compat_connection(
            TCR_REGISTRY_CONNECTION_ID,
            "registry",
            "tcr",
            "腾讯云 TCR",
            Some("registry.tcr.v2.password"),
            &metadata,
            &["push".to_string(), "pull".to_string()],
            "ready",
            Some(&checked_at),
        )?;
    }
    Ok(result)
}

#[tauri::command]
pub(super) async fn check_saved_registry_credentials(
    registry: String,
    secret_prefix: String,
    namespace: Option<String>,
) -> Result<ProviderCheck, String> {
    if !matches!(secret_prefix.as_str(), TCR_SECRET_PREFIX | "registry.oci") {
        return Err("镜像仓库凭据类型不正确".to_string());
    }
    let registry_for_login = registry.clone();
    let check = tauri::async_runtime::spawn_blocking(move || {
        let username = match read_keyring_secret(&format!("{secret_prefix}.username")) {
            Ok(value) => Zeroizing::new(value),
            Err(error) if error == "missing" => {
                return Ok((
                    registry_check(
                        false,
                        "没有找到可复用的镜像仓库登录信息",
                        Some("AD-REG-102"),
                        vec!["重新填写登录用户名和访问密码后验证".to_string()],
                        false,
                    ),
                    Zeroizing::new(String::new()),
                    Zeroizing::new(String::new()),
                ));
            }
            Err(error) => return Err(error),
        };
        let password = match read_keyring_secret(&format!("{secret_prefix}.password")) {
            Ok(value) => Zeroizing::new(value),
            Err(error) if error == "missing" => {
                return Ok((
                    registry_check(
                        false,
                        "没有找到可复用的镜像仓库登录信息",
                        Some("AD-REG-102"),
                        vec!["重新填写登录用户名和访问密码后验证".to_string()],
                        false,
                    ),
                    Zeroizing::new(String::new()),
                    Zeroizing::new(String::new()),
                ));
            }
            Err(error) => return Err(error),
        };
        let check =
            check_registry_login(&registry_for_login, username.as_str(), password.as_str())?;
        Ok((check, username, password))
    });
    let (check, username, password) = tokio::time::timeout(Duration::from_secs(30), check)
        .await
        .map_err(|_| "读取并验证已保存的镜像仓库凭据超时".to_string())?
        .map_err(public_error)??;
    if !check.ok {
        return Ok(check);
    }
    if let Some(namespace) = namespace
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return check_registry_write_access(
            &registry,
            namespace,
            username.as_str(),
            password.as_str(),
        )
        .await;
    }
    Ok(check)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_registry_bearer_challenge_for_push_probe() {
        assert_eq!(
            registry_bearer_challenge(
                "Bearer realm=\"https://example.com/token\",service=\"registry.example.com\""
            ),
            Some(RegistryBearerChallenge {
                realm: "https://example.com/token".to_string(),
                service: Some("registry.example.com".to_string()),
            })
        );
        assert_eq!(
            registry_bearer_challenge(
                "Bearer realm=\"https://ccr.ccs.tencentyun.com/service/token\",service=\"token-service\",scope=\"repository:finagent/abcdeploy-permission-check:pull,push\""
            ),
            Some(RegistryBearerChallenge {
                realm: "https://ccr.ccs.tencentyun.com/service/token".to_string(),
                service: Some("token-service".to_string()),
            })
        );
    }

    #[test]
    fn rejected_namespace_has_actionable_public_error() {
        let check = registry_write_denied("abcdeploy");
        assert!(!check.ok);
        assert_eq!(check.code.as_deref(), Some("AD-REG-201"));
        assert!(check.summary.contains("abcdeploy"));
        assert_eq!(check.next_steps.len(), 2);
    }
}
