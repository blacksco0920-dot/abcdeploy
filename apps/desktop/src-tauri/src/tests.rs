use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::{fmt::Write as _, fs, path::Path, process::Command};

use base64::Engine as _;
use serde_json::json;
use tempfile::tempdir;

use super::{
    BASE64, CNB_ACCOUNT_CACHE_KEY, CNB_KEYCHAIN_UNAVAILABLE_ERROR, CnbBuildRecord,
    CnbTokenResolutionError, DeploymentArtifact, DeploymentPath, DeploymentRun,
    LocalPreviewService, LocalPreviewStatus, ProjectRelinkIdentity, REMOTE_DEPENDENCY_SCRIPT,
    RegistryConfig, ServerRouteProblem, ServerRouteProblemKind, StoredCnbToken, WorkspaceState,
    apply_container_log_diagnostic, apply_deployed_service_states,
    apply_planned_local_build_strategies, apply_public_route_checks, apply_runner_log_diagnostic,
    apply_server_route_problem, apply_server_route_problems, apply_server_route_takeover_problem,
    apply_version_title, build_environment_for_event, build_serial_for_revision, cache_secret,
    cached_cnb_account, cached_secret, caddy_certificate_reload_script,
    caddy_main_route_rewrite_shell_function, caddy_route_declared_shell_function,
    certificate_retry_allowed, cloud_setup_required, cnb_account_from_responses,
    cnb_build_history_error, cnb_keyring_issue, cnb_public_error, cnb_secret_filename,
    container_runtime_env, create_deployment_git_snapshot, deployment_manifest,
    deployment_needs_public_route_recheck, deployment_owned_paths,
    deployment_path_managed_runtime_variables, deployment_path_manifest,
    deployment_path_owns_history_reconciliation, deployment_routing_manifest,
    ensure_git_repository_for_sync, ensure_runtime_template_variables, evict_cached_secret,
    existing_cnb_repository, fill_empty_runtime_values, fill_managed_runtime_dependencies,
    git_failure, git_stdout, internal_runtime_secret, interrupted_public_route_status,
    interrupted_route_check_message, is_deployment_internal_path, is_deployment_owned_path,
    is_production_approval_build, latest_success_serials_by_environment,
    load_existing_project_config, local_build_failure_summary, local_build_proxy_attempts,
    local_database_name, local_git_title, local_infrastructure_compose, local_start_failure,
    looks_like_dependency_network_text, ordered_build_records, overlay_server_route_problems,
    parse_deploy_environment, parse_deployed_service_states, parse_deployment_artifacts,
    parse_local_container_readiness, parse_managed_local_port_owner, parse_runtime_environment,
    pause_deployment_path_after_deploy_error, pause_public_route_inspection,
    pilot_can_resume_existing_artifacts, prepare_deployment_path_retry_inner,
    provider_check_failure, readable_version_title, remember_cnb_account, remote_dependency_error,
    replace_managed_runtime_dependencies, repository_identity, required_runtime_variables,
    resolve_cnb_token_sources, rollback_script, run_git_command, run_local_build_with_recovery,
    runnable_local_service_ids, runtime_config_key, runtime_config_template, runtime_defaults,
    runtime_secret_key, safe_postgres_identifier, same_artifact_digests,
    save_cnb_connection_metadata_best_effort, serialize_manifest, server_route_activation_script,
    services_use_public_generated_dockerfiles, split_deployment_error,
    stage_deployment_owned_files, stage_key, system_command, update_run_from_cnb,
    url_encode_userinfo, valid_registry_host, validate_deployment_routing_manifest,
    validate_git_branch, validate_project_relink, validate_repository_slug, verify_public_routes,
    write_project_local_env,
};
use deploy_core::error::DeployError;
use deploy_core::model::{EnvironmentName, PackageManager, ProviderCheck, PublicRouteStatus};

mod deployment_error_tests;
mod deployment_route_capability_tests;

