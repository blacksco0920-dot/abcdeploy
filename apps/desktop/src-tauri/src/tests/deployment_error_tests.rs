use crate::deployment_state::{
    deployed_services_match_artifacts, parse_deployed_service_states,
    resume_deployment_from_verified_server_state,
};
use crate::{
    DeploymentArtifact, deployment_error_from_stderr, pause_deployment_path_after_deploy_error,
};

#[test]
fn deployment_errors_prefer_actionable_coded_output_over_the_last_noise_line() {
    let stderr = "pulling project image\n\
            AD-INF-202：服务器暂时无法下载项目运行组件；系统已尝试国内来源\n\
            process exited with status 1\n";

    assert_eq!(
        deployment_error_from_stderr(stderr),
        "AD-INF-202：服务器暂时无法下载项目运行组件；系统已尝试国内来源"
    );
}

#[test]
fn missing_server_runtime_configuration_keeps_an_actionable_issue_code() {
    let mut deployment = super::run();
    pause_deployment_path_after_deploy_error(
        &mut deployment,
        "运行服务器还缺少 2 项必要配置：API_KEY、AUTH_SECRET",
    );

    assert_eq!(deployment.issue_code.as_deref(), Some("AD-CFG-201"));
    assert_eq!(
        deployment.action_kind.as_deref(),
        Some("deployment-path-runtime-config")
    );
    assert!(deployment.message.contains("2 项必要配置"));
}

#[test]
fn exact_healthy_server_images_allow_a_deployment_to_resume_after_a_false_failure() {
    let expected = vec![
        ("api".to_string(), "sample-api-1".to_string()),
        ("web".to_string(), "sample-web-1".to_string()),
    ];
    let states = parse_deployed_service_states(
        "api\trunning\thealthy\tregistry.example/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nweb\trunning\tnone\tregistry.example/web@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
        &expected,
    );
    let artifacts = vec![
        DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example/api".to_string(),
            digest: format!("sha256:{}", "a".repeat(64)),
        },
        DeploymentArtifact {
            service: "web".to_string(),
            image: "registry.example/web".to_string(),
            digest: format!("sha256:{}", "b".repeat(64)),
        },
    ];

    assert!(deployed_services_match_artifacts(&states, &artifacts));

    let mut unhealthy = states;
    unhealthy[0].health = "unhealthy".to_string();
    assert!(!deployed_services_match_artifacts(&unhealthy, &artifacts));
}

#[test]
fn a_late_remote_error_keeps_the_verified_server_update_and_continues() {
    let expected = vec![("api".to_string(), "sample-api-1".to_string())];
    let states = parse_deployed_service_states(
        "api\trunning\thealthy\tregistry.example/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
        &expected,
    );
    let artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example/api".to_string(),
        digest: format!("sha256:{}", "a".repeat(64)),
    }];
    let mut deployment = super::run();
    deployment.status = "needs_action".to_string();
    deployment.current_stage = "deploy".to_string();
    deployment.issue_code = Some("AD-DEP-201".to_string());
    deployment.action_kind = Some("deployment-path-retry".to_string());
    deployment.artifacts = artifacts;

    assert!(resume_deployment_from_verified_server_state(
        &mut deployment,
        &states
    ));
    assert_eq!(deployment.status, "running");
    assert_eq!(deployment.current_stage, "deploy");
    assert_eq!(deployment.issue_code, None);
    assert_eq!(deployment.action_kind, None);
    assert!(deployment.completed_steps.contains(&"server".to_string()));
    assert!(deployment.message.contains("继续配置访问地址"));
}
