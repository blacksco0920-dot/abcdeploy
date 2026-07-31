use std::fs;

use deploy_core::model::PublicRouteStatus;
use deploy_core::providers::ssh::SshProfile;
use tempfile::tempdir;

use super::super::{registered_domain_requirement_key, remember_registered_domain_requirement};
use super::{WorkspaceState, run};

#[test]
fn domain_policy_failure_is_remembered_as_a_server_capability() {
    let directory = tempdir().expect("temp directory");
    let project_path = directory.path().join("sample");
    fs::create_dir_all(&project_path).expect("project directory");
    let database =
        WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace database");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "private-key-placeholder").expect("write key placeholder");
    let server = database
        .bind_project_server(
            &project_path,
            "staging",
            &SshProfile {
                name: "运行服务器".to_string(),
                host: "203.0.113.80".to_string(),
                user: "ubuntu".to_string(),
                port: 22,
                key_path,
                host_fingerprint: Some("SHA256:confirmed".to_string()),
            },
        )
        .expect("bind server");
    let mut deployment = run();
    deployment.project_path = project_path.to_string_lossy().into_owned();

    remember_registered_domain_requirement(
        &database,
        &deployment,
        &[PublicRouteStatus {
            host: "sample-api.203-0-113-80.sslip.io".to_string(),
            url: "https://sample-api.203-0-113-80.sslip.io/".to_string(),
            reachable: false,
            phase: "domain-policy".to_string(),
            http_status: Some(451),
            message: "临时域名被云厂商策略拦截".to_string(),
        }],
    );

    assert_eq!(
        database
            .setting(&registered_domain_requirement_key(&server.id))
            .expect("read capability"),
        Some("true".to_string())
    );
}