fn run() -> DeploymentRun {
    DeploymentRun {
        id: "run-1".to_string(),
        project_path: "/tmp/sample".to_string(),
        project_name: "sample".to_string(),
        environment: "staging".to_string(),
        status: "running".to_string(),
        current_stage: "build".to_string(),
        build_serial: Some("42".to_string()),
        commit_sha: Some("0123456789abcdef0123456789abcdef01234567".to_string()),
        source_title: Some("让版本更容易识别".to_string()),
        source_run_id: None,
        candidate_tag: None,
        artifacts: Vec::new(),
        route_checks: Vec::new(),
        action_kind: None,
        action_url: None,
        issue_code: None,
        repository: "owner/sample".to_string(),
        branch: "main".to_string(),
        message: String::new(),
        completed_steps: vec!["write-config".to_string()],
        started_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn deployment_line_uses_the_production_runtime_contract() {
    assert_eq!(
        parse_deploy_environment("deployment"),
        Ok(EnvironmentName::Production)
    );
    assert_eq!(
        parse_runtime_environment("deployment"),
        Ok(EnvironmentName::Production)
    );
}

#[test]
fn bulk_local_start_skips_services_without_a_reliable_build() {
    let service = |id: &str, build_strategy: &str| LocalPreviewService {
        id: id.to_string(),
        kind: "web".to_string(),
        build_strategy: build_strategy.to_string(),
        dockerfile: format!("Dockerfile.{id}"),
        host_port: Some(4300),
        url: None,
        running: false,
    };
    let status = LocalPreviewStatus {
        state: "stopped".to_string(),
        message: String::new(),
        compose_path: "/tmp/compose.yml".to_string(),
        env_ready: true,
        services: vec![
            service("api", "existing"),
            service("web", "generated"),
            service("toolbox", "needs_input"),
        ],
        written_files: Vec::new(),
    };

    assert_eq!(
        runnable_local_service_ids(&status),
        vec!["api".to_string(), "web".to_string()]
    );
}

#[test]
fn unhealthy_image_requires_an_update_instead_of_redeploying_the_same_artifacts() {
    let mut deployment = run();
    deployment.artifacts.push(DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example/api".to_string(),
        digest: format!("sha256:{}", "a".repeat(64)),
    });
    pause_deployment_path_after_deploy_error(
        &mut deployment,
        "container sample-api-1 is unhealthy",
    );

    assert_eq!(deployment.issue_code.as_deref(), Some("AD-CTR-201"));
    assert_eq!(
        deployment.action_kind.as_deref(),
        Some("deployment-path-image-update")
    );
    assert!(!pilot_can_resume_existing_artifacts(&deployment));
}

#[test]
fn remote_dependency_errors_prefer_the_stable_coded_line() {
    let stderr = "Unable to find image 'postgres:16-alpine' locally\n\
            request to registry-1.docker.io timed out\n\
            AD-INF-202：服务器暂时无法下载数据库运行组件；系统已尝试国内来源\n";

    assert_eq!(
        remote_dependency_error(stderr),
        "AD-INF-202：服务器暂时无法下载数据库运行组件；系统已尝试国内来源"
    );
    assert_eq!(
        split_deployment_error(&remote_dependency_error(stderr)),
        Some((
            "AD-INF-202",
            "服务器暂时无法下载数据库运行组件；系统已尝试国内来源"
        ))
    );
}

#[test]
fn remote_runtime_images_use_pinned_domestic_fallbacks() {
    for component in ["postgres", "redis"] {
        assert!(
            REMOTE_DEPENDENCY_SCRIPT
                .contains(&format!("mirror.ccs.tencentyun.com/library/{component}"))
        );
        assert!(
            REMOTE_DEPENDENCY_SCRIPT
                .contains(&format!("m.daocloud.io/docker.io/library/{component}"))
        );
    }
    assert!(
        REMOTE_DEPENDENCY_SCRIPT
            .contains("sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777")
    );
    assert!(
        REMOTE_DEPENDENCY_SCRIPT
            .contains("sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99")
    );
    assert!(!REMOTE_DEPENDENCY_SCRIPT.contains(" postgres:16-alpine"));
    assert!(!REMOTE_DEPENDENCY_SCRIPT.contains(" redis:7-alpine"));
    assert!(
        REMOTE_DEPENDENCY_SCRIPT.contains("runtime-dependencies.lock"),
        "shared infrastructure setup must be serialized on one server"
    );
    assert!(REMOTE_DEPENDENCY_SCRIPT.contains("docker start \"$POSTGRES_CONTAINER\""));
    assert!(REMOTE_DEPENDENCY_SCRIPT.contains("docker start \"$REDIS_CONTAINER\""));
    assert!(
            REMOTE_DEPENDENCY_SCRIPT.contains(
                "docker network inspect \"$NETWORK\" --format '{{range .Containers}}{{println .Name}}{{end}}'"
            )
        );
}

#[test]
fn runtime_dependency_failures_resume_the_same_server_deploy() {
    let mut deployment = run();
    deployment.environment = "deployment".to_string();
    pause_deployment_path_after_deploy_error(
        &mut deployment,
        "AD-INF-202：服务器暂时无法下载数据库运行组件；系统已尝试国内来源",
    );

    assert_eq!(deployment.current_stage, "deploy");
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-INF-202"));
    assert_eq!(
        deployment.action_kind.as_deref(),
        Some("deployment-path-retry")
    );
    assert_eq!(
        deployment.message,
        "服务器暂时无法下载数据库运行组件；系统已尝试国内来源"
    );
}

#[test]
fn unknown_server_errors_are_not_misclassified_as_route_conflicts() {
    let mut deployment = run();
    pause_deployment_path_after_deploy_error(&mut deployment, "unexpected remote command failure");

    assert_eq!(deployment.current_stage, "deploy");
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-DEP-201"));
    assert!(!deployment.message.contains("remote command"));
    assert!(deployment.message.contains("核对服务器上的实际运行状态"));
}

#[test]
fn route_reconciliation_failures_resume_without_redeploying_the_application() {
    let mut deployment = run();
    deployment.environment = "deployment".to_string();
    pause_deployment_path_after_deploy_error(
        &mut deployment,
        "AD-SRV-209：访问地址配置尚未加载，已保留运行中的服务",
    );

    assert_eq!(deployment.current_stage, "server");
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-SRV-209"));
    assert_eq!(
        deployment.action_kind.as_deref(),
        Some("deployment-path-retry")
    );
}

#[test]
fn pre_deploy_server_failures_do_not_skip_the_version_update() {
    let mut deployment = run();
    deployment.environment = "deployment".to_string();
    pause_deployment_path_after_deploy_error(&mut deployment, "AD-SRV-208：服务器磁盘空间不足");

    assert_eq!(deployment.current_stage, "deploy");
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-SRV-208"));
}

#[test]
fn provider_failures_keep_the_bootstrap_error_code() {
    let check = ProviderCheck {
        provider: "caddy".to_string(),
        ok: false,
        summary: "服务器暂时无法下载统一访问组件".to_string(),
        details: Vec::new(),
        code: Some("AD-SRV-212".to_string()),
        next_steps: Vec::new(),
        retryable: true,
    };

    assert_eq!(
        provider_check_failure(&check),
        "AD-SRV-212：服务器暂时无法下载统一访问组件"
    );
}

#[test]
fn local_status_reports_files_the_plan_can_reliably_generate_as_runnable() {
    let service = |id: &str| LocalPreviewService {
        id: id.to_string(),
        kind: "web".to_string(),
        build_strategy: "needs_input".to_string(),
        dockerfile: format!(".deploydesk/generated/build/Dockerfile.{id}"),
        host_port: Some(4300),
        url: None,
        running: false,
    };
    let mut status = LocalPreviewStatus {
        state: "not_prepared".to_string(),
        message: String::new(),
        compose_path: "/tmp/compose.yml".to_string(),
        env_ready: false,
        services: vec![service("api"), service("toolbox")],
        written_files: Vec::new(),
    };

    apply_planned_local_build_strategies(&mut status, &BTreeSet::from(["toolbox".to_string()]));

    assert_eq!(status.services[0].build_strategy, "generated");
    assert_eq!(status.services[1].build_strategy, "needs_input");
}

#[test]
fn registry_validation_accepts_hosts_but_rejects_urls_and_paths() {
    assert!(valid_registry_host("ccr.ccs.tencentyun.com"));
    assert!(valid_registry_host("registry.example.com"));
    assert!(!valid_registry_host("https://ccr.ccs.tencentyun.com"));
    assert!(!valid_registry_host("ccr.ccs.tencentyun.com/team"));
    assert!(!valid_registry_host("-registry.example.com"));
    assert!(!valid_registry_host("registry-.example.com"));
    assert!(!valid_registry_host("localhost"));
}

#[test]
fn moved_project_recovery_requires_the_same_repository_identity() {
    assert_eq!(
        repository_identity("git@cnb.cool:team/sample.git\n").as_deref(),
        Some("team/sample")
    );
    assert_eq!(
        repository_identity("https://cnb.cool/team/sample.git").as_deref(),
        Some("team/sample")
    );
    assert!(repository_identity("https://example.com/team/sample.git").is_none());

    let identity = ProjectRelinkIdentity {
        name: "sample".to_string(),
        service_count: 2,
        storage_id: "a".repeat(64),
        repository: Some("team/sample".to_string()),
        fingerprint: None,
    };
    assert!(
        validate_project_relink(
            &identity,
            "renamed-folder",
            4,
            "different-structure",
            &BTreeSet::from(["team/sample".to_string()]),
        )
        .is_ok()
    );
    assert!(
        validate_project_relink(
            &identity,
            "sample",
            2,
            "same-structure",
            &BTreeSet::from(["other/project".to_string()]),
        )
        .expect_err("reject another repository")
        .contains("另一个代码仓库")
    );
    assert!(
        validate_project_relink(&identity, "sample", 2, "same-structure", &BTreeSet::new())
            .expect_err("reject missing identity")
            .contains("无法确认")
    );

    let local_only = ProjectRelinkIdentity {
        repository: None,
        fingerprint: Some("same-structure".to_string()),
        ..identity
    };
    assert!(
        validate_project_relink(
            &local_only,
            "renamed-project",
            5,
            "same-structure",
            &BTreeSet::new(),
        )
        .is_ok()
    );
    assert!(
        validate_project_relink(
            &local_only,
            "sample",
            2,
            "different-structure",
            &BTreeSet::new(),
        )
        .is_err()
    );
}

#[test]
fn keeps_a_short_single_line_title_for_people_to_recognize_versions() {
    assert_eq!(
        readable_version_title("  修复登录页\n并优化加载速度  ").as_deref(),
        Some("修复登录页 并优化加载速度")
    );
    assert_eq!(readable_version_title("   "), None);
    assert_eq!(readable_version_title("API custom event"), None);
    assert_eq!(
        readable_version_title("initialize project for ABCDeploy").as_deref(),
        Some("初始化 ABCDeploy 项目")
    );
    assert_eq!(
        readable_version_title("fix: 修复登录页").as_deref(),
        Some("修复登录页")
    );
    assert_eq!(
        readable_version_title("feat(home): 增加数据看板").as_deref(),
        Some("增加数据看板")
    );
    assert_eq!(
        readable_version_title("chore: configure ABCDeploy deployment").as_deref(),
        Some("完成首次上线配置")
    );
    assert_eq!(
        readable_version_title(&"改".repeat(140))
            .expect("title")
            .chars()
            .count(),
        120
    );
}

#[test]
fn adds_the_cnb_change_summary_to_an_existing_version_record() {
    let mut deployment = run();
    deployment.source_title = None;
    let record = CnbBuildRecord {
        serial: "42".to_string(),
        event: "push".to_string(),
        status: "success".to_string(),
        revision: deployment.commit_sha.clone(),
        source_ref: Some("main".to_string()),
        title: "fix(home): 修复首页加载问题".to_string(),
        created_at: None,
    };
    apply_version_title(&mut deployment, &record, Path::new("/not-needed"));
    assert_eq!(deployment.source_title.as_deref(), Some("修复首页加载问题"));
}

#[test]
fn recovers_a_version_title_from_local_git_history() {
    let project = tempdir().expect("temp project");
    for args in [
        vec!["init", "-q"],
        vec!["config", "user.email", "abcdeploy@example.com"],
        vec!["config", "user.name", "ABCDeploy Test"],
    ] {
        assert!(
            Command::new("git")
                .current_dir(project.path())
                .args(args)
                .status()
                .expect("run git")
                .success()
        );
    }
    fs::write(project.path().join("README.md"), "test\n").expect("write readme");
    assert!(
        Command::new("git")
            .current_dir(project.path())
            .args(["add", "README.md"])
            .status()
            .expect("add")
            .success()
    );
    assert!(
        Command::new("git")
            .current_dir(project.path())
            .args(["commit", "-q", "-m", "修复登录并优化首页速度"])
            .status()
            .expect("commit")
            .success()
    );
    let revision = String::from_utf8(
        Command::new("git")
            .current_dir(project.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .expect("revision")
            .stdout,
    )
    .expect("utf8 revision");
    assert_eq!(
        local_git_title(project.path(), revision.trim()).as_deref(),
        Some("修复登录并优化首页速度")
    );
}

#[test]
fn local_infrastructure_is_loopback_only_and_project_databases_are_isolated() {
    let compose = local_infrastructure_compose();
    serde_yaml_ng::from_str::<serde_yaml_ng::Value>(compose).expect("valid Compose YAML");
    assert!(compose.contains("127.0.0.1:${POSTGRES_PORT}:5432"));
    assert!(compose.contains("127.0.0.1:${REDIS_PORT}:6379"));
    assert!(!compose.contains("password="));

    let first = local_database_name(Path::new("/tmp/project-a"), EnvironmentName::Development);
    let second = local_database_name(Path::new("/tmp/project-b"), EnvironmentName::Development);
    let production = local_database_name(Path::new("/tmp/project-a"), EnvironmentName::Production);
    assert_ne!(first, second);
    assert_ne!(first, production);
    assert!(
        first
            .bytes()
            .all(|byte| { byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' })
    );
}

#[test]
fn reads_all_local_infrastructure_states_from_one_docker_listing() {
    let output = concat!(
        "abcdeploy-local-redis\trunning\tUp 2 hours (healthy)\n",
        "abcdeploy-local-postgres\trunning\tUp 2 hours (health: starting)\n",
    );
    assert_eq!(parse_local_container_readiness(output), (false, true));
    assert_eq!(
        parse_local_container_readiness(
            "abcdeploy-local-postgres\texited\tExited (0) 1 minute ago\n"
        ),
        (false, false)
    );
}

#[test]
fn container_runtime_uses_the_host_gateway_without_changing_other_env_values() {
    let source = concat!(
        "# project config\n",
        "DATABASE_URL=postgresql://user:secret@127.0.0.1:55432/app\n",
        "REDIS_URL=\"redis://:secret@localhost:56379/0\"\n",
        "CALLBACK_URL=http://127.0.0.1:3000/callback\n",
    );
    let adapted = container_runtime_env(source);
    assert!(adapted.contains("@host.docker.internal:55432/app"));
    assert!(adapted.contains("@host.docker.internal:56379/0"));
    assert!(adapted.contains("CALLBACK_URL=http://127.0.0.1:3000/callback"));
    assert!(adapted.starts_with("# project config\n"));
}

#[test]
fn maps_cnb_stages_to_resumable_product_state() {
    let mut deployment = run();
    update_run_from_cnb(
        &mut deployment,
        &json!({
            "status": "running",
            "pipelinesStatus": {
                "pipeline": {"stages": [{"name": "部署测试环境", "status": "running"}]}
            }
        }),
    );
    assert_eq!(deployment.status, "running");
    assert_eq!(deployment.current_stage, "deploy");
    assert!(deployment.message.contains("部署测试环境"));

    update_run_from_cnb(&mut deployment, &json!({"status": "success"}));
    assert_eq!(deployment.status, "success");
    assert_eq!(deployment.current_stage, "complete");
    assert!(
        deployment
            .completed_steps
            .contains(&"healthcheck".to_string())
    );
    assert_eq!(stage_key(Some("上传镜像")), "publish");
    assert_eq!(stage_key(Some("在测试环境验证生产候选")), "deploy");
    assert_eq!(stage_key(Some("标记已验证镜像摘要")), "verify-release");
    assert_eq!(
        stage_key(Some("创建可在手机发布的候选版本")),
        "verify-release"
    );
    assert_eq!(stage_key(Some("准备安全部署工具")), "prepare");

    update_run_from_cnb(
        &mut deployment,
        &json!({
            "status": "pending",
            "pipelinesStatus": {
                "pipeline": {"stages": [{"name": "构建并上传 api", "status": "start"}]}
            }
        }),
    );
    assert_eq!(deployment.status, "running");
    assert_eq!(deployment.current_stage, "build");
    assert_eq!(deployment.message, "正在执行：构建并上传 api");
}

#[test]
fn live_server_checks_only_keep_a_release_healthy_when_every_service_is_ready() {
    let expected = vec![
        ("api".to_string(), "sample-staging-api-1".to_string()),
        ("web".to_string(), "sample-staging-web-1".to_string()),
    ];
    let healthy = parse_deployed_service_states(
        "api\trunning\thealthy\tregistry.example/api@sha256:abc\nweb\trunning\tnone\tregistry.example/web@sha256:def\n",
        &expected,
    );
    assert_eq!(
        healthy[0].image.as_deref(),
        Some("registry.example/api@sha256:abc")
    );
    let mut deployment = run();
    deployment.status = "success".to_string();
    deployment.current_stage = "complete".to_string();
    deployment.action_kind = Some("local-preview".to_string());
    deployment.completed_steps.push("healthcheck".to_string());
    apply_deployed_service_states(&mut deployment, &healthy);
    assert_eq!(deployment.status, "success");
    assert_eq!(deployment.message, "测试版仍在服务器运行");
    assert_eq!(
        deployment.action_kind.as_deref(),
        Some("local-preview"),
        "a live check must not remove the secure preview entry point"
    );

    let missing = parse_deployed_service_states("api\trunning\thealthy\n", &expected);
    apply_deployed_service_states(&mut deployment, &missing);
    assert_eq!(deployment.status, "needs_action");
    assert_eq!(deployment.current_stage, "healthcheck");
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-CTR-201"));
    assert!(deployment.message.contains("sample-staging-web-1"));
    assert!(
        !deployment
            .completed_steps
            .contains(&"healthcheck".to_string())
    );
}

#[test]
fn turns_runner_logs_into_actionable_safe_error_codes() {
    let mut deployment = run();
    apply_runner_log_diagnostic(
        &mut deployment,
        "[00:05:19] container finagent-staging-h5-1 is unhealthy\n",
    );
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-CTR-201"));
    assert_eq!(deployment.current_stage, "healthcheck");
    assert!(deployment.message.contains("finagent-staging-h5-1"));

    let mut missing_config = run();
    apply_runner_log_diagnostic(
        &mut missing_config,
        "缺少密钥仓库字段：STAGING_DATABASE_URL, STAGING_REDIS_URL\n",
    );
    assert_eq!(missing_config.issue_code.as_deref(), Some("AD-CFG-201"));
    assert!(missing_config.message.contains("STAGING_DATABASE_URL"));

    let mut missing_lockfile = run();
    apply_runner_log_diagnostic(
        &mut missing_lockfile,
        "ERR_PNPM_NO_LOCKFILE Cannot install with frozen-lockfile because pnpm-lock.yaml is absent\n",
    );
    assert_eq!(missing_lockfile.issue_code.as_deref(), Some("AD-PKG-201"));
    assert_eq!(missing_lockfile.current_stage, "build");
    assert!(missing_lockfile.message.contains("依赖锁定文件"));

    let mut missing_database = run();
    apply_runner_log_diagnostic(
        &mut missing_database,
        "AD-DB-204：远程数据库尚未准备，请在客户端重新生成当前环境的云端安全配置\n",
    );
    assert_eq!(missing_database.issue_code.as_deref(), Some("AD-DB-204"));
    assert_eq!(
        missing_database.action_kind.as_deref(),
        Some("cloud-config")
    );
    assert_eq!(missing_database.current_stage, "cloud-setup");
    assert!(missing_database.action_url.is_none());

    let mut raw_missing_database = run();
    apply_runner_log_diagnostic(
        &mut raw_missing_database,
        "[00:09:03 +334ms] pg_dump: error: FATAL: database \"example_staging\" does not exist\n",
    );
    assert_eq!(
        raw_missing_database.issue_code.as_deref(),
        Some("AD-DB-204")
    );

    let mut echoed_shell = run();
    apply_runner_log_diagnostic(
        &mut echoed_shell,
        "echo 'AD-SRV-207：Caddy 重载失败，已恢复原路由' >&2\n",
    );
    assert_eq!(echoed_shell.issue_code, None);

    let mut echoed_shell_after_database_error = run();
    apply_runner_log_diagnostic(
        &mut echoed_shell_after_database_error,
        "[00:09:03] pg_dump: error: database \"example_staging\" does not exist\necho 'AD-SRV-207：Caddy 重载失败，已恢复原路由' >&2\n",
    );
    assert_eq!(
        echoed_shell_after_database_error.issue_code.as_deref(),
        Some("AD-DB-204")
    );

    let mut missing_caddy_config_directory = run();
    apply_runner_log_diagnostic(
        &mut missing_caddy_config_directory,
        "/bin/sh: can't create /etc/caddy/Caddyfile: nonexistent directory\n",
    );
    assert_eq!(
        missing_caddy_config_directory.issue_code.as_deref(),
        Some("AD-CTR-202")
    );
    assert!(
        missing_caddy_config_directory
            .message
            .contains("重新生成部署文件")
    );

    let mut legacy_nginx_template_directory = run();
    apply_runner_log_diagnostic(
        &mut legacy_nginx_template_directory,
        "/bin/sh: can't create /etc/nginx/templates/default.conf.template: nonexistent directory\n",
    );
    assert_eq!(
        legacy_nginx_template_directory.issue_code.as_deref(),
        Some("AD-CTR-202")
    );

    let mut unsafe_name = run();
    apply_runner_log_diagnostic(
        &mut unsafe_name,
        "container token=must-not-appear is unhealthy\n",
    );
    assert_eq!(unsafe_name.issue_code, None);
    assert!(!unsafe_name.message.contains("must-not-appear"));
}

#[test]
fn turns_container_logs_into_safe_user_facing_causes() {
    let mut missing_dependency = run();
    apply_container_log_diagnostic(
        &mut missing_dependency,
        "Error: Cannot find module 'express'\nDATABASE_URL=must-not-appear\n",
    );
    assert_eq!(missing_dependency.issue_code.as_deref(), Some("AD-APP-201"));
    assert!(missing_dependency.message.contains("express"));
    assert!(!missing_dependency.message.contains("must-not-appear"));

    let mut database = run();
    apply_container_log_diagnostic(
        &mut database,
        "PrismaClientInitializationError: Authentication failed against database server (P1000)",
    );
    assert_eq!(database.issue_code.as_deref(), Some("AD-DB-201"));
    assert!(!database.message.to_ascii_lowercase().contains("password"));

    let mut web_route_cycle = run();
    apply_container_log_diagnostic(
        &mut web_route_cycle,
        "rewrite or internal redirection cycle while internally redirecting to /index.html",
    );
    assert_eq!(web_route_cycle.issue_code.as_deref(), Some("AD-WEB-201"));
    assert!(web_route_cycle.message.contains("重新生成部署文件"));

    let mut cache = run();
    apply_container_log_diagnostic(&mut cache, "Redis client ECONNREFUSED 10.0.0.2:6379");
    assert_eq!(cache.issue_code.as_deref(), Some("AD-CACHE-201"));
}

#[test]
fn reads_and_compares_immutable_artifacts_from_server_release_records() {
    let manifest = deploy_core::parse_manifest(
        r"
version: 1
project: { name: sample }
source: { provider: cnb, repository: team/sample, release_branch: main }
services:
  - id: api
    kind: api
    image: sample-api
    context: .
    dockerfile: Dockerfile
    container_port: 3000
    healthcheck: { path: /health }
environments:
  development:
    target: { kind: local, namespace: sample-development }
  staging:
    target: { kind: server, server: default, namespace: sample-staging }
  production:
    target: { kind: server, server: default, namespace: sample-production }
providers:
  build: { kind: cnb, repository: team/sample }
  registry: { kind: tcr, registry: registry.example.com, namespace: team }
",
        Path::new("deploy.yaml"),
    )
    .expect("manifest fixture");
    let mut release = String::new();
    for (index, service) in manifest.services.iter().enumerate() {
        let variable = service.id.replace('-', "_").to_ascii_uppercase();
        writeln!(
            release,
            "DEPLOYDESK_{variable}_IMAGE=registry.example.com/team/{}@sha256:{:064x}",
            service.image,
            index + 1
        )
        .expect("write fixture");
    }
    let artifacts =
        parse_deployment_artifacts(&release, &manifest).expect("parse release artifacts");
    assert_eq!(artifacts.len(), manifest.services.len());
    assert!(same_artifact_digests(&artifacts, &artifacts));

    let mut changed = artifacts.clone();
    changed[0].digest = format!("sha256:{:064x}", 99);
    assert!(!same_artifact_digests(&artifacts, &changed));
    assert!(parse_deployment_artifacts("DEPLOYDESK_API_IMAGE=latest", &manifest).is_err());
}

#[test]
fn runtime_values_are_partitioned_without_exposing_names_or_paths() {
    let first = tempdir().expect("temp project");
    let second = tempdir().expect("second temp project");
    let staging =
        runtime_secret_key(first.path(), "staging", "JWT_SECRET").expect("valid runtime key");
    let production =
        runtime_secret_key(first.path(), "production", "JWT_SECRET").expect("valid runtime key");
    let development = runtime_secret_key(first.path(), "development", "JWT_SECRET")
        .expect("valid local runtime key");
    let other_project =
        runtime_secret_key(second.path(), "staging", "JWT_SECRET").expect("valid runtime key");

    assert_ne!(staging, production);
    assert_ne!(staging, development);
    assert_ne!(staging, other_project);
    assert!(!staging.contains("JWT_SECRET"));
    assert!(!staging.contains(&first.path().to_string_lossy().to_string()));
    assert!(runtime_secret_key(first.path(), "staging", "unsafe-name").is_err());
}

#[test]
fn keeps_unlocked_secrets_only_in_the_current_app_session() {
    let key = "test-session-secret-cache";
    evict_cached_secret(key);
    assert_eq!(cached_secret(key), None);

    cache_secret(key, "temporary-value");
    assert_eq!(cached_secret(key).as_deref(), Some("temporary-value"));

    evict_cached_secret(key);
    assert_eq!(cached_secret(key), None);
}

#[test]
fn runtime_config_preserves_the_project_template_verbatim() {
    let project = tempdir().expect("temp project");
    let template = "# 第三方服务\nUNKNOWN_SETTING=keep-me\nEMPTY=\n";
    fs::write(project.path().join(".env.example"), template).expect("write template");

    let (content, sources, required) =
        runtime_config_template(project.path(), deploy_core::model::EnvironmentName::Staging)
            .expect("load runtime template");

    assert_eq!(content, template);
    assert_eq!(sources, [".env.example"]);
    assert!(required.is_empty());
    let staging = runtime_config_key(project.path(), "staging").expect("staging key");
    let production = runtime_config_key(project.path(), "production").expect("production key");
    assert_ne!(staging, production);
    assert!(staging.starts_with("runtime-file-v2."));
    assert!(!staging.contains(&project.path().to_string_lossy().to_string()));
}

#[test]
fn runtime_template_adds_new_manifest_requirements_without_overwriting_values() {
    let prepared = ensure_runtime_template_variables(
        "NODE_ENV=production\nDATABASE_URL=postgresql://db/app\n".to_string(),
        &[
            "NODE_ENV".to_string(),
            "DATABASE_URL".to_string(),
            "AUTH_TOKEN_SECRET".to_string(),
        ],
    );

    assert_eq!(prepared.matches("NODE_ENV=").count(), 1);
    assert!(prepared.contains("DATABASE_URL=postgresql://db/app"));
    assert!(prepared.contains("# ABCDeploy 检测到的必要配置"));
    assert!(prepared.ends_with("AUTH_TOKEN_SECRET=\n"));
}

#[test]
fn remote_runtime_config_clears_local_and_secret_example_values() {
    let project = tempdir().expect("temp project");
    let template = concat!(
        "NODE_ENV=development\n",
        "DATABASE_URL=postgresql://user:pass@localhost/app\n",
        "API_TOKEN=example-secret\n",
        "PUBLIC_API_URL=https://api.example.test\n",
    );
    fs::write(project.path().join(".env.example"), template).expect("write template");

    let (development, _, _) = runtime_config_template(
        project.path(),
        deploy_core::model::EnvironmentName::Development,
    )
    .expect("development template");
    let (staging, _, _) =
        runtime_config_template(project.path(), deploy_core::model::EnvironmentName::Staging)
            .expect("staging template");

    assert_eq!(development, template);
    assert!(staging.contains("NODE_ENV=production"));
    assert!(staging.contains("DATABASE_URL=\n"));
    assert!(staging.contains("API_TOKEN=\n"));
    assert!(staging.contains("PUBLIC_API_URL=https://api.example.test"));
}

#[test]
fn runtime_config_reports_missing_required_variables() {
    let required = vec!["DATABASE_URL".to_string()];

    assert_eq!(
        super::missing_runtime_variables("DATABASE_URL=\n", &required, EnvironmentName::Staging,),
        ["DATABASE_URL"]
    );
    assert!(
        super::missing_runtime_variables(
            "DATABASE_URL=postgresql://db\n",
            &required,
            EnvironmentName::Staging,
        )
        .is_empty()
    );
    assert_eq!(
        super::missing_runtime_variables(
            "DATABASE_URL=postgresql://localhost/app\n",
            &required,
            EnvironmentName::Staging,
        ),
        ["DATABASE_URL"]
    );
}

#[test]
fn only_internal_application_secrets_are_safe_to_generate() {
    for variable in [
        "AUTH_TOKEN_SECRET",
        "JWT_SECRET",
        "FINAGENT_SESSION_SECRET",
        "COOKIE_SECRET",
        "ENCRYPTION_KEY",
    ] {
        assert!(internal_runtime_secret(variable), "{variable}");
    }
    for variable in [
        "MINIMAX_API_KEY",
        "TCR_PASSWORD",
        "CNB_TOKEN",
        "DATABASE_URL",
    ] {
        assert!(!internal_runtime_secret(variable), "{variable}");
    }
}

#[test]
fn static_build_variables_do_not_block_server_runtime() {
    let project = tempdir().expect("project");
    fs::create_dir_all(project.path().join("src")).expect("source directory");
    fs::write(
            project.path().join("package.json"),
            r#"{"name":"sample-web","scripts":{"dev":"vite","build":"vite build"},"dependencies":{"vite":"1"}}"#,
        )
        .expect("package manifest");
    fs::write(project.path().join("src/main.ts"), "export {};\n").expect("entrypoint");
    fs::write(
        project.path().join(".env.example"),
        "VITE_API_BASE_URL=/api\n",
    )
    .expect("environment example");

    let inspection = deploy_core::inspect_project(project.path()).expect("inspection");
    let manifest = deploy_core::create_default_manifest(&inspection);
    assert!(manifest.services.iter().any(|service| {
        service.kind == deploy_core::model::ServiceKind::Static
            && service
                .runtime_env
                .iter()
                .any(|variable| variable.name == "VITE_API_BASE_URL")
    }));
    assert!(
        !required_runtime_variables(&manifest, EnvironmentName::Production)
            .contains(&"VITE_API_BASE_URL".to_string())
    );
}

#[test]
fn deployment_path_does_not_ask_users_for_managed_ocr_service_urls() {
    let project = tempdir().expect("project");
    fs::write(
        project.path().join("package.json"),
        r#"{"name":"sample-api","scripts":{"start":"node server.js"}}"#,
    )
    .expect("package manifest");
    fs::write(project.path().join("server.js"), "process.exit(0);\n").expect("entrypoint");
    let inspection = deploy_core::inspect_project(project.path()).expect("inspection");
    let mut manifest = deploy_core::create_default_manifest(&inspection);
    manifest.services[0]
        .runtime_env
        .push(deploy_core::model::EnvironmentVariable {
            name: "PP_OCRV6_TINY_URL".to_string(),
            required: true,
            secret: false,
            default: None,
            description: String::new(),
        });
    let mut ocr = manifest.services[0].clone();
    ocr.id = "ocr".to_string();
    ocr.image = "sample-ocr".to_string();
    ocr.container_port = 8000;
    ocr.runtime_env.clear();
    manifest.services.push(ocr);

    assert_eq!(
        deployment_path_managed_runtime_variables(&manifest),
        BTreeSet::from(["PP_OCRV6_TINY_URL".to_string()])
    );
    manifest.services.retain(|service| service.id != "ocr");
    assert!(deployment_path_managed_runtime_variables(&manifest).is_empty());
}

#[test]
fn shared_cnb_secret_repository_uses_project_scoped_filenames() {
    assert_eq!(
        cnb_secret_filename("wxseo", "staging"),
        "env.wxseo.staging.yml"
    );
    assert_eq!(
        cnb_secret_filename("swifteng", "production"),
        "env.swifteng.production.yml"
    );
}

#[test]
fn validates_cnb_repositories_and_release_branches() {
    for repository in ["team/project", "abc_1/project.name", "parent/team/project"] {
        assert!(validate_repository_slug(repository).is_ok());
    }
    for repository in [
        "project",
        "team/project name",
        "../project",
        "team//project",
    ] {
        assert!(validate_repository_slug(repository).is_err());
    }
    for branch in ["main", "release/v1.2", "feature_123"] {
        assert!(validate_git_branch(branch).is_ok());
    }
    for branch in [
        "",
        "-force",
        "../main",
        "main..next",
        "main@{1}",
        "main name",
    ] {
        assert!(validate_git_branch(branch).is_err());
    }
}

#[test]
fn uses_cnb_organization_namespace_instead_of_login_username() {
    let account = cnb_account_from_responses(
        &json!({
            "username": "cnb.boxuDF6MQHA",
            "nickname": "马成龙"
        }),
        &json!({
            "data": [
                {
                    "path": "read-only-team",
                    "name": "只读团队",
                    "access_role": "Guest",
                    "freeze": false
                },
                {
                    "path": "blacksco0920",
                    "name": "blacksco0920",
                    "access_role": "Owner",
                    "freeze": false
                }
            ]
        }),
    );

    assert_eq!(account.username, "cnb.boxuDF6MQHA");
    assert_eq!(account.default_namespace, "blacksco0920");
    assert_eq!(account.namespaces[0].path, "blacksco0920");
    assert!(account.namespaces[0].can_create_repository);
}

#[test]
fn caches_only_the_non_secret_cnb_account_summary() {
    let directory = tempdir().expect("temp app data");
    let state =
        WorkspaceState::open(&directory.path().join("workspace.sqlite3")).expect("workspace state");
    let account = cnb_account_from_responses(
        &json!({
            "username": "cnb.user",
            "nickname": "示例用户"
        }),
        &json!({
            "data": [{
                "path": "example-team",
                "name": "示例团队",
                "access_role": "Owner",
                "freeze": false
            }]
        }),
    );

    remember_cnb_account(&state, &account).expect("remember account");

    assert_eq!(cached_cnb_account(&state), Some(account));
    let stored = state
        .setting(CNB_ACCOUNT_CACHE_KEY)
        .expect("read setting")
        .expect("cached account");
    assert!(!stored.to_ascii_lowercase().contains("token"));
    assert!(!stored.contains("secret"));

    state
        .set_setting(CNB_ACCOUNT_CACHE_KEY, "not-json")
        .expect("store invalid legacy value");
    assert_eq!(cached_cnb_account(&state), None);
}

#[test]
fn reuses_existing_cnb_repository_case_insensitively() {
    let repositories = json!({
        "data": [
            {"name": "FinAgent", "path": "blacksco0920/FinAgent"},
            {"name": "other", "path": "blacksco0920/other"}
        ]
    });

    assert_eq!(
        existing_cnb_repository(&repositories, "blacksco0920", "finagent").as_deref(),
        Some("blacksco0920/FinAgent")
    );
}

#[test]
fn maps_cnb_api_failures_without_exposing_raw_response_bodies() {
    let message = cnb_public_error(DeployError::CnbApi {
        status: 404,
        message: r#"{"errcode":5,"errmsg":"Resource not found."}"#.to_string(),
    });

    assert_eq!(
        message,
        "AD-CNB-104：CNB 中找不到所选组织或仓库，请重新选择组织"
    );
    assert!(!message.contains("Resource not found"));

    let permission = cnb_public_error(DeployError::CnbApi {
        status: 403,
        message: r#"{"errmsg":"Missing required scopes: repo-cnb-trigger:rw"}"#.to_string(),
    });
    assert_eq!(
        permission,
        "AD-CNB-103：CNB 授权缺少“触发构建”权限（repo-cnb-trigger:rw）"
    );
    assert!(!permission.contains("Missing required scopes"));

    let build_detail = cnb_public_error(DeployError::CnbApi {
            status: 403,
            message: r#"{"errmsg":"Missing required scopes: repo-code:rw, repo-cnb-detail:r","repository":"private-name"}"#
                .to_string(),
        });
    assert_eq!(
        build_detail,
        "AD-CNB-103：CNB 授权缺少以下权限：repo-code:rw、repo-cnb-detail:r"
    );
    assert!(!build_detail.contains("private-name"));

    let history = cnb_build_history_error(DeployError::CnbApi {
        status: 403,
        message: "[NO_RIGHT]Token scope not match".to_string(),
    });
    assert_eq!(
        history,
        "AD-CNB-103：CNB 拒绝读取这个仓库的构建记录；令牌的授权范围（scope）或使用范围可能不匹配当前仓库，请检查 CNB 授权设置"
    );

    let explicit_history = cnb_build_history_error(DeployError::CnbApi {
        status: 403,
        message: "权限不足。缺少授权范围：repo-cnb-history:r。".to_string(),
    });
    assert_eq!(
        explicit_history,
        "AD-CNB-103：CNB 授权缺少“构建记录读取”权限（repo-cnb-history:r）"
    );
}

#[test]
fn cnb_token_selection_prefers_current_ui_then_saved_connection() {
    assert_eq!(
        resolve_cnb_token_sources(
            "  ui-token  ",
            StoredCnbToken::Unavailable,
            Some("environment-token"),
            Some("git-token")
        )
        .expect("provided token must short-circuit unavailable storage")
        .as_deref(),
        Some("ui-token")
    );
    assert_eq!(
        resolve_cnb_token_sources(
            "",
            StoredCnbToken::Present(" saved-token "),
            Some("environment-token"),
            Some("git-token")
        )
        .expect("stored token")
        .as_deref(),
        Some("saved-token")
    );
    assert_eq!(
        resolve_cnb_token_sources(
            "",
            StoredCnbToken::Missing,
            Some("environment-token"),
            Some("git-token")
        )
        .expect("missing storage may fall back")
        .as_deref(),
        Some("environment-token")
    );
    assert_eq!(
        resolve_cnb_token_sources(
            "",
            StoredCnbToken::Present("  "),
            Some("  "),
            Some(" git-token ")
        )
        .expect("empty storage may fall back")
        .as_deref(),
        Some("git-token")
    );
    assert_eq!(
        resolve_cnb_token_sources(
            "",
            StoredCnbToken::Unavailable,
            Some("stale-environment-token"),
            Some("stale-git-token")
        ),
        Err(CnbTokenResolutionError::StoredCredentialUnavailable)
    );
    assert_eq!(
        CNB_KEYCHAIN_UNAVAILABLE_ERROR,
        "AD-CNB-108：无法读取系统密钥库中的 CNB 授权，请重新打开应用；仍未恢复时更新 CNB 授权"
    );
}

#[test]
fn cnb_keyring_failures_use_safe_distinct_issue_codes() {
    assert_eq!(
        cnb_keyring_issue("missing"),
        ("AD-CNB-101", "CNB 登录已失效，请重新连接后继续")
    );
    let raw_error = "User interaction is not allowed for account secret-token";
    let unavailable = cnb_keyring_issue(raw_error);
    assert_eq!(unavailable.0, "AD-CNB-108");
    assert_eq!(unavailable.1, CNB_KEYCHAIN_UNAVAILABLE_ERROR);
    assert!(!unavailable.1.contains(raw_error));
    assert!(!unavailable.1.contains("secret-token"));
}

#[test]
fn cnb_connection_metadata_failures_do_not_reject_a_saved_token() {
    let remember_attempted = Cell::new(false);
    let mark_attempted = Cell::new(false);
    save_cnb_connection_metadata_best_effort(
        || {
            remember_attempted.set(true);
            Err("summary database unavailable".to_string())
        },
        || {
            mark_attempted.set(true);
            Err("connection database unavailable".to_string())
        },
    );
    assert!(remember_attempted.get());
    assert!(mark_attempted.get());
}

#[test]
fn only_generated_deployment_files_are_owned() {
    for path in [
        "deploy.yaml",
        ".cnb.yml",
        ".cnb/tag_deploy.yml",
        ".github/workflows/sync-cnb.yml",
        ".dockerignore",
        ".deploydesk/.gitignore",
        ".deploydesk/generated/staging/Caddyfile",
    ] {
        assert!(is_deployment_owned_path(path), "{path}");
    }
    for path in [
        "src/App.tsx",
        ".env",
        ".github/workflows/release.yml",
        ".deploydesk/backups/plan/deploy.yaml",
    ] {
        assert!(!is_deployment_owned_path(path), "{path}");
    }
    for path in [
        ".deploydesk/backups/plan/deploy.yaml",
        ".deploydesk/runtime/staging/.runtime.env",
        ".deploydesk/state/last-plan.json",
    ] {
        assert!(is_deployment_internal_path(path), "{path}");
    }
    assert!(!is_deployment_internal_path(
        ".deploydesk/generated/staging/Caddyfile"
    ));
}

#[test]
fn deployment_snapshot_contains_working_tree_without_mutating_user_git_state() {
    let project = tempfile::tempdir().expect("project");
    fs::write(project.path().join("app.txt"), "old\n").expect("app");
    fs::write(project.path().join("legacy.pem"), "private\n").expect("legacy secret");
    let mut init = system_command("git");
    init.current_dir(project.path()).args(["init", "--quiet"]);
    run_git_command(init, "init").expect("init");
    let mut add = system_command("git");
    add.current_dir(project.path()).args(["add", "--all"]);
    run_git_command(add, "add").expect("add");
    let mut commit = system_command("git");
    commit.current_dir(project.path()).args([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "initial",
    ]);
    run_git_command(commit, "commit").expect("commit");

    fs::write(project.path().join("app.txt"), "current\n").expect("change app");
    fs::write(project.path().join("new.txt"), "new\n").expect("new file");
    fs::write(project.path().join(".env"), "TOKEN=do-not-push\n").expect("env");
    fs::write(project.path().join("staged.txt"), "staged\n").expect("staged file");
    let mut stage = system_command("git");
    stage
        .current_dir(project.path())
        .args(["add", "staged.txt"]);
    run_git_command(stage, "stage").expect("stage");
    fs::write(project.path().join("staged.txt"), "working\n").expect("working file");

    let head_before = git_stdout(project.path(), &["rev-parse", "HEAD"]).expect("head");
    let index_before =
        git_stdout(project.path(), &["diff", "--cached", "--binary"]).expect("index");
    let (snapshot, created) =
        create_deployment_git_snapshot(project.path(), &[], None).expect("snapshot");
    assert!(created);
    assert_eq!(
        git_stdout(project.path(), &["rev-parse", "HEAD"]).expect("head after"),
        head_before
    );
    assert_eq!(
        git_stdout(project.path(), &["diff", "--cached", "--binary"]).expect("index after"),
        index_before
    );
    assert_eq!(
        git_stdout(project.path(), &["show", &format!("{snapshot}:app.txt")])
            .expect("snapshot app"),
        "current\n"
    );
    assert_eq!(
        git_stdout(project.path(), &["show", &format!("{snapshot}:staged.txt")])
            .expect("snapshot staged"),
        "working\n"
    );
    assert!(
        system_command("git")
            .current_dir(project.path())
            .args(["cat-file", "-e", &format!("{snapshot}:.env")])
            .status()
            .is_ok_and(|status| !status.success())
    );
    assert!(
        system_command("git")
            .current_dir(project.path())
            .args(["cat-file", "-e", &format!("{snapshot}:legacy.pem")])
            .status()
            .is_ok_and(|status| !status.success())
    );
}

#[test]
fn deployment_snapshots_continue_from_a_verified_remote_snapshot_parent() {
    let project = tempfile::tempdir().expect("project");
    fs::write(project.path().join("app.txt"), "initial\n").expect("app");
    let mut init = system_command("git");
    init.current_dir(project.path()).args(["init", "--quiet"]);
    run_git_command(init, "init").expect("init");
    let mut add = system_command("git");
    add.current_dir(project.path()).args(["add", "--all"]);
    run_git_command(add, "add").expect("add");
    let mut commit = system_command("git");
    commit.current_dir(project.path()).args([
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "initial",
    ]);
    run_git_command(commit, "commit").expect("commit");

    fs::write(project.path().join("app.txt"), "snapshot one\n").expect("first change");
    let (first, first_created) =
        create_deployment_git_snapshot(project.path(), &[], None).expect("first snapshot");
    assert!(first_created);
    let (unchanged, unchanged_created) =
        create_deployment_git_snapshot(project.path(), &[], Some(&first))
            .expect("unchanged snapshot");
    assert_eq!(unchanged, first);
    assert!(!unchanged_created);

    fs::write(project.path().join("app.txt"), "snapshot two\n").expect("second change");
    let (second, second_created) =
        create_deployment_git_snapshot(project.path(), &[], Some(&first)).expect("second snapshot");
    assert!(second_created);
    assert_eq!(
        git_stdout(project.path(), &["show", "-s", "--format=%P", &second])
            .expect("parent")
            .trim(),
        first
    );
    assert_eq!(
        git_stdout(project.path(), &["show", &format!("{second}:app.txt")])
            .expect("second content"),
        "snapshot two\n"
    );
}

#[test]
fn maps_diverged_cnb_pushes_to_a_recoverable_error() {
    let message = git_failure(
            "同步代码到 CNB",
            b"",
            b"To https://cnb.cool/team/project.git\n ! [rejected] HEAD -> main (non-fast-forward)\nerror: failed to push some refs\n",
        );

    assert!(message.starts_with("AD-GIT-102"));
    assert!(!message.contains("https://"));
}

#[test]
fn uses_git_stdout_when_stderr_only_contains_the_remote_destination() {
    let message = git_failure(
        "同步代码到 CNB",
        b"remote: branch protection denied this update\n",
        b"To https://cnb.cool/team/project.git\n",
    );

    assert_eq!(
        message,
        "同步代码到 CNB未完成：remote: branch protection denied this update"
    );
    assert!(!message.contains("https://"));
}

#[test]
fn includes_cnb_deployment_approval_in_the_automatic_commit() {
    let project = tempdir().expect("temp project");
    fs::create_dir_all(project.path().join(".cnb")).expect("create cnb directory");
    fs::write(
        project.path().join(".cnb/tag_deploy.yml"),
        "deployments: []\n",
    )
    .expect("write deployment config");

    let paths = deployment_owned_paths(project.path());
    assert!(paths.contains(&".cnb/tag_deploy.yml".to_string()));
}

#[test]
fn initializes_a_new_project_and_keeps_local_secrets_out_of_git() {
    let project = tempdir().expect("temp project");
    fs::write(project.path().join("app.ts"), "console.log('ready')\n").expect("source file");
    fs::write(project.path().join(".env"), "TOKEN=real-secret\n").expect("local env");
    fs::write(project.path().join(".env.example"), "TOKEN=\n").expect("env example");

    assert!(ensure_git_repository_for_sync(project.path(), "main").expect("initialize project"));
    assert!(!ensure_git_repository_for_sync(project.path(), "main").expect("reuse project"));

    let tracked = Command::new("git")
        .current_dir(project.path())
        .args(["ls-files"])
        .output()
        .expect("list tracked files");
    let tracked = String::from_utf8(tracked.stdout).expect("utf8 files");
    assert!(tracked.lines().any(|line| line == "app.ts"));
    assert!(tracked.lines().any(|line| line == ".env.example"));
    assert!(!tracked.lines().any(|line| line == ".env"));

    let branch = Command::new("git")
        .current_dir(project.path())
        .args(["branch", "--show-current"])
        .output()
        .expect("read branch");
    assert_eq!(String::from_utf8_lossy(&branch.stdout).trim(), "main");
}

#[test]
fn does_not_create_a_nested_repository_inside_an_existing_project() {
    let project = tempdir().expect("temp project");
    let nested = project.path().join("apps/web");
    fs::create_dir_all(&nested).expect("nested directory");
    assert!(
        Command::new("git")
            .current_dir(project.path())
            .args(["init", "--quiet"])
            .status()
            .expect("initialize parent")
            .success()
    );

    let error = ensure_git_repository_for_sync(&nested, "main")
        .expect_err("nested project should require the repository root");
    assert!(error.starts_with("AD-GIT-103"));
    assert!(!nested.join(".git").exists());
}

#[test]
fn stages_generated_build_files_even_when_project_ignores_build_directories() {
    let project = tempdir().expect("temp project");
    fs::create_dir_all(project.path().join(".deploydesk/generated/build"))
        .expect("create generated build directory");
    fs::write(project.path().join(".gitignore"), "build/\n").expect("write gitignore");
    fs::write(
        project
            .path()
            .join(".deploydesk/generated/build/Dockerfile.api"),
        "FROM scratch\n",
    )
    .expect("write generated Dockerfile");
    assert!(
        Command::new("git")
            .current_dir(project.path())
            .args(["init", "-q"])
            .status()
            .expect("initialize git")
            .success()
    );

    let paths = deployment_owned_paths(project.path());
    stage_deployment_owned_files(project.path(), &paths).expect("stage deployment files");

    let tracked = Command::new("git")
        .current_dir(project.path())
        .args(["ls-files", "--stage"])
        .output()
        .expect("list staged files");
    let tracked = String::from_utf8(tracked.stdout).expect("utf8 git output");
    assert!(
        tracked.contains(".deploydesk/generated/build/Dockerfile.api"),
        "{tracked}"
    );
}

#[test]
fn classifies_main_pushes_as_independent_deployment_path_builds() {
    for event in ["push", "git_push", "api_trigger_deployment_path_build"] {
        assert_eq!(build_environment_for_event(event), Some("deployment"));
    }
    for event in ["api_trigger_staging", "tag_deploy.staging"] {
        assert_eq!(build_environment_for_event(event), Some("staging"));
    }
    for event in ["api_trigger_production", "tag_deploy.production"] {
        assert_eq!(build_environment_for_event(event), Some("production"));
    }
    assert_eq!(build_environment_for_event("pull_request"), None);
    assert!(is_production_approval_build(&CnbBuildRecord {
        serial: "approval-1".to_string(),
        event: "push".to_string(),
        status: "success".to_string(),
        revision: Some("0123456789abcdef0123456789abcdef01234567".to_string()),
        source_ref: Some("deploydesk-production".to_string()),
        title: "production approval".to_string(),
        created_at: None,
    }));
    assert!(!is_production_approval_build(&CnbBuildRecord {
        serial: "staging-1".to_string(),
        event: "push".to_string(),
        status: "success".to_string(),
        revision: Some("0123456789abcdef0123456789abcdef01234567".to_string()),
        source_ref: Some("main".to_string()),
        title: "staging".to_string(),
        created_at: None,
    }));
}

#[test]
fn legacy_history_sync_never_overwrites_a_bound_deployment_path_run() {
    assert!(deployment_path_owns_history_reconciliation(
        "deployment",
        true
    ));
    assert!(!deployment_path_owns_history_reconciliation(
        "deployment",
        false
    ));
    assert!(!deployment_path_owns_history_reconciliation(
        "staging", true
    ));
    assert!(!deployment_path_owns_history_reconciliation(
        "production",
        true
    ));
}

#[test]
fn imports_cnb_history_oldest_first_and_keeps_latest_result_per_line_kind() {
    let payload = json!({
        "data": [
            {
                "sn": "approval",
                "event": "push",
                "status": "success",
                "sourceRef": "deploydesk-production",
                "createTime": "2026-07-04T00:00:00Z"
            },
            {
                "sn": "production-new",
                "event": "api_trigger_production",
                "status": "success",
                "createTime": "2026-07-03T00:00:00Z"
            },
            {
                "sn": "staging-new",
                "event": "push",
                "status": "success",
                "sourceRef": "main",
                "createTime": "2026-07-02T00:00:00Z"
            },
            {
                "sn": "production-old",
                "event": "api_trigger_production",
                "status": "success",
                "createTime": "2026-07-01T00:00:00Z"
            },
            {
                "sn": "staging-old",
                "event": "push",
                "status": "success",
                "sourceRef": "main",
                "createTime": "2026-07-01T00:00:00Z"
            }
        ]
    });
    let records = ordered_build_records(&payload);
    assert_eq!(
        records
            .iter()
            .map(|record| record.serial.as_str())
            .collect::<Vec<_>>(),
        vec![
            "staging-old",
            "production-old",
            "staging-new",
            "production-new",
            "approval"
        ]
    );
    assert_eq!(
        latest_success_serials_by_environment(&records),
        BTreeMap::from([
            ("deployment", "staging-new".to_string()),
            ("production", "production-new".to_string()),
        ])
    );
}

#[test]
fn recovers_only_staging_builds_for_the_pushed_revision() {
    let revision = "0123456789abcdef0123456789abcdef01234567";
    let payload = serde_json::json!({
        "data": [
            {
                "sn": "production-1",
                "event": "api_trigger_production",
                "status": "running",
                "sha": revision
            },
            {
                "sn": "push-2",
                "event": "push",
                "status": "running",
                "sha": revision
            }
        ]
    });

    assert_eq!(
        build_serial_for_revision(&payload, revision, "staging").as_deref(),
        Some("push-2")
    );
    assert_eq!(
        build_serial_for_revision(&payload, revision, "production").as_deref(),
        Some("production-1")
    );
    assert!(
        build_serial_for_revision(
            &payload,
            "fedcba9876543210fedcba9876543210fedcba98",
            "staging"
        )
        .is_none()
    );
}

#[test]
fn cloud_setup_is_required_until_both_secret_imports_are_real() {
    let raw = r#"
version: 1
project:
  name: sample
source:
  provider: local
  repository: ""
  release_branch: main
services: []
environments:
  development:
    target: { kind: local, namespace: sample-development }
  staging:
    target: { kind: server, server: default, namespace: sample-staging }
    secrets_ref: https://cnb.cool/team/sample-secrets/-/blob/main/env.staging.yml
  production:
    target: { kind: server, server: default, namespace: sample-production }
    approval_required: true
    secrets_ref: https://cnb.cool/team/sample-secrets/-/blob/main/env.production.yml
providers:
  build: { kind: cnb, repository: team/sample }
  registry: { kind: cnb, repository: team/sample }
"#;
    let mut manifest =
        deploy_core::parse_manifest(raw, Path::new("deploy.yaml")).expect("valid manifest fixture");
    assert!(!cloud_setup_required(&manifest));

    manifest.environments.production.secrets_ref = None;
    assert!(cloud_setup_required(&manifest));
    manifest.environments.production.secrets_ref =
        Some("https://cnb.cool/replace-me/secret/-/blob/main/env.production.yml".to_string());
    assert!(cloud_setup_required(&manifest));
}

#[test]
fn rollback_changes_only_release_images_and_restores_on_failure() {
    let script = rollback_script("sample", "production");
    assert!(script.contains("$HOME/.deploydesk/apps/sample/production"));
    assert!(script.contains("cp \"$previous_file\" .release.env"));
    assert!(script.contains("cp .release.env.before-rollback .release.env"));
    assert!(script.contains("docker compose --env-file .release.env"));
    assert!(!script.contains("cp \"$previous_file\" .runtime.env"));
    assert!(!script.contains("Caddyfile"));
}

#[test]
fn public_route_failures_pause_without_rebuilding() {
    let mut deployment = run();
    deployment.status = "success".to_string();
    deployment.completed_steps.push("healthcheck".to_string());
    apply_public_route_checks(
        &mut deployment,
        &[PublicRouteStatus {
            host: "app.example.com".to_string(),
            url: "https://app.example.com/".to_string(),
            reachable: false,
            phase: "dns".to_string(),
            http_status: None,
            message: "app.example.com 尚未解析".to_string(),
        }],
    );

    assert_eq!(deployment.status, "needs_action");
    assert_eq!(deployment.action_kind.as_deref(), Some("route-check"));
    assert_eq!(deployment.current_stage, "healthcheck");
    assert!(
        !deployment
            .completed_steps
            .contains(&"healthcheck".to_string())
    );
    assert!(deployment.message.contains("尚未解析"));
    assert!(deployment.message.contains("应用已经部署成功"));
}

#[tokio::test]
async fn route_inspection_failures_preserve_the_last_per_address_results() {
    let directory = tempdir().expect("temporary workspace");
    let state =
        WorkspaceState::open(&directory.path().join("workspace.sqlite3")).expect("open workspace");
    let mut deployment = run();
    deployment.project_path = directory
        .path()
        .join("missing-project")
        .to_string_lossy()
        .into_owned();
    deployment.route_checks = vec![PublicRouteStatus {
        host: "app.example.com".to_string(),
        url: "https://app.example.com/".to_string(),
        phase: "ready".to_string(),
        reachable: true,
        http_status: Some(200),
        message: "上次检查可访问".to_string(),
    }];
    let previous = deployment.route_checks.clone();

    verify_public_routes(&mut deployment, &state)
        .await
        .expect("invalid snapshot becomes a durable task");

    assert_eq!(deployment.route_checks, previous);
    assert_eq!(deployment.status, "needs_action");
}

#[test]
fn repaired_deployment_path_drops_the_previous_issue_code() {
    let directory = tempdir().expect("temporary workspace");
    let state =
        WorkspaceState::open(&directory.path().join("workspace.sqlite3")).expect("open workspace");
    let mut deployment = run();
    deployment.project_path = directory
        .path()
        .canonicalize()
        .expect("canonical project path")
        .to_string_lossy()
        .into_owned();
    deployment.environment = "deployment".to_string();
    deployment.status = "needs_action".to_string();
    deployment.current_stage = "local".to_string();
    deployment.issue_code = Some("AD-GIT-102".to_string());
    deployment.action_kind = Some("deployment-path-source-retry".to_string());
    state
        .remember_project(directory.path(), "sample", true, 1)
        .expect("remember project");
    state
        .save_deployment_run(&deployment)
        .expect("save interrupted run");

    let repaired = prepare_deployment_path_retry_inner(deployment.id, "server".to_string(), &state)
        .expect("prepare retry");

    assert_eq!(repaired.current_stage, "server");
    assert_eq!(repaired.issue_code, None);
    assert_eq!(
        repaired.action_kind.as_deref(),
        Some("deployment-path-retry")
    );
}

#[test]
fn repaired_deployment_path_routes_keep_existing_artifacts_on_the_server() {
    let directory = tempdir().expect("temporary workspace");
    let state =
        WorkspaceState::open(&directory.path().join("workspace.sqlite3")).expect("open workspace");
    let mut deployment = run();
    deployment.project_path = directory
        .path()
        .canonicalize()
        .expect("canonical project path")
        .to_string_lossy()
        .into_owned();
    deployment.environment = "deployment".to_string();
    deployment.status = "needs_action".to_string();
    deployment.current_stage = "server".to_string();
    deployment.issue_code = Some("AD-NET-201".to_string());
    deployment.action_kind = Some("deployment-path-route-check".to_string());
    deployment.artifacts.push(DeploymentArtifact {
        service: "web".to_string(),
        image: "registry.example.com/sample/web".to_string(),
        digest: format!("sha256:{}", "a".repeat(64)),
    });
    state
        .remember_project(directory.path(), "sample", true, 1)
        .expect("remember project");
    state
        .save_deployment_run(&deployment)
        .expect("save interrupted run");

    let repaired = prepare_deployment_path_retry_inner(deployment.id, "routes".to_string(), &state)
        .expect("prepare route retry");

    assert_eq!(repaired.current_stage, "server");
    assert_eq!(repaired.artifacts.len(), 1);
    assert_eq!(repaired.issue_code, None);
    assert_eq!(
        repaired.action_kind.as_deref(),
        Some("deployment-path-retry")
    );
    assert!(repaired.message.contains("访问地址"));
}

#[test]
fn interrupted_first_route_check_preserves_the_deployed_version() {
    let mut deployment = run();
    deployment.environment = "production".to_string();
    deployment.status = "success".to_string();
    deployment.current_stage = "complete".to_string();
    deployment.artifacts.push(DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:abc".to_string(),
    });

    pause_public_route_inspection(&mut deployment, "本机网络暂时不可用");

    assert_eq!(deployment.status, "needs_action");
    assert_eq!(deployment.action_kind.as_deref(), Some("route-check"));
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-NET-202"));
    assert_eq!(deployment.artifacts.len(), 1);
    assert!(deployment.message.contains("服务已经部署"));
    assert!(deployment.message.contains("网络恢复后会自动继续"));
}

#[test]
fn certificate_retry_requires_dns_ready_https_only_failures() {
    let status = |host: &str, phase: &str, reachable: bool| PublicRouteStatus {
        host: host.to_string(),
        url: format!("https://{host}/"),
        phase: phase.to_string(),
        reachable,
        http_status: reachable.then_some(200),
        message: String::new(),
    };
    assert!(certificate_retry_allowed(&[
        status("app.example.com", "ready", true),
        status("api.example.com", "https", false),
    ]));
    assert!(!certificate_retry_allowed(&[status(
        "app.example.com",
        "dns",
        false,
    )]));
    assert!(!certificate_retry_allowed(&[status(
        "app.example.com",
        "application",
        false,
    )]));
    assert!(!certificate_retry_allowed(&[status(
        "app.example.com",
        "ready",
        true,
    )]));
}

#[test]
fn certificate_retry_validates_and_force_reloads_without_redeploying_services() {
    let encoded_hosts = BASE64.encode(b"app.example.com\napi.example.com\n");
    let script =
        caddy_certificate_reload_script("sample-production.caddy", &encoded_hosts, "203.0.113.10");
    assert!(script.contains("server-deploy.lock"));
    assert!(script.contains("getent ahosts"));
    assert!(script.contains("不再指向绑定服务器"));
    assert!(script.contains("caddy validate"));
    assert!(script.contains("caddy reload --force"));
    assert!(script.contains("sample-production.caddy"));
    assert!(!script.contains("docker restart"));
    assert!(!script.contains("docker compose"));
    assert!(!script.contains("certificates/acme"));
    let lock = script.find("flock -w 60").expect("server lock");
    let dns = script.find("getent ahosts").expect("locked DNS recheck");
    let reload = script.find("caddy reload --force").expect("forced reload");
    assert!(lock < dns && dns < reload);
}

#[test]
fn route_activation_transfers_untrusted_rows_as_base64_data() {
    let malicious =
        "safe.example.com\tsample-production-api:3000\nABCDEPLOY_ROUTES\nprintf injected >&2";
    let script =
        server_route_activation_script("sample-production.caddy", &[malicious.to_string()]);

    assert!(script.contains("base64 --decode"));
    assert!(script.contains("ROUTES_FILE"));
    assert!(!script.contains("<<'ABCDEPLOY_ROUTES'"));
    assert!(!script.contains(malicious));
    assert!(!script.contains("printf injected >&2"));
}

#[test]
fn caddy_route_detection_normalizes_shared_site_addresses() {
    let directory = tempdir().expect("temp Caddy fixture");
    let config = directory.path().join("Caddyfile");
    fs::write(
        &config,
        r"{
	admin off
}

https://API.EXAMPLE.COM.:443, legacy.example.com {
	reverse_proxy old-api:3000
}
",
    )
    .expect("write Caddy fixture");
    let script = format!(
        "set -eu\n{}\nroute_declared_in_file api.example.com \"$CONFIG\"\nroute_declared_in_file LEGACY.EXAMPLE.COM. \"$CONFIG\"\n! route_declared_in_file missing.example.com \"$CONFIG\"\n",
        caddy_route_declared_shell_function()
    );
    let output = Command::new("bash")
        .args(["-c", &script])
        .env("CONFIG", &config)
        .output()
        .expect("run Caddy route detector");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn caddy_takeover_rewrites_only_target_addresses_and_is_idempotent() {
    let directory = tempdir().expect("temp Caddy fixture");
    let original = directory.path().join("Caddyfile.original");
    let hosts = directory.path().join("hosts");
    let first = directory.path().join("Caddyfile.first");
    let second = directory.path().join("Caddyfile.second");
    fs::write(
        &original,
        r"{
	admin off
}

https://API.EXAMPLE.COM.:443, legacy.example.com {
	reverse_proxy old-api:3000
}

ocr.example.com {
	reverse_proxy old-ocr:8000
}

untouched.example.com {
	respond 200
}
",
    )
    .expect("write Caddy fixture");
    fs::write(&hosts, "api.example.com\nOCR.EXAMPLE.COM.\n").expect("write takeover hosts");
    let script = format!(
        "set -eu\n{}\nrewrite_caddy_main_routes \"$HOSTS\" \"$INPUT\" \"$FIRST\"\nrewrite_caddy_main_routes \"$HOSTS\" \"$FIRST\" \"$SECOND\"\n",
        caddy_main_route_rewrite_shell_function()
    );
    let output = Command::new("bash")
        .args(["-c", &script])
        .env("HOSTS", &hosts)
        .env("INPUT", &original)
        .env("FIRST", &first)
        .env("SECOND", &second)
        .output()
        .expect("run Caddy route takeover rewrite");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let first_content = fs::read_to_string(&first).expect("read rewritten Caddyfile");
    let second_content = fs::read_to_string(&second).expect("read idempotent Caddyfile");
    assert!(
        !first_content
            .to_ascii_lowercase()
            .contains("api.example.com")
    );
    assert!(!first_content.contains("ocr.example.com"));
    assert!(first_content.contains("legacy.example.com {"));
    assert!(first_content.contains("reverse_proxy old-api:3000"));
    assert!(first_content.contains("untouched.example.com"));
    assert!(first_content.contains("respond 200"));
    assert_eq!(first_content, second_content);
}

