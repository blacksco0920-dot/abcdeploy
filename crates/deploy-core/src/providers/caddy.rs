use std::path::Path;
use std::time::Duration;

use crate::error::{DeployError, Result};
use crate::model::ProviderCheck;
use crate::providers::ssh::SshProfile;
use crate::redact::redact_text;
use crate::system_command;

const SERVER_SOURCE_HELPERS: &str = include_str!("../../../../scripts/server-runtime-sources.sh");
const SERVER_BOOTSTRAP_BODY: &str = include_str!("../../../../scripts/server-bootstrap.sh");

fn server_bootstrap_script() -> String {
    format!("{SERVER_SOURCE_HELPERS}\n{SERVER_BOOTSTRAP_BODY}")
}

pub fn validate_caddyfile(path: &Path) -> Result<ProviderCheck> {
    let output = if command_exists("caddy") {
        system_command("caddy")
            .arg("validate")
            .arg("--config")
            .arg(path)
            .arg("--adapter")
            .arg("caddyfile")
            .output()
    } else {
        let mount = format!("{}:/etc/caddy/Caddyfile:ro", path.to_string_lossy());
        system_command("docker")
            .args([
                "run",
                "--rm",
                "-v",
                &mount,
                "caddy:2-alpine",
                "caddy",
                "validate",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ])
            .output()
    }
    .map_err(|error| DeployError::Command {
        command: "caddy validate".to_string(),
        message: error.to_string(),
    })?;
    Ok(ProviderCheck {
        provider: "caddy".to_string(),
        ok: output.status.success(),
        summary: if output.status.success() {
            "Caddy 配置有效".to_string()
        } else {
            "Caddy 配置无效".to_string()
        },
        details: if output.status.success() {
            Vec::new()
        } else {
            vec![redact_text(&String::from_utf8_lossy(&output.stderr))]
        },
        code: (!output.status.success()).then(|| "AD-SRV-204".to_string()),
        next_steps: if output.status.success() {
            Vec::new()
        } else {
            vec!["修复 Caddyfile 后重新验证".to_string()]
        },
        retryable: !output.status.success(),
    })
}

pub async fn bootstrap_server(profile: &SshProfile, confirmed: bool) -> Result<ProviderCheck> {
    if !confirmed {
        return Err(DeployError::Command {
            command: "caddy bootstrap".to_string(),
            message: "初始化服务器 Caddy 前必须明确确认".to_string(),
        });
    }
    if !profile.key_path.is_file() {
        return Ok(ProviderCheck {
            provider: "caddy".to_string(),
            ok: false,
            summary: "SSH 私钥文件不存在".to_string(),
            details: vec!["重新选择本机私钥文件".to_string()],
            code: Some("AD-SSH-101".to_string()),
            next_steps: vec!["返回服务器连接步骤，重新选择或生成 SSH 私钥".to_string()],
            retryable: true,
        });
    }
    let script = server_bootstrap_script();
    let output = crate::providers::ssh::execute(
        profile,
        "bash -s",
        Some(script.as_bytes()),
        Duration::from_mins(10),
    )
    .await?;
    if output.exit_status == Some(0) {
        let docker_installed = output
            .stdout
            .lines()
            .any(|line| line.trim() == "ABCDEPLOY_DOCKER_SETUP=installed");
        let reused = output
            .stdout
            .lines()
            .any(|line| line.trim() == "ABCDEPLOY_CADDY_MODE=reused");
        let container =
            marker_value(&output.stdout, "ABCDEPLOY_CADDY_CONTAINER").unwrap_or("deploydesk-caddy");
        let cloud_provider = marker_value(&output.stdout, "ABCDEPLOY_CLOUD_PROVIDER");
        let docker_source = marker_value(&output.stdout, "ABCDEPLOY_DOCKER_SOURCE");
        let mut details = vec![
            if docker_installed {
                "已安装并启动 Docker Engine 与 Compose 插件".to_string()
            } else {
                "已复用服务器现有 Docker 运行环境".to_string()
            },
            if reused {
                "只使用独立路由目录，不改写现有主 Caddyfile".to_string()
            } else {
                "已准备统一运行目录，未修改其他反向代理配置".to_string()
            },
        ];
        if docker_installed {
            details.push(format!(
                "{}；已选择{}",
                cloud_provider_label(cloud_provider),
                docker_source_label(docker_source)
            ));
        }
        return Ok(ProviderCheck {
            provider: "caddy".to_string(),
            ok: true,
            summary: if reused {
                format!("已复用服务器现有的统一 Caddy：{container}")
            } else if docker_installed {
                format!("已自动初始化服务器 {} 并启动统一 Caddy", profile.name)
            } else {
                format!("服务器 {} 的 ABCDeploy Caddy 已就绪", profile.name)
            },
            details,
            code: None,
            next_steps: Vec::new(),
            retryable: false,
        });
    }
    let message = redact_text(&output.stderr);
    let code = marker_value(&message, "ABCDEPLOY_ERROR_CODE")
        .unwrap_or("AD-SRV-299")
        .to_string();
    let summary = marker_value(&message, "ABCDEPLOY_ERROR_MESSAGE").map_or_else(
        || format!("服务器 {} 初始化未完成", profile.name),
        ToString::to_string,
    );
    let next_step = marker_value(&message, "ABCDEPLOY_ERROR_NEXT_STEP")
        .unwrap_or("展开技术详情检查服务器日志，然后重新检查")
        .to_string();
    let details = message
        .lines()
        .filter(|line| {
            let line = line.trim();
            !line.is_empty() && !line.starts_with("ABCDEPLOY_ERROR_")
        })
        .take(3)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    Ok(ProviderCheck {
        provider: "caddy".to_string(),
        ok: false,
        summary,
        details,
        code: Some(code),
        next_steps: vec![next_step],
        retryable: true,
    })
}