#[test]
fn routing_manifest_validation_rejects_a_host_with_embedded_commands() {
    let raw = r#"version: 1
project: { name: sample }
source: { provider: local, repository: "", release_branch: main }
services:
  - id: api
    kind: api
    image: sample-api
    context: .
    dockerfile: Dockerfile
    container_port: 3000
    healthcheck: { path: /health }
environments:
  development: { target: { kind: local, namespace: sample-development } }
  staging:
    target: { kind: server, server: default, namespace: sample-staging }
    secrets_ref: https://cnb.cool/team/sample-secrets/-/blob/main/env.staging.yml
    domains: []
  production:
    target: { kind: server, server: default, namespace: sample-production }
    secrets_ref: https://cnb.cool/team/sample-secrets/-/blob/main/env.production.yml
    domains: [{ service: api, host: app.example.com, path: / }]
providers:
  build: { kind: cnb, repository: team/sample }
  registry: { kind: cnb, repository: team/sample }
"#;
    let mut manifest =
        deploy_core::parse_manifest(raw, Path::new("deploy.yaml")).expect("parse routing manifest");
    let mut unsafe_project = manifest.clone();
    unsafe_project.project.name = "sample\nABCDEPLOY_HOSTS\nprintf injected >&2".to_string();
    let project_error = validate_deployment_routing_manifest(&unsafe_project, "当前项目")
        .expect_err("unsafe project name must be rejected before SSH");
    assert!(project_error.contains("当前项目"));
    assert!(!project_error.contains("printf injected"));

    manifest.environments.production.domains[0].host =
        "app.example.com\nprintf injected >&2".to_string();

    let error = validate_deployment_routing_manifest(&manifest, "当前项目")
        .expect_err("unsafe host must be rejected before SSH");

    assert!(error.contains("当前项目"));
    assert!(error.contains("域名只填写主机名"));
    assert!(!error.contains("printf injected"));
}

#[test]
fn interrupted_route_checks_use_the_check_phase_contract() {
    let production = interrupted_public_route_status("app.example.com", "/health");
    assert_eq!(production.phase, "check");
    assert_eq!(production.url, "https://app.example.com/health");
    assert_eq!(
        interrupted_route_check_message(std::slice::from_ref(&production)).as_deref(),
        Some("app.example.com 的地址检查被中断，请重新检查")
    );

    let staging = interrupted_public_route_status("app.203-0-113-10.sslip.io", "/");
    assert_eq!(staging.phase, "check");
    assert_eq!(staging.url, "http://app.203-0-113-10.sslip.io/");
}

#[test]
fn multiple_public_route_failures_are_reported_together() {
    let mut deployment = run();
    deployment.status = "success".to_string();
    deployment.completed_steps.push("healthcheck".to_string());
    apply_public_route_checks(
        &mut deployment,
        &[
            PublicRouteStatus {
                host: "app.example.com".to_string(),
                url: "https://app.example.com/".to_string(),
                reachable: false,
                phase: "dns".to_string(),
                http_status: None,
                message: "app.example.com 尚未解析，请添加 A 记录".to_string(),
            },
            PublicRouteStatus {
                host: "api.example.com".to_string(),
                url: "https://api.example.com/".to_string(),
                reachable: false,
                phase: "dns".to_string(),
                http_status: None,
                message: "api.example.com 尚未解析，请添加 A 记录".to_string(),
            },
        ],
    );

    assert_eq!(deployment.status, "needs_action");
    assert!(deployment.message.contains("2 个访问地址暂未就绪"));
    assert!(deployment.message.contains("app.example.com 尚未解析"));
    assert!(deployment.message.contains("api.example.com 尚未解析"));
    assert!(deployment.message.contains("应用已经部署成功"));
}