fn marker_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}=");
    text.lines()
        .find_map(|line| line.trim().strip_prefix(&prefix))
        .filter(|value| !value.is_empty())
}

fn cloud_provider_label(provider: Option<&str>) -> &'static str {
    match provider {
        Some("tencent") => "检测为腾讯云服务器",
        Some("aliyun") => "检测为阿里云服务器",
        Some("huawei") => "检测为华为云服务器",
        _ => "未识别云厂商，已按可用性选择软件源",
    }
}

fn docker_source_label(source: Option<&str>) -> &'static str {
    match source {
        Some("tencent") => "腾讯云 Docker 软件源",
        Some("aliyun") => "阿里云 Docker 软件源",
        Some("huawei") => "华为云 Docker 软件源",
        Some("official") => "Docker 官方软件源",
        _ => "可用的 Docker 软件源",
    }
}

fn command_exists(command: &str) -> bool {
    system_command(command)
        .arg("version")
        .output()
        .is_ok_and(|output| output.status.success())
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::process::{Command, Stdio};

    use super::{SERVER_BOOTSTRAP_BODY, SERVER_SOURCE_HELPERS, marker_value};

    fn source_plan(provider: &str) -> Vec<String> {
        let mut child = Command::new("bash")
            .args(["-s", "--", provider])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("bash should start");
        let script =
            format!("{SERVER_SOURCE_HELPERS}\nabcdeploy_docker_source_plan \"$1\" ubuntu\n");
        child
            .stdin
            .as_mut()
            .expect("stdin should be piped")
            .write_all(script.as_bytes())
            .expect("source plan should be written");
        let output = child.wait_with_output().expect("bash should finish");
        assert!(output.status.success());
        String::from_utf8(output.stdout)
            .expect("source plan should be utf-8")
            .lines()
            .map(ToString::to_string)
            .collect()
    }

    fn run_shell(script: &str, arguments: &[&str]) -> std::process::Output {
        let mut command = Command::new("bash");
        command.arg("-s").arg("--").args(arguments);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("bash should start");
        child
            .stdin
            .as_mut()
            .expect("stdin should be piped")
            .write_all(script.as_bytes())
            .expect("script should be written");
        child.wait_with_output().expect("bash should finish")
    }

    #[test]
    fn extracts_stable_bootstrap_error_markers() {
        let output = "docker failed\nABCDEPLOY_ERROR_CODE=AD-SRV-202\nABCDEPLOY_ERROR_MESSAGE=已有 Caddy 不兼容\nABCDEPLOY_ERROR_NEXT_STEP=挂载路由目录\n";
        assert_eq!(
            marker_value(output, "ABCDEPLOY_ERROR_CODE"),
            Some("AD-SRV-202")
        );
        assert_eq!(
            marker_value(output, "ABCDEPLOY_ERROR_NEXT_STEP"),
            Some("挂载路由目录")
        );
    }

    #[test]
    fn empty_ubuntu_servers_are_initialized_without_user_commands() {
        assert!(SERVER_BOOTSTRAP_BODY.contains("abcdeploy-docker.list"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("abcdeploy_docker_source_plan"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("docker-compose-plugin"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("systemctl enable --now docker"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("ABCDEPLOY_DOCKER_SETUP=installed"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("AD-SRV-104"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("mirror.ccs.tencentyun.com/library/caddy@"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("m.daocloud.io/docker.io/library/caddy@"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("http://127.0.0.1"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("systemctl disable --now caddy"));
        assert!(SERVER_BOOTSTRAP_BODY.contains("AD-SRV-212"));
    }

    #[test]
    fn docker_sources_prefer_the_detected_cloud_and_keep_fallbacks() {
        for (provider, expected_first) in [
            ("tencent", "tencent|"),
            ("aliyun", "aliyun|"),
            ("huawei", "huawei|"),
        ] {
            let plan = source_plan(provider);
            assert!(
                plan.first()
                    .is_some_and(|line| line.starts_with(expected_first))
            );
            assert!(
                plan.last()
                    .is_some_and(|line| line.starts_with("official|"))
            );
            assert_eq!(plan.len(), 4);
        }

        let unknown = source_plan("unknown");
        assert!(unknown[0].starts_with("tencent|"));
        assert!(unknown[1].starts_with("aliyun|"));
        assert!(unknown[2].starts_with("huawei|"));
        assert!(unknown[3].starts_with("official|"));
    }

    #[test]
    fn provider_detection_has_a_deterministic_testable_override() {
        for provider in ["tencent", "aliyun", "huawei", "unknown"] {
            let script = format!(
                "{SERVER_SOURCE_HELPERS}\nABCDEPLOY_CLOUD_PROVIDER_OVERRIDE=\"$1\" abcdeploy_detect_cloud_provider\n"
            );
            let output = run_shell(&script, &[provider]);
            assert!(output.status.success());
            assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), provider);
        }
    }

    #[test]
    fn packaged_server_bootstrap_is_valid_bash() {
        let script = format!("{SERVER_SOURCE_HELPERS}\n{SERVER_BOOTSTRAP_BODY}");
        let mut child = Command::new("bash")
            .arg("-n")
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("bash should start");
        child
            .stdin
            .as_mut()
            .expect("stdin should be piped")
            .write_all(script.as_bytes())
            .expect("combined bootstrap should be written");
        let output = child.wait_with_output().expect("bash should finish");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