#[test]
fn every_route_attention_state_rechecks_public_addresses() {
    for action in ["route-check", "route-repair", "route-takeover"] {
        assert!(deployment_needs_public_route_recheck(Some(action)));
    }
    assert!(!deployment_needs_public_route_recheck(Some("cnb-auth")));
    assert!(!deployment_needs_public_route_recheck(None));
}

#[test]
fn route_problems_are_kept_per_address_and_takeover_wins_over_repair() {
    let ready = |host: &str| PublicRouteStatus {
        host: host.to_string(),
        url: format!("https://{host}/"),
        reachable: true,
        phase: "ready".to_string(),
        http_status: Some(200),
        message: format!("{host} 可以访问"),
    };
    let mut checks = vec![
        ready("api.example.com"),
        ready("h5.example.com"),
        ready("ocr.example.com"),
    ];
    let problems = vec![
        ServerRouteProblem {
            kind: ServerRouteProblemKind::Takeover,
            host: "api.example.com".to_string(),
            message: "api.example.com 仍由旧服务提供".to_string(),
        },
        ServerRouteProblem {
            kind: ServerRouteProblemKind::Repair,
            host: "h5.example.com".to_string(),
            message: "h5.example.com 尚未启用".to_string(),
        },
    ];

    overlay_server_route_problems(&mut checks, &problems);

    assert_eq!(checks[0].phase, "route-conflict");
    assert!(!checks[0].reachable);
    assert_eq!(checks[1].phase, "route-missing");
    assert!(!checks[1].reachable);
    assert_eq!(checks[2].phase, "ready");
    assert!(checks[2].reachable);

    let mut deployment = run();
    deployment.status = "success".to_string();
    assert!(apply_server_route_problems(&mut deployment, &problems));
    assert_eq!(deployment.action_kind.as_deref(), Some("route-takeover"));
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-SRV-206"));
    assert!(deployment.message.contains("api.example.com"));
    assert!(
        deployment
            .message
            .contains("另外 1 个未冲突地址尚未启用，可以先单独恢复")
    );
}

#[test]
fn missing_caddy_route_requires_a_route_only_repair() {
    let mut deployment = run();
    deployment.status = "success".to_string();
    deployment.completed_steps.push("healthcheck".to_string());

    apply_server_route_problem(&mut deployment, "app.example.com 还没有加载到统一 Caddy");

    assert_eq!(deployment.status, "needs_action");
    assert_eq!(deployment.action_kind.as_deref(), Some("route-repair"));
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-SRV-209"));
    assert_eq!(deployment.current_stage, "prepare-server");
    assert!(deployment.message.contains("正式地址没有生效"));
    assert!(deployment.message.contains("app.example.com"));
    assert!(
        !deployment
            .completed_steps
            .contains(&"healthcheck".to_string())
    );
}

#[test]
fn an_old_main_caddy_route_requires_explicit_takeover() {
    let mut deployment = run();
    deployment.status = "success".to_string();
    deployment.completed_steps.push("healthcheck".to_string());

    apply_server_route_takeover_problem(
        &mut deployment,
        "app.example.com 仍转发到 sample-api，应切换到 sample-production-api",
    );

    assert_eq!(deployment.status, "needs_action");
    assert_eq!(deployment.action_kind.as_deref(), Some("route-takeover"));
    assert_eq!(deployment.issue_code.as_deref(), Some("AD-SRV-206"));
    assert!(deployment.message.contains("仍指向旧服务"));
    assert!(
        !deployment
            .completed_steps
            .contains(&"healthcheck".to_string())
    );
}

#[test]
fn successful_route_recheck_restores_the_completed_state() {
    let mut deployment = run();
    deployment.status = "needs_action".to_string();
    deployment.current_stage = "healthcheck".to_string();
    deployment.action_kind = Some("route-check".to_string());
    deployment.issue_code = Some("AD-NET-201".to_string());

    apply_public_route_checks(
        &mut deployment,
        &[PublicRouteStatus {
            host: "app.example.com".to_string(),
            url: "https://app.example.com/".to_string(),
            reachable: true,
            phase: "ready".to_string(),
            http_status: Some(200),
            message: "app.example.com 可以访问".to_string(),
        }],
    );

    assert_eq!(deployment.status, "success");
    assert_eq!(deployment.current_stage, "complete");
    assert_eq!(deployment.action_kind, None);
    assert_eq!(deployment.issue_code, None);
    assert!(
        deployment
            .completed_steps
            .contains(&"healthcheck".to_string())
    );
}

#[test]
fn deployment_path_uses_the_selected_registry_connection_over_stale_manifest_defaults() {
    let project = tempdir().expect("temp project");
    fs::write(
        project.path().join("deploy.yaml"),
        r#"version: 1
project: { name: sample }
source: { provider: local, repository: "", release_branch: main }
services:
  - id: api
    kind: api
    image: sample-api
    context: .
    dockerfile: Dockerfile
    container_port: 3000
    healthcheck: { path: /health }
environments:
  development: { target: { kind: local, namespace: sample-development } }
  staging:
    target: { kind: server, server: default, namespace: sample-staging }
    domains: []
  production:
    target: { kind: server, server: default, namespace: sample-production }
    domains: []
providers:
  build: { kind: cnb, repository: team/sample }
  registry: { kind: tcr, registry: ccr.ccs.tencentyun.com, namespace: replace-me }
"#,
    )
    .expect("write manifest");
    for arguments in [
        vec!["init", "-q"],
        vec!["add", "deploy.yaml"],
        vec![
            "-c",
            "user.name=ABCDeploy Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-qm",
            "snapshot",
        ],
    ] {
        assert!(
            Command::new("git")
                .current_dir(project.path())
                .args(arguments)
                .status()
                .expect("run git")
                .success()
        );
    }
    let revision = git_stdout(project.path(), &["rev-parse", "HEAD"])
        .expect("read revision")
        .trim()
        .to_string();
    let state =
        WorkspaceState::open(&project.path().join("workspace.sqlite3")).expect("open workspace");
    state
        .upsert_compat_connection(
            "registry-finagent",
            "registry",
            "tcr",
            "腾讯云 TCR",
            Some("registry.tcr.v2.password"),
            &BTreeMap::from([
                ("endpoint".to_string(), "ccr.ccs.tencentyun.com".to_string()),
                ("namespace".to_string(), "finagent".to_string()),
            ]),
            &["push".to_string(), "pull".to_string()],
            "ready",
            None,
        )
        .expect("save registry connection");
    let mut deployment = run();
    deployment.project_path = project.path().to_string_lossy().into_owned();
    deployment.commit_sha = Some(revision);
    deployment.environment = "deployment".to_string();
    let path = DeploymentPath {
        id: "path-sample".to_string(),
        project_path: deployment.project_path.clone(),
        name: "上线".to_string(),
        source_connection_id: None,
        registry_connection_id: Some("registry-finagent".to_string()),
        server_id: None,
        config_profile_ids: Vec::new(),
        address: String::new(),
        routes: Vec::new(),
        state: "ready".to_string(),
        last_run_id: None,
        current_run_id: None,
        last_successful_revision: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    };

    let resolved =
        deployment_path_manifest(&deployment, &path, &state).expect("resolve path manifest");

    assert!(matches!(
        resolved.providers.registry,
        RegistryConfig::Tcr { ref registry, ref namespace }
            if registry == "ccr.ccs.tencentyun.com" && namespace == "finagent"
    ));
}

#[test]
fn deployment_checks_use_the_committed_manifest_snapshot() {
    let project = tempdir().expect("temp project");
    let manifest = |host: &str| {
        format!(
            r#"version: 1
project: {{ name: sample }}
source: {{ provider: local, repository: "", release_branch: main }}
services:
  - id: api
    kind: api
    image: sample-api
    context: .
    dockerfile: Dockerfile
    container_port: 3000
    healthcheck: {{ path: /health }}
environments:
  development: {{ target: {{ kind: local, namespace: sample-development }} }}
  staging:
    target: {{ kind: server, server: default, namespace: sample-staging }}
    secrets_ref: https://cnb.cool/team/sample-secrets/-/blob/main/env.staging.yml
    domains: []
  production:
    target: {{ kind: server, server: default, namespace: sample-production }}
    approval_required: true
    secrets_ref: https://cnb.cool/team/sample-secrets/-/blob/main/env.production.yml
    domains: [{{ service: api, host: {host}, path: / }}]
providers:
  build: {{ kind: cnb, repository: team/sample }}
  registry: {{ kind: cnb, repository: team/sample }}
"#
        )
    };
    fs::write(
        project.path().join("deploy.yaml"),
        manifest("old.example.com"),
    )
    .expect("write committed manifest");
    for arguments in [
        vec!["init", "-q"],
        vec!["add", "deploy.yaml"],
        vec![
            "-c",
            "user.name=ABCDeploy Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-qm",
            "snapshot",
        ],
    ] {
        assert!(
            Command::new("git")
                .current_dir(project.path())
                .args(arguments)
                .status()
                .expect("run git")
                .success()
        );
    }
    let revision = String::from_utf8(
        Command::new("git")
            .current_dir(project.path())
            .args(["rev-parse", "HEAD"])
            .output()
            .expect("read revision")
            .stdout,
    )
    .expect("utf8 revision");
    fs::write(
        project.path().join("deploy.yaml"),
        manifest("ocr.example.com"),
    )
    .expect("write newer working tree manifest");
    let mut deployment = run();
    deployment.project_path = project.path().to_string_lossy().into_owned();
    deployment.commit_sha = Some(revision.trim().to_string());
    deployment.environment = "production".to_string();

    let snapshot = deployment_manifest(&deployment).expect("load committed snapshot");
    assert_eq!(
        snapshot.environments.production.domains[0].host,
        "old.example.com"
    );
    let routing = deployment_routing_manifest(&deployment).expect("load current routes");
    assert_eq!(
        routing.environments.production.domains[0].host,
        "ocr.example.com"
    );

    let mut newer_manifest =
        deploy_core::parse_manifest(&manifest("ocr.example.com"), Path::new("deploy.yaml"))
            .expect("parse newer manifest");
    let mut ocr = newer_manifest.services[0].clone();
    ocr.id = "ocr".to_string();
    ocr.image = "sample-ocr".to_string();
    newer_manifest.services.push(ocr);
    newer_manifest.environments.production.domains[0].service = "ocr".to_string();
    fs::write(
        project.path().join("deploy.yaml"),
        serialize_manifest(&newer_manifest).expect("serialize newer manifest"),
    )
    .expect("write route for a service absent from the candidate");
    let mismatch = deployment_routing_manifest(&deployment)
        .expect_err("new services require a new test candidate");
    assert!(mismatch.starts_with("AD-REL-204：ocr"));

    let mut unsafe_manifest = newer_manifest;
    unsafe_manifest.environments.production.domains[0].host =
        "ocr.example.com\nABCDEPLOY_ROUTES".to_string();
    fs::write(
        project.path().join("deploy.yaml"),
        serialize_manifest(&unsafe_manifest).expect("serialize unsafe manifest"),
    )
    .expect("write unsafe current manifest");
    let unsafe_current = deployment_routing_manifest(&deployment)
        .expect_err("current manifest must be validated before route inspection");
    assert!(unsafe_current.starts_with("当前项目的 deploy.yaml 未通过安全校验"));
    assert!(!unsafe_current.contains("ABCDEPLOY_ROUTES"));

    assert!(
        Command::new("git")
            .current_dir(project.path())
            .args(["add", "deploy.yaml"])
            .status()
            .expect("stage unsafe manifest")
            .success()
    );
    assert!(
        Command::new("git")
            .current_dir(project.path())
            .args([
                "-c",
                "user.name=ABCDeploy Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-qm",
                "unsafe snapshot",
            ])
            .status()
            .expect("commit unsafe manifest")
            .success()
    );
    deployment.commit_sha = Some(
        String::from_utf8(
            Command::new("git")
                .current_dir(project.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .expect("read unsafe revision")
                .stdout,
        )
        .expect("utf8 unsafe revision")
        .trim()
        .to_string(),
    );
    let unsafe_deployed = deployment_routing_manifest(&deployment)
        .expect_err("deployed manifest must also be validated");
    assert!(unsafe_deployed.starts_with("已部署版本的 deploy.yaml 未通过安全校验"));
    assert!(!unsafe_deployed.contains("ABCDEPLOY_ROUTES"));
}

#[test]
fn reusable_connections_only_fill_empty_runtime_values() {
    let template = concat!(
        "# 项目原始注释\n",
        "MINIMAX_API_KEY=\n",
        "MINIMAX_BASE_URL=https://custom.example/v1\n",
        "UNKNOWN_VALUE=''\n",
    );
    let suggestions = BTreeMap::from([
        (
            "MINIMAX_API_KEY".to_string(),
            "secret-with-$-value".to_string(),
        ),
        (
            "MINIMAX_BASE_URL".to_string(),
            "https://api.minimax.chat/v1".to_string(),
        ),
        ("UNKNOWN_VALUE".to_string(), "preserved".to_string()),
        ("NOT_IN_TEMPLATE".to_string(), "ignored".to_string()),
    ]);

    let (content, filled) = fill_empty_runtime_values(template, &suggestions);
    assert!(content.starts_with("# 项目原始注释\n"));
    assert!(content.contains("MINIMAX_API_KEY=\"secret-with-$-value\""));
    assert!(content.contains("MINIMAX_BASE_URL=https://custom.example/v1"));
    assert!(content.contains("UNKNOWN_VALUE=\"preserved\""));
    assert!(!content.contains("NOT_IN_TEMPLATE"));
    assert_eq!(filled, vec!["MINIMAX_API_KEY", "UNKNOWN_VALUE"]);
}

#[test]
fn local_env_generation_requires_confirmation_and_keeps_a_backup() {
    let project = tempdir().expect("project");
    fs::write(project.path().join(".env"), "OLD=value\n").expect("existing env");

    let preview =
        write_project_local_env(project.path(), "NEW=value\n", false).expect("preview overwrite");
    assert!(preview.requires_confirmation);
    assert!(!preview.written);
    assert_eq!(
        fs::read_to_string(project.path().join(".env")).expect("unchanged"),
        "OLD=value\n"
    );

    let result =
        write_project_local_env(project.path(), "NEW=value\n", true).expect("confirmed write");
    assert!(result.written);
    assert!(result.backup_path.is_some());
    assert_eq!(
        fs::read_to_string(project.path().join(".env")).expect("new env"),
        "NEW=value\n"
    );
    assert!(
        fs::read_to_string(project.path().join(".gitignore"))
            .expect("gitignore")
            .lines()
            .any(|line| line == ".env")
    );
}

#[test]
fn recognizes_a_broken_docker_proxy_for_automatic_retry() {
    assert_eq!(local_build_proxy_attempts(false), [false, true]);
    assert_eq!(local_build_proxy_attempts(true), [true, false]);
    assert!(looks_like_dependency_network_text(
        "npm error connect ECONNREFUSED 192.168.65.254:7890"
    ));
    assert!(looks_like_dependency_network_text(
        "Corepack error when performing the request to registry.npmjs.org"
    ));
    assert!(!looks_like_dependency_network_text(
        "TypeScript error: Property name does not exist"
    ));
    assert!(!looks_like_dependency_network_text(
        "ENV npm_config_registry=https://registry.npmmirror.com\nsrc/main.ts: error TS2307"
    ));

    let mut direct_attempts = Vec::new();
    let direct_result = run_local_build_with_recovery(false, |clear_proxy| {
        direct_attempts.push(clear_proxy);
        Command::new("sh")
            .args(if clear_proxy {
                ["-c", "exit 0"]
            } else {
                ["-c", "echo ECONNREFUSED >&2; exit 1"]
            })
            .output()
    })
    .expect("fallback to direct build");
    assert_eq!(direct_attempts, [false, true]);
    assert!(direct_result.output.status.success());
    assert!(direct_result.clear_proxy);
    assert!(direct_result.switched_mode);

    let mut proxy_attempts = Vec::new();
    let proxy_result = run_local_build_with_recovery(true, |clear_proxy| {
        proxy_attempts.push(clear_proxy);
        Command::new("sh")
            .args(if clear_proxy {
                ["-c", "echo network timeout >&2; exit 1"]
            } else {
                ["-c", "exit 0"]
            })
            .output()
    })
    .expect("fallback to configured proxy");
    assert_eq!(proxy_attempts, [true, false]);
    assert!(proxy_result.output.status.success());
    assert!(!proxy_result.clear_proxy);
    assert!(proxy_result.switched_mode);

    let port_conflict = Command::new("sh")
        .args([
            "-c",
            "echo 'Bind for 127.0.0.1:3000 failed: port is already allocated' >&2; exit 1",
        ])
        .output()
        .expect("port conflict output");
    assert!(local_start_failure(&port_conflict).starts_with("AD-LOC-116"));
}

#[test]
fn summarizes_the_failed_local_service_without_exposing_build_output() {
    let summary = local_build_failure_summary(
        r"
#15 5.652 src/live-tool-executor.ts(5,8): error TS2307: Cannot find module '@wx-toolbox/ai-router' or its corresponding type declarations.
#15 5.652 src/tools/tools.service.ts(53,17): error TS18046: 'error' is of type 'unknown'.
5.652 src/live-tool-executor.ts(5,8): error TS2307: Cannot find module '@wx-toolbox/ai-router' or its corresponding type declarations.
DATABASE_URL=postgresql://user:must-not-appear@example/app
target api: failed to solve: process exited with code 2
",
    );

    assert!(summary.contains("后端服务（api）"));
    assert!(summary.contains("2 个 TypeScript 编译问题"));
    assert!(summary.contains("@wx-toolbox/ai-router"));
    assert!(!summary.contains("must-not-appear"));
}

#[test]
fn recognizes_only_abcdeploy_managed_development_port_owners() {
    let owner = parse_managed_local_port_owner("a1b2c3d4e5f6\tfinagent\tdevelopment\n")
        .expect("managed development container");
    assert_eq!(owner.container_id, "a1b2c3d4e5f6");
    assert_eq!(owner.project, "finagent");

    assert!(parse_managed_local_port_owner("a1b2c3d4e5f6\tfinagent\tproduction\n").is_none());
    assert!(parse_managed_local_port_owner("not-a-container\tfinagent\tdevelopment\n").is_none());
}

#[test]
fn bypasses_private_credentials_only_for_abcdeploy_generated_builds() {
    let manifest = deploy_core::parse_manifest(
        r"
version: 1
project: { name: sample }
source: { provider: cnb, repository: team/sample, release_branch: main }
services:
  - id: generated
    kind: api
    image: sample-generated
    context: .
    dockerfile: .deploydesk/generated/build/Dockerfile.generated
    container_port: 3000
    healthcheck: { path: /health }
  - id: private
    kind: api
    image: sample-private
    context: .
    dockerfile: Dockerfile.private
    container_port: 3001
    healthcheck: { path: /health }
environments:
  development:
    target: { kind: local, namespace: sample-development }
  staging:
    target: { kind: server, server: default, namespace: sample-staging }
  production:
    target: { kind: server, server: default, namespace: sample-production }
providers:
  build: { kind: cnb, repository: team/sample }
  registry: { kind: tcr, registry: registry.example.com, namespace: team }
",
        Path::new("deploy.yaml"),
    )
    .expect("manifest fixture");

    assert!(services_use_public_generated_dockerfiles(
        &manifest,
        &["generated".to_string()]
    ));
    assert!(!services_use_public_generated_dockerfiles(
        &manifest,
        &["private".to_string()]
    ));
    assert!(!services_use_public_generated_dockerfiles(
        &manifest,
        &["generated".to_string(), "private".to_string()]
    ));
}

#[test]
fn stops_a_silent_local_command_instead_of_waiting_forever() {
    let project = tempdir().expect("project");
    let task = super::LocalStartTask::begin(project.path()).expect("start task");
    let mut command = Command::new("sh");
    command.args(["-c", "sleep 5"]);
    let started = std::time::Instant::now();
    let error = super::run_tracked_local_command(
        &task.key,
        &mut command,
        super::LocalCommandLimits {
            idle: std::time::Duration::from_millis(100),
            total: std::time::Duration::from_secs(2),
        },
    )
    .expect_err("silent command should time out");
    assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
    assert!(started.elapsed() < std::time::Duration::from_secs(2));
}

#[test]
fn lets_the_user_cancel_a_running_local_command() {
    let project = tempdir().expect("project");
    let task = super::LocalStartTask::begin(project.path()).expect("start task");
    let task_key = task.key.clone();
    let process = std::thread::spawn(move || {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 5"]);
        super::run_tracked_local_command(
            &task_key,
            &mut command,
            super::LocalCommandLimits {
                idle: std::time::Duration::from_secs(3),
                total: std::time::Duration::from_secs(4),
            },
        )
    });
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert!(
        super::cancel_local_preview_start(project.path().to_string_lossy().into_owned())
            .expect("cancel task")
    );
    let error = process
        .join()
        .expect("command thread")
        .expect_err("cancelled command should stop");
    assert_eq!(error.kind(), std::io::ErrorKind::Interrupted);
}

#[test]
fn managed_remote_dependencies_replace_missing_local_or_wrong_protocol_values() {
    let suggestions = BTreeMap::from([
        (
            "DATABASE_URL".to_string(),
            "postgresql://user:secret@infra-postgres:5432/app".to_string(),
        ),
        (
            "REDIS_URL".to_string(),
            "redis://infra-redis:6379/3".to_string(),
        ),
    ]);
    let (content, filled) = fill_managed_runtime_dependencies(
        "DATABASE_URL=mysql://old-db/app\nREDIS_URL=redis://custom-redis:6379/0\n",
        &suggestions,
    );
    assert!(content.contains("DATABASE_URL=\"postgresql://user:secret@infra-postgres:5432/app\""));
    assert!(content.contains("REDIS_URL=redis://custom-redis:6379/0"));
    assert_eq!(filled, vec!["DATABASE_URL"]);
}

#[test]
fn deployment_lines_replace_managed_values_when_the_server_changes() {
    let suggestions = BTreeMap::from([
        (
            "DATABASE_URL".to_string(),
            "postgresql://user:new@abcdeploy-postgres:5432/app".to_string(),
        ),
        (
            "REDIS_URL".to_string(),
            "redis://:new@abcdeploy-redis:6379/3".to_string(),
        ),
    ]);
    let managed_keys = suggestions.keys().cloned().collect();

    let (content, replaced) = replace_managed_runtime_dependencies(
        concat!(
            "DATABASE_URL=postgresql://user:old@abcdeploy-postgres:5432/app\n",
            "REDIS_URL=redis://:old@abcdeploy-redis:6379/3\n",
            "API_KEY=keep-me\n",
        ),
        &suggestions,
        &managed_keys,
    );

    assert!(content.contains("DATABASE_URL=\"postgresql://user:new@abcdeploy-postgres:5432/app\""));
    assert!(content.contains("REDIS_URL=\"redis://:new@abcdeploy-redis:6379/3\""));
    assert!(content.contains("API_KEY=keep-me"));
    assert_eq!(replaced, vec!["DATABASE_URL", "REDIS_URL"]);
}

#[test]
fn stored_runtime_absorbs_only_safe_non_secret_defaults_and_new_managed_fields() {
    let defaults = runtime_defaults(
        concat!(
            "BAILIAN_TTS_MODEL=cosyvoice-v1\n",
            "BAILIAN_API_KEY=example-secret\n",
            "DATABASE_URL=postgresql://user:pass@localhost/app\n",
        ),
        &BTreeSet::from(["BAILIAN_API_KEY".to_string()]),
    );
    assert_eq!(
        defaults,
        BTreeMap::from([("BAILIAN_TTS_MODEL".to_string(), "cosyvoice-v1".to_string(),)])
    );

    let suggestions = BTreeMap::from([
        ("POSTGRES_DB".to_string(), "swifteng_path".to_string()),
        ("POSTGRES_USER".to_string(), "swifteng_user".to_string()),
    ]);
    let (content, filled) =
        fill_managed_runtime_dependencies("NODE_ENV=production\n", &suggestions);
    assert!(content.contains("POSTGRES_DB=\"swifteng_path\""));
    assert!(content.contains("POSTGRES_USER=\"swifteng_user\""));
    assert_eq!(filled, vec!["POSTGRES_DB", "POSTGRES_USER"]);
}

#[test]
fn existing_project_config_prefers_environment_specific_values() {
    let project = tempdir().expect("project");
    fs::write(project.path().join(".env"), "API_KEY=shared\n").expect("base env");
    fs::write(
        project.path().join(".env.production"),
        "API_KEY=production\n",
    )
    .expect("production env");
    let config = load_existing_project_config(
        project.path().to_string_lossy().into_owned(),
        "production".to_string(),
    )
    .expect("existing config");
    assert_eq!(config.source_files, [".env", ".env.production"]);
    assert!(
        config.content.find("API_KEY=shared").unwrap()
            < config.content.find("API_KEY=production").unwrap()
    );
}

#[test]
fn validates_remote_dependency_identifiers_and_encodes_credentials() {
    assert!(safe_postgres_identifier("sample_staging_user"));
    assert!(!safe_postgres_identifier("Sample-User"));
    assert!(!safe_postgres_identifier("1sample"));
    assert_eq!(url_encode_userinfo("a:b@c"), "a%3Ab%40c");
}

#[test]
fn generates_reliable_local_development_commands_without_changing_release_files() {
    let project = tempdir().expect("project");
    let root = project.path();
    fs::create_dir_all(root.join("apps/api/src")).expect("api source");
    fs::create_dir_all(root.join("apps/h5/src")).expect("h5 source");
    fs::create_dir_all(root.join("apps/ocr/src/finagent_ocr")).expect("ocr source");
    fs::create_dir_all(root.join("infra")).expect("infra");
    fs::write(
        root.join("package.json"),
        r#"{"name":"sample","workspaces":["apps/*"]}"#,
    )
    .expect("root package");
    fs::write(root.join("pnpm-workspace.yaml"), "packages:\n  - apps/*\n").expect("workspace");
    fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").expect("lockfile");
    fs::write(
            root.join("apps/api/package.json"),
            r#"{"name":"@sample/api","scripts":{"dev":"nest start --watch","build":"nest build"},"dependencies":{"@nestjs/core":"1"}}"#,
        )
        .expect("api package");
    fs::write(root.join("apps/api/src/main.ts"), "export {};\n").expect("api main");
    fs::write(
            root.join("apps/h5/package.json"),
            r#"{"name":"@sample/h5","scripts":{"dev":"vite --host 0.0.0.0 --port 10087","build":"vite build"},"dependencies":{"vite":"1"}}"#,
        )
        .expect("h5 package");
    fs::write(root.join("apps/h5/src/main.ts"), "export {};\n").expect("h5 main");
    fs::write(root.join("apps/ocr/requirements.txt"), "fastapi\nuvicorn\n").expect("requirements");
    fs::write(
        root.join("apps/ocr/src/finagent_ocr/main.py"),
        "from fastapi import FastAPI\napp = FastAPI()\n",
    )
    .expect("ocr main");
    for name in ["api", "h5"] {
        fs::write(
            root.join(format!("infra/Dockerfile.{name}")),
            "FROM node:22-slim AS build\nWORKDIR /app\nCOPY . .\n",
        )
        .expect("node dockerfile");
    }
    fs::write(
        root.join("apps/ocr/Dockerfile"),
        "FROM python:3.12-slim\nWORKDIR /app\nCOPY apps/ocr/src ./src\n",
    )
    .expect("ocr dockerfile");

    let inspection = deploy_core::inspect_project(root).expect("inspection");
    let manifest = deploy_core::create_default_manifest(&inspection);
    let generated =
        deploy_core::render::render_project_files(&manifest).expect("generated deployment files");
    let compose = generated
        .iter()
        .find(|file| file.path == ".deploydesk/generated/development/docker-compose.yml")
        .expect("development compose");
    let compose_path = root.join(&compose.path);
    fs::create_dir_all(compose_path.parent().expect("compose parent")).expect("compose directory");
    fs::write(&compose_path, &compose.content).expect("base compose");

    let hot_path = super::write_local_development_compose(root, &inspection, &manifest)
        .expect("development compose");
    let hot = fs::read_to_string(hot_path).expect("hot compose");
    assert!(hot.contains(
        "corepack pnpm --config.verify-deps-before-run=warn --dir '/app/apps/api' run dev"
    ));
    assert!(hot.contains("10087"));
    assert!(hot.contains("--reload"));
    assert!(hot.contains("apps/api/src"));
    assert!(hot.contains("仅用于本机开发调试"));
    assert!(!compose.content.contains("--reload"));
    assert_eq!(
        super::development_package_command(PackageManager::Pnpm, "apps/customer's api", "dev"),
        "corepack pnpm --config.verify-deps-before-run=warn --dir '/app/apps/customer'\"'\"'s api' run dev"
    );
}
