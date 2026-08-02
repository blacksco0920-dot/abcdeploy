use std::collections::BTreeMap;
use std::fs;

use deploy_core::model::PublicRouteStatus;
use deploy_core::providers::ssh::SshProfile;
use rusqlite::Connection;

use super::{
    CNB_SOURCE_CONNECTION_ID, ConfigProfile, DeploymentArtifact, DeploymentPathInput,
    DeploymentPathRoute, DeploymentRun, DeploymentRunLinks, TCR_REGISTRY_CONNECTION_ID,
    WorkspaceState, encode_uri_component, project_storage_id,
};

fn save_successful_staging_run(
    database: &WorkspaceState,
    project_path: &std::path::Path,
    commit_sha: &str,
    artifacts: Vec<DeploymentArtifact>,
) -> DeploymentRun {
    let mut run = database
        .create_deployment_run(project_path, "sample", "staging", "owner/sample", "main")
        .expect("create staging run");
    run.status = "success".to_string();
    run.current_stage = "complete".to_string();
    run.commit_sha = Some(commit_sha.to_string());
    run.candidate_tag = Some(format!("candidate-{commit_sha}"));
    run.artifacts = artifacts;
    run.message = "测试环境部署成功".to_string();
    database
        .save_deployment_run(&run)
        .expect("save successful staging run");
    run
}

fn save_successful_production_run(
    database: &WorkspaceState,
    source: &DeploymentRun,
    artifacts: Vec<DeploymentArtifact>,
    started_at: &str,
) -> DeploymentRun {
    let mut run = database
        .create_deployment_run(
            std::path::Path::new(&source.project_path),
            &source.project_name,
            "production",
            &source.repository,
            &source.branch,
        )
        .expect("create production run");
    run.status = "success".to_string();
    run.current_stage = "complete".to_string();
    run.commit_sha.clone_from(&source.commit_sha);
    run.source_title.clone_from(&source.source_title);
    run.source_run_id = Some(source.id.clone());
    run.candidate_tag.clone_from(&source.candidate_tag);
    run.artifacts = artifacts;
    run.started_at = started_at.to_string();
    run.updated_at = started_at.to_string();
    run.message = "生产环境部署成功".to_string();
    database
        .save_deployment_run(&run)
        .expect("save successful production run");
    run
}

fn release_model_ids(database: &WorkspaceState) -> BTreeMap<String, Vec<String>> {
    let connection = database.connection.lock().expect("database lock");
    let queries = [
        ("projects", "SELECT id FROM projects ORDER BY id"),
        (
            "project-identities",
            "SELECT project_id || ':' || storage_id FROM project_identities ORDER BY project_id",
        ),
        ("environments", "SELECT id FROM environments ORDER BY id"),
        ("versions", "SELECT id FROM versions ORDER BY id"),
        (
            "version-artifacts",
            "SELECT id FROM version_artifacts ORDER BY id",
        ),
        (
            "version-validations",
            "SELECT id FROM version_validations ORDER BY id",
        ),
        (
            "automation-rules",
            "SELECT id FROM automation_rules ORDER BY id",
        ),
        (
            "deployment-tasks",
            "SELECT id FROM deployment_runs ORDER BY id",
        ),
        (
            "server-bindings",
            "SELECT project_path || ':' || environment || ':' || server_id
                 FROM project_server_bindings ORDER BY project_path, environment, server_id",
        ),
        (
            "config-bindings",
            "SELECT project_path || ':' || environment || ':' || profile_kind || ':' || profile_id
                 FROM project_profile_bindings
                 ORDER BY project_path, environment, profile_kind, profile_id",
        ),
        (
            "source-bindings",
            "SELECT project_id || ':' || COALESCE(source_connection_id, '')
                 FROM project_connection_bindings ORDER BY project_id",
        ),
        (
            "environment-connections",
            "SELECT id || ':' || COALESCE(target_connection_id, '') || ':' ||
                        COALESCE(registry_connection_id, '')
                 FROM environments ORDER BY id",
        ),
    ];
    queries
        .into_iter()
        .map(|(name, query)| {
            let mut statement = connection.prepare(query).expect("snapshot query");
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query release model ids")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect release model ids");
            (name.to_string(), ids)
        })
        .collect()
}

#[test]
fn deployment_paths_are_project_scoped_reusable_connection_bindings() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    database
        .continue_existing_deployment(&project_path)
        .expect("manage project deployment");
    database
        .upsert_compat_connection(
            CNB_SOURCE_CONNECTION_ID,
            "source",
            "cnb",
            "CNB",
            Some("cnb-token"),
            &BTreeMap::new(),
            &["builds".to_string()],
            "ready",
            Some("2026-07-18T00:00:00Z"),
        )
        .expect("source connection");
    database
        .upsert_compat_connection(
            TCR_REGISTRY_CONNECTION_ID,
            "registry",
            "tcr",
            "腾讯云 TCR",
            Some("registry.tcr.v2.password"),
            &BTreeMap::new(),
            &["push".to_string(), "pull".to_string()],
            "ready",
            Some("2026-07-18T00:00:00Z"),
        )
        .expect("registry connection");
    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "private-key-placeholder").expect("write key");
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
        .expect("save server");

    let saved = database
        .save_deployment_path(DeploymentPathInput {
            id: None,
            project_path: project_path.to_string_lossy().into_owned(),
            name: "上线".to_string(),
            source_connection_id: Some(CNB_SOURCE_CONNECTION_ID.to_string()),
            registry_connection_id: Some(TCR_REGISTRY_CONNECTION_ID.to_string()),
            server_id: Some(server.id.clone()),
            config_profile_ids: Vec::new(),
            address: "app.example.com".to_string(),
            routes: vec![DeploymentPathRoute {
                service: "web".to_string(),
                host: "app.example.com".to_string(),
                path: "/".to_string(),
            }],
            state: Some("ready".to_string()),
            last_run_id: None,
            current_run_id: None,
            last_successful_revision: None,
        })
        .expect("save deployment path");
    assert_eq!(saved.name, "上线");
    assert_eq!(saved.server_id.as_deref(), Some(server.id.as_str()));
    let restored = database
        .list_deployment_paths(&project_path)
        .expect("restore deployment paths");
    assert_eq!(restored, vec![saved.clone()]);
    let deploying = database
        .save_deployment_path(DeploymentPathInput {
            id: Some(saved.id.clone()),
            project_path: project_path.to_string_lossy().into_owned(),
            name: "线上服务器".to_string(),
            source_connection_id: saved.source_connection_id.clone(),
            registry_connection_id: saved.registry_connection_id.clone(),
            server_id: saved.server_id.clone(),
            config_profile_ids: Vec::new(),
            address: saved.address.clone(),
            routes: saved.routes.clone(),
            state: Some("deploying".to_string()),
            last_run_id: None,
            current_run_id: saved.current_run_id.clone(),
            last_successful_revision: None,
        })
        .expect("update deployment path");
    assert_eq!(deploying.name, "线上服务器");
    assert!(
        database
            .delete_deployment_path(&project_path, &deploying.id)
            .is_err(),
        "an in-flight path must not disappear"
    );
}

#[test]
fn deployment_retries_append_attempts_and_freeze_the_path_snapshot() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    database
        .continue_existing_deployment(&project_path)
        .expect("manage project deployment");
    let deployment_path = database
        .save_deployment_path(DeploymentPathInput {
            id: None,
            project_path: project_path.to_string_lossy().into_owned(),
            name: "上线".to_string(),
            source_connection_id: None,
            registry_connection_id: None,
            server_id: None,
            config_profile_ids: Vec::new(),
            address: "app.example.com".to_string(),
            routes: vec![DeploymentPathRoute {
                service: "web".to_string(),
                host: "app.example.com".to_string(),
                path: "/".to_string(),
            }],
            state: Some("ready".to_string()),
            last_run_id: None,
            current_run_id: None,
            last_successful_revision: None,
        })
        .expect("save path");
    let mut task = database
        .create_deployment_run(&project_path, "sample", "staging", "team/sample", "main")
        .expect("create task");
    database
        .bind_deployment_path_run(&deployment_path.id, &task.id)
        .expect("bind task to path");

    let first = database
        .begin_deployment_attempt(&task.id)
        .expect("begin first attempt");
    let duplicate = database
        .begin_deployment_attempt(&task.id)
        .expect("reuse open attempt");
    assert_eq!(first.id, duplicate.id);
    assert_eq!(first.input_snapshot["deploymentPathId"], deployment_path.id);
    assert_eq!(first.input_snapshot["address"], "app.example.com");

    task.status = "needs_action".to_string();
    task.current_stage = "prepare-server".to_string();
    task.issue_code = Some("AD-SSH-102".to_string());
    task.message = "服务器暂时无法连接".to_string();
    database
        .save_deployment_run(&task)
        .expect("finish first attempt");

    let second = database
        .begin_deployment_attempt(&task.id)
        .expect("begin retry attempt");
    assert_ne!(first.id, second.id);
    assert_eq!(second.ordinal, 2);
    let attempts = database
        .list_deployment_attempts(&task.id)
        .expect("list attempts");
    assert_eq!(attempts.len(), 2);
    assert_eq!(attempts[0].status, "needs_action");
    assert!(attempts[0].finished_at.is_some());
    assert_eq!(attempts[1].status, "running");

    task.status = "success".to_string();
    task.current_stage = "complete".to_string();
    task.commit_sha = Some("0123456789abcdef0123456789abcdef01234567".to_string());
    database.save_deployment_run(&task).expect("finish retry");
    let mut next_task = database
        .create_deployment_run(&project_path, "sample", "deployment", "team/sample", "main")
        .expect("create next task");
    database
        .bind_deployment_path_run(&deployment_path.id, &next_task.id)
        .expect("bind next task");
    let path_during_update = database
        .deployment_path_by_id(&deployment_path.id)
        .expect("load updating path");
    assert_eq!(
        path_during_update.last_run_id.as_deref(),
        Some(next_task.id.as_str())
    );
    assert_eq!(
        path_during_update.current_run_id.as_deref(),
        Some(task.id.as_str())
    );

    next_task.status = "failed".to_string();
    next_task.current_stage = "deploy".to_string();
    next_task.message = "新版本启动失败".to_string();
    database
        .save_deployment_run(&next_task)
        .expect("save failed update");
    let path_after_failure = database
        .deployment_path_by_id(&deployment_path.id)
        .expect("load path after failed update");
    assert_eq!(path_after_failure.state, "online");
    assert_eq!(
        path_after_failure.last_run_id.as_deref(),
        Some(next_task.id.as_str())
    );
    assert_eq!(
        path_after_failure.current_run_id.as_deref(),
        Some(task.id.as_str())
    );
    let history = database
        .list_deployment_path_runs(&deployment_path.id)
        .expect("list path history");
    assert_eq!(history.len(), 2);
    assert!(history.iter().any(|run| run.id == task.id));
    assert_eq!(
        database
            .deployment_path_for_run(&task.id)
            .expect("find old task path")
            .id,
        deployment_path.id
    );
}

#[test]
fn creates_first_class_model_foundation_without_copying_secrets() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 2)
        .expect("remember project");
    database
        .set_setting("legacy-cnb-token", "must-not-be-copied")
        .expect("store legacy secret setting");

    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "private-key-placeholder").expect("write key placeholder");
    let server = SshProfile {
        name: "测试服务器".to_string(),
        host: "203.0.113.31".to_string(),
        user: "ubuntu".to_string(),
        port: 22,
        key_path,
        host_fingerprint: Some("SHA256:model-foundation".to_string()),
    };
    database
        .bind_project_server(&project_path, "staging", &server)
        .expect("bind server");
    let run = database
        .create_deployment_run(&project_path, "sample", "staging", "owner/sample", "main")
        .expect("create deployment");

    let project = database.list_projects().expect("list projects")[0].clone();
    {
        let connection = database.connection.lock().expect("database lock");
        let model_table_count: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'table' AND name IN (
                       'project_identities', 'connections', 'environments', 'versions',
                       'version_artifacts', 'version_validations', 'automation_rules',
                       'project_connection_bindings'
                     )",
                [],
                |row| row.get(0),
            )
            .expect("model tables");
        assert_eq!(model_table_count, 8);

        let stored_identity: String = connection
            .query_row(
                "SELECT storage_id FROM project_identities WHERE project_id = ?1",
                [&project.id],
                |row| row.get(0),
            )
            .expect("project identity");
        assert_eq!(stored_identity, project_storage_id(&project_path));
        let environment_count: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM environments WHERE project_id = ?1",
                [&project.id],
                |row| row.get(0),
            )
            .expect("environments");
        assert_eq!(environment_count, 3);

        let (secret_ref, metadata, capabilities, status, legacy_server_id): (
            Option<String>,
            String,
            String,
            String,
            String,
        ) = connection
            .query_row(
                "SELECT secret_ref, metadata_json, capabilities_json, status,
                            legacy_resource_id
                     FROM connections WHERE kind = 'server'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("server connection");
        assert!(secret_ref.is_none());
        assert_eq!(
            serde_json::from_str::<BTreeMap<String, String>>(&metadata)
                .expect("safe server metadata"),
            BTreeMap::from([
                ("host".to_string(), "203.0.113.31".to_string()),
                (
                    "hostFingerprint".to_string(),
                    "SHA256:model-foundation".to_string()
                ),
                ("port".to_string(), "22".to_string()),
                ("user".to_string(), "ubuntu".to_string()),
            ])
        );
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&capabilities).expect("server capabilities"),
            vec!["deploy", "healthcheck", "reverse-proxy"]
        );
        assert_eq!(status, "configured");
        assert!(!metadata.contains("must-not-be-copied"));
        assert!(!metadata.contains("private-key-placeholder"));

        let target_connection: String = connection
            .query_row(
                "SELECT target_connection_id FROM environments
                     WHERE project_id = ?1 AND name = 'staging'",
                [&project.id],
                |row| row.get(0),
            )
            .expect("staging target connection");
        assert_eq!(
            target_connection,
            format!("legacy-server:{legacy_server_id}")
        );

        let links: DeploymentRunLinks = connection
            .query_row(
                "SELECT project_id, environment_id, version_id, task_kind,
                            target_snapshot_json, config_snapshot_json
                     FROM deployment_runs WHERE id = ?1",
                [&run.id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("deployment links");
        assert_eq!(links.0.as_deref(), Some(project.id.as_str()));
        assert_eq!(
            links.1.as_deref(),
            Some(format!("{}:staging", project.id).as_str())
        );
        assert!(links.2.is_none());
        assert!(links.3.is_none());
        assert!(links.4.is_none());
        assert!(links.5.is_none());

        let foreign_key_violations: u32 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check");
        assert_eq!(foreign_key_violations, 0);
    }

    assert!(
        database
            .remove_project(&project_path)
            .expect("remove project")
    );
    assert!(
        database
            .list_projects()
            .expect("hidden projects")
            .is_empty()
    );
    assert!(database.deployment_run(&run.id).is_err());
    let connection = database.connection.lock().expect("database lock");
    let remaining_runs: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM deployment_runs WHERE id = ?1",
            [&run.id],
            |row| row.get(0),
        )
        .expect("removed deployment links");
    assert_eq!(remaining_runs, 0);
    let remaining_projects: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            [&project.id],
            |row| row.get(0),
        )
        .expect("removed project");
    assert_eq!(remaining_projects, 0);
}

#[test]
fn connection_resources_backfill_legacy_providers_without_exposing_secrets() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    database
        .set_setting(
            "cnb.account.summary",
            r#"{
                  "connected": true,
                  "displayName": "示例账号",
                  "username": "safe-user",
                  "defaultNamespace": "safe-team",
                  "token": "cnb-secret-sentinel",
                  "password": "password-sentinel",
                  "privateKey": "private-key-sentinel"
                }"#,
        )
        .expect("save safe account summary");
    database
        .set_setting("registry.mode", "tcr")
        .expect("save registry mode");
    database
        .set_setting("registry.tcr.namespace", "safe-team")
        .expect("save registry namespace");
    database
        .set_setting(
            "registry.tcr.v2.verified-endpoint",
            "ccr.ccs.tencentyun.com",
        )
        .expect("save historical registry endpoint");

    let key_path = directory.path().join("private-key-sentinel");
    fs::write(&key_path, "private-key-sentinel").expect("write test key");
    database
        .bind_project_server(
            &project_path,
            "staging",
            &SshProfile {
                name: "测试服务器".to_string(),
                host: "203.0.113.41".to_string(),
                user: "ubuntu".to_string(),
                port: 22,
                key_path,
                host_fingerprint: Some("SHA256:no-secret".to_string()),
            },
        )
        .expect("bind server");

    assert!(
        database
            .upsert_compat_connection(
                "unsafe-connection",
                "source",
                "cnb",
                "Unsafe",
                Some("cnb-secret-sentinel"),
                &BTreeMap::new(),
                &[],
                "unknown",
                None,
            )
            .is_err()
    );

    let connections = database.list_connections(None).expect("list connections");
    assert_eq!(connections.len(), 3);
    let source = connections
        .iter()
        .find(|connection| connection.id == CNB_SOURCE_CONNECTION_ID)
        .expect("CNB connection");
    assert_eq!(source.status, "unknown");
    assert!(source.last_checked_at.is_none());
    assert_eq!(
        source.metadata.get("username").map(String::as_str),
        Some("safe-user")
    );
    let registry = connections
        .iter()
        .find(|connection| connection.id == TCR_REGISTRY_CONNECTION_ID)
        .expect("TCR connection");
    assert_eq!(registry.status, "unknown");
    assert!(registry.last_checked_at.is_none());
    assert_eq!(
        database
            .list_connections(Some("server"))
            .expect("list server connections")
            .len(),
        1
    );
    let serialized = serde_json::to_string(&connections).expect("serialize connections");
    for forbidden in [
        "cnb-secret-sentinel",
        "password-sentinel",
        "private-key-sentinel",
        "secret_ref",
        "secretRef",
        "key_path",
        "keyPath",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "connection API leaked {forbidden}"
        );
    }

    let connection = database.connection.lock().expect("database lock");
    let secret_refs = connection
        .prepare(
            "SELECT secret_ref FROM connections
                 WHERE secret_ref IS NOT NULL ORDER BY secret_ref",
        )
        .expect("prepare secret refs")
        .query_map([], |row| row.get::<_, String>(0))
        .expect("query secret refs")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect secret refs");
    assert_eq!(secret_refs, vec!["cnb-token", "registry.tcr.v2.password"]);
}

#[test]
fn removing_and_readding_a_project_starts_with_a_fresh_release_model() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    database
        .set_project_step(&project_path, "workspace")
        .expect("save project step");
    let original = database.list_projects().expect("project")[0].clone();

    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "test-only-placeholder").expect("write key placeholder");
    database
        .bind_project_server(
            &project_path,
            "staging",
            &SshProfile {
                name: "测试服务器".to_string(),
                host: "203.0.113.88".to_string(),
                user: "ubuntu".to_string(),
                port: 22,
                key_path,
                host_fingerprint: Some("SHA256:soft-hide".to_string()),
            },
        )
        .expect("bind server");
    let profile = ConfigProfile {
        id: "soft-hide-database".to_string(),
        kind: "database".to_string(),
        provider: "postgresql".to_string(),
        name: "测试数据库".to_string(),
        scope: "remote".to_string(),
        values: BTreeMap::new(),
        secret_fields: vec!["url".to_string()],
        configured_secret_fields: Vec::new(),
        is_default: false,
        updated_at: String::new(),
    };
    database
        .save_config_profile(&profile)
        .expect("save config profile");
    database
        .bind_config_profile(&project_path, "staging", "database", &profile.id)
        .expect("bind config profile");
    database
        .upsert_compat_connection(
            CNB_SOURCE_CONNECTION_ID,
            "source",
            "cnb",
            "CNB",
            Some("cnb-token"),
            &BTreeMap::from([("endpoint".to_string(), "https://cnb.cool".to_string())]),
            &["repositories".to_string()],
            "configured",
            None,
        )
        .expect("save source connection");
    database
        .upsert_compat_connection(
            TCR_REGISTRY_CONNECTION_ID,
            "registry",
            "tcr",
            "腾讯云 TCR",
            Some("registry.tcr.v2.password"),
            &BTreeMap::from([("endpoint".to_string(), "ccr.ccs.tencentyun.com".to_string())]),
            &["push".to_string(), "pull".to_string()],
            "configured",
            None,
        )
        .expect("save registry connection");
    database
        .bind_project_source_connection(&project_path, Some(CNB_SOURCE_CONNECTION_ID))
        .expect("bind source connection");
    for environment in ["staging", "production"] {
        database
            .bind_project_registry_connection(
                &project_path,
                environment,
                Some(TCR_REGISTRY_CONNECTION_ID),
            )
            .expect("bind registry connection");
    }
    let run = save_successful_staging_run(
        &database,
        &project_path,
        "0123456789abcdef0123456789abcdef01234567",
        vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_string(),
        }],
    );
    let _validation = database
        .set_version_validation(&project_path, &run.id, "passed")
        .expect("validate version");
    let mut active_task = database
        .create_deployment_run(&project_path, "sample", "staging", "owner/sample", "main")
        .expect("create active task");
    active_task.status = "running".to_string();
    active_task.current_stage = "build".to_string();
    active_task.started_at = "2099-01-02T00:00:00Z".to_string();
    active_task.updated_at = active_task.started_at.clone();
    database
        .save_deployment_run(&active_task)
        .expect("save active task");
    let mut attention_task = database
        .create_deployment_run(
            &project_path,
            "sample",
            "production",
            "owner/sample",
            "main",
        )
        .expect("create attention task");
    attention_task.status = "needs_action".to_string();
    attention_task.current_stage = "prepare-server".to_string();
    attention_task.started_at = "2099-01-03T00:00:00Z".to_string();
    attention_task.updated_at = attention_task.started_at.clone();
    database
        .save_deployment_run(&attention_task)
        .expect("save attention task");
    {
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "INSERT INTO automation_rules (
                       id, project_id, name, trigger_kind, action_kind,
                       target_environment_id, desired_state, observed_state,
                       created_at, updated_at
                     ) VALUES (
                       'rule-main-staging', ?1, 'main 自动部署测试环境',
                       'branch-update', 'deploy-version', ?2, 'enabled', 'ready', ?3, ?3
                     )",
                rusqlite::params![
                    original.id,
                    format!("{}:staging", original.id),
                    "2026-01-01T00:00:00Z"
                ],
            )
            .expect("save automation rule");
    }
    let original_model_ids = release_model_ids(&database);
    for (kind, expected_count) in [
        ("projects", 1_usize),
        ("project-identities", 1),
        ("environments", 3),
        ("versions", 1),
        ("version-artifacts", 1),
        ("version-validations", 1),
        ("automation-rules", 1),
        ("deployment-tasks", 3),
        ("server-bindings", 1),
        ("config-bindings", 1),
        ("source-bindings", 1),
        ("environment-connections", 3),
    ] {
        assert_eq!(
            original_model_ids
                .get(kind)
                .expect("release model snapshot kind")
                .len(),
            expected_count,
            "unexpected original row count for {kind}"
        );
    }

    assert_eq!(
        database
            .list_recent_successful_deployment_runs()
            .expect("visible recent deployment")
            .len(),
        1
    );
    assert_eq!(
        database
            .list_active_deployment_runs()
            .expect("visible active deployment")
            .len(),
        1
    );
    assert_eq!(
        database
            .list_attention_deployment_runs()
            .expect("visible attention deployments")
            .len(),
        2
    );
    assert!(
        database
            .remove_project(&project_path)
            .expect("hide project")
    );
    assert!(
        database
            .list_projects()
            .expect("visible projects")
            .is_empty()
    );
    assert!(
        database
            .list_recent_successful_deployment_runs()
            .expect("hidden recent deployments")
            .is_empty()
    );
    assert!(
        database
            .list_active_deployment_runs()
            .expect("hidden active deployments")
            .is_empty()
    );
    assert!(
        database
            .list_attention_deployment_runs()
            .expect("hidden attention deployments")
            .is_empty()
    );
    assert!(database.deployment_run(&run.id).is_err());
    assert!(
        database
            .list_project_environments(&project_path)
            .expect("removed environments")
            .is_empty()
    );
    assert!(
        database
            .list_version_validations(&project_path)
            .expect("removed validation")
            .is_empty()
    );
    assert_ne!(release_model_ids(&database), original_model_ids);
    assert_eq!(
        database
            .project_connection_bindings(&project_path)
            .expect("removed project connection bindings"),
        super::ProjectConnectionBindings::default()
    );
    {
        let connection = database.connection.lock().expect("database lock");
        let foreign_key_violations: u32 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("foreign key check");
        assert_eq!(foreign_key_violations, 0);
    }

    database
        .remember_project(&project_path, "sample renamed", true, 1)
        .expect("re-add project");
    let restored = database.list_projects().expect("restored projects");
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].id, original.id);
    assert_eq!(restored[0].name, "sample renamed");
    assert_eq!(restored[0].current_step, "inspection");
    assert_ne!(release_model_ids(&database), original_model_ids);
    assert_eq!(
        database
            .project_connection_bindings(&project_path)
            .expect("fresh project connection bindings"),
        super::ProjectConnectionBindings::default()
    );
    assert!(
        database
            .list_active_deployment_runs()
            .expect("fresh active deployment")
            .is_empty()
    );
    assert!(
        database
            .list_attention_deployment_runs()
            .expect("fresh attention deployments")
            .is_empty()
    );
    assert!(
        database
            .list_version_validations(&project_path)
            .expect("fresh validation")
            .is_empty()
    );
    let connection = database.connection.lock().expect("database lock");
    let automation_count: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM automation_rules WHERE project_id = ?1",
            [&original.id],
            |row| row.get(0),
        )
        .expect("removed automation rule");
    assert_eq!(automation_count, 0);
}

#[test]
fn migrates_legacy_workspace_model_idempotently() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("legacy-model.db");
    let project_path = directory.path().join("legacy-project");
    let project_path = project_path.to_string_lossy().into_owned();
    let connection = Connection::open(&path).expect("open legacy database");
    connection
        .execute_batch(
            "CREATE TABLE projects (
                   id TEXT PRIMARY KEY,
                   path TEXT NOT NULL UNIQUE,
                   name TEXT NOT NULL,
                   current_step TEXT NOT NULL DEFAULT 'inspection',
                   manifest_exists INTEGER NOT NULL DEFAULT 0,
                   service_count INTEGER NOT NULL DEFAULT 0,
                   last_opened_at TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 CREATE TABLE servers (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   host TEXT NOT NULL,
                   user TEXT NOT NULL,
                   port INTEGER NOT NULL,
                   key_path TEXT NOT NULL,
                   last_checked_at TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   UNIQUE(host, user, port)
                 );
                 CREATE TABLE project_server_bindings (
                   project_path TEXT NOT NULL,
                   environment TEXT NOT NULL,
                   server_id TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   PRIMARY KEY(project_path, environment),
                   FOREIGN KEY(server_id) REFERENCES servers(id)
                 );
                 CREATE TABLE deployment_runs (
                   id TEXT PRIMARY KEY,
                   project_path TEXT NOT NULL,
                   project_name TEXT NOT NULL,
                   environment TEXT NOT NULL,
                   status TEXT NOT NULL,
                   current_stage TEXT NOT NULL,
                   build_serial TEXT,
                   repository TEXT NOT NULL,
                   branch TEXT NOT NULL,
                   message TEXT NOT NULL,
                   completed_steps TEXT NOT NULL,
                   started_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 CREATE TABLE app_settings (
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );",
        )
        .expect("create legacy schema");
    connection
        .execute(
            "INSERT INTO projects (
                   id, path, name, manifest_exists, service_count, last_opened_at, created_at
                 ) VALUES ('legacy-project-id', ?1, '旧项目', 1, 2, ?2, ?2)",
            rusqlite::params![project_path, "2026-01-01T00:00:00Z"],
        )
        .expect("insert legacy project");
    connection
        .execute(
            "INSERT INTO servers VALUES (
                   'legacy-server-id', '旧服务器', '203.0.113.40', 'ubuntu', 22,
                   '/private/must-not-be-copied', ?1, ?1
                 )",
            ["2026-01-01T00:00:00Z"],
        )
        .expect("insert legacy server");
    connection
        .execute(
            "INSERT INTO project_server_bindings VALUES (?1, 'staging',
                   'legacy-server-id', ?2)",
            rusqlite::params![project_path, "2026-01-01T00:00:00Z"],
        )
        .expect("insert legacy binding");
    connection
        .execute(
            "INSERT INTO deployment_runs VALUES (
                   'legacy-run-id', ?1, '旧项目', 'staging', 'success', 'complete',
                   '42', 'owner/legacy', 'main', '部署成功', '[]', ?2, ?2
                 )",
            rusqlite::params![project_path, "2026-01-02T00:00:00Z"],
        )
        .expect("insert legacy deployment");
    connection
        .execute(
            "INSERT INTO app_settings VALUES ('cnb-token', 'must-not-be-copied', ?1)",
            ["2026-01-01T00:00:00Z"],
        )
        .expect("insert legacy setting");
    drop(connection);

    let database = WorkspaceState::open(&path).expect("migrate legacy model");
    assert_eq!(
        database
            .project_adoption(std::path::Path::new(&project_path))
            .expect("legacy adoption")
            .mode,
        "pending"
    );
    assert!(
        database
            .list_deployment_runs(std::path::Path::new(&project_path))
            .expect("legacy history is gated")
            .is_empty()
    );
    database
        .continue_existing_deployment(std::path::Path::new(&project_path))
        .expect("adopt legacy deployment");
    {
        let connection = database.connection.lock().expect("database lock");
        let project_columns = {
            let mut statement = connection
                .prepare("PRAGMA table_info(projects)")
                .expect("project columns");
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query project columns")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect project columns")
        };
        assert!(project_columns.iter().any(|column| column == "hidden_at"));
        let hidden_at: Option<String> = connection
            .query_row(
                "SELECT hidden_at FROM projects WHERE id = 'legacy-project-id'",
                [],
                |row| row.get(0),
            )
            .expect("legacy project remains visible");
        assert!(hidden_at.is_none());
        let columns = {
            let mut statement = connection
                .prepare("PRAGMA table_info(deployment_runs)")
                .expect("deployment columns");
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .expect("query columns")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect columns")
        };
        for expected in [
            "project_id",
            "environment_id",
            "version_id",
            "task_kind",
            "target_snapshot_json",
            "config_snapshot_json",
        ] {
            assert!(columns.iter().any(|column| column == expected));
        }

        let storage_id: String = connection
            .query_row(
                "SELECT storage_id FROM project_identities
                     WHERE project_id = 'legacy-project-id'",
                [],
                |row| row.get(0),
            )
            .expect("migrated identity");
        assert_eq!(storage_id.len(), 64);
        let environments: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM environments
                     WHERE project_id = 'legacy-project-id'",
                [],
                |row| row.get(0),
            )
            .expect("migrated environments");
        assert_eq!(environments, 3);
        let target_connection: String = connection
            .query_row(
                "SELECT target_connection_id FROM environments
                     WHERE project_id = 'legacy-project-id' AND name = 'staging'",
                [],
                |row| row.get(0),
            )
            .expect("migrated target connection");
        assert_eq!(target_connection, "legacy-server:legacy-server-id");

        let connection_data: (Option<String>, String, String, String) = connection
            .query_row(
                "SELECT secret_ref, metadata_json, capabilities_json, status
                     FROM connections WHERE id = 'legacy-server:legacy-server-id'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("migrated connection");
        assert_eq!(connection_data.0, None);
        assert_eq!(
            serde_json::from_str::<BTreeMap<String, String>>(&connection_data.1)
                .expect("migrated safe metadata"),
            BTreeMap::from([
                ("host".to_string(), "203.0.113.40".to_string()),
                ("port".to_string(), "22".to_string()),
                ("user".to_string(), "ubuntu".to_string()),
            ])
        );
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&connection_data.2).expect("migrated capabilities"),
            vec!["deploy", "healthcheck", "reverse-proxy"]
        );
        assert_eq!(connection_data.3, "configured");

        let run_links: (Option<String>, Option<String>, Option<String>) = connection
            .query_row(
                "SELECT project_id, environment_id, version_id FROM deployment_runs
                     WHERE id = 'legacy-run-id'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("migrated run links");
        assert_eq!(run_links.0.as_deref(), Some("legacy-project-id"));
        assert_eq!(run_links.1.as_deref(), Some("legacy-project-id:staging"));
        assert!(run_links.2.is_some());
        let secret_occurrences: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM connections
                     WHERE COALESCE(secret_ref, '') LIKE '%must-not-be-copied%'
                        OR metadata_json LIKE '%must-not-be-copied%'
                        OR metadata_json LIKE '%/private/%'",
                [],
                |row| row.get(0),
            )
            .expect("no copied secrets");
        assert_eq!(secret_occurrences, 0);
    }
    assert_eq!(
        database
            .deployment_run("legacy-run-id")
            .expect("legacy deployment readable")
            .status,
        "success"
    );
    assert_eq!(
        database
            .list_projects()
            .expect("legacy project visible")
            .len(),
        1
    );
    drop(database);

    let reopened = WorkspaceState::open(&path).expect("reopen migrated model");
    let connection = reopened.connection.lock().expect("database lock");
    let hidden_column_count: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'hidden_at'",
            [],
            |row| row.get(0),
        )
        .expect("idempotent hidden column");
    assert_eq!(hidden_column_count, 1);
    let visibility_index_count: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'projects_visible_recent'",
            [],
            |row| row.get(0),
        )
        .expect("idempotent visibility index");
    assert_eq!(visibility_index_count, 1);
    for (table, expected_count) in [
        ("project_identities", 1_u32),
        ("connections", 1),
        ("project_connection_bindings", 0),
        ("environments", 3),
        ("versions", 1),
        ("version_artifacts", 0),
        ("version_validations", 0),
        ("automation_rules", 0),
    ] {
        let count: u32 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("idempotent count");
        assert_eq!(count, expected_count, "unexpected count in {table}");
    }
    let foreign_key_violations: u32 = connection
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .expect("foreign key check");
    assert_eq!(foreign_key_violations, 0);
}

#[test]
fn migrates_legacy_failed_only_project_without_inventing_a_version() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("legacy-failed-only.db");
    let project_path = directory.path().join("legacy-failed-project");
    fs::create_dir_all(&project_path).expect("create legacy project");
    let project_path_value = project_path
        .canonicalize()
        .expect("canonical legacy project")
        .to_string_lossy()
        .into_owned();
    let connection = Connection::open(&path).expect("open legacy database");
    connection
        .execute_batch(
            "CREATE TABLE projects (
                   id TEXT PRIMARY KEY,
                   path TEXT NOT NULL UNIQUE,
                   name TEXT NOT NULL,
                   current_step TEXT NOT NULL DEFAULT 'inspection',
                   manifest_exists INTEGER NOT NULL DEFAULT 0,
                   service_count INTEGER NOT NULL DEFAULT 0,
                   last_opened_at TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 CREATE TABLE deployment_runs (
                   id TEXT PRIMARY KEY,
                   project_path TEXT NOT NULL,
                   project_name TEXT NOT NULL,
                   environment TEXT NOT NULL,
                   status TEXT NOT NULL,
                   current_stage TEXT NOT NULL,
                   build_serial TEXT,
                   repository TEXT NOT NULL,
                   branch TEXT NOT NULL,
                   message TEXT NOT NULL,
                   completed_steps TEXT NOT NULL,
                   started_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );",
        )
        .expect("create legacy schema");
    connection
        .execute(
            "INSERT INTO projects (
                   id, path, name, manifest_exists, service_count, last_opened_at, created_at
                 ) VALUES ('legacy-failed-project-id', ?1, '失败项目', 1, 1, ?2, ?2)",
            rusqlite::params![project_path_value, "2026-01-01T00:00:00Z"],
        )
        .expect("insert legacy project");
    connection
        .execute(
            "INSERT INTO deployment_runs VALUES (
                   'legacy-failed-run', ?1, '失败项目', 'staging', 'failed', 'deploy',
                   '43', 'owner/failed', 'main', '部署失败', '[]', ?2, ?2
                 )",
            rusqlite::params![project_path_value, "2026-01-02T00:00:00Z"],
        )
        .expect("insert failed deployment");
    drop(connection);

    let database = WorkspaceState::open(&path).expect("migrate failed-only workspace");
    assert!(
        database
            .deployment_run("legacy-failed-run")
            .expect_err("pending deployment must not refresh")
            .contains("AD-ADOPT-101")
    );
    database
        .continue_existing_deployment(&project_path)
        .expect("adopt failed-only deployment");
    assert!(
        database
            .list_project_versions(&project_path)
            .expect("list migrated versions")
            .is_empty()
    );
    assert_eq!(
        database
            .deployment_run("legacy-failed-run")
            .expect("failed deployment remains readable")
            .status,
        "failed"
    );
    let staging = database
        .list_project_environments(&project_path)
        .expect("list environments")
        .into_iter()
        .find(|environment| environment.environment == "staging")
        .expect("staging environment");
    assert!(staging.current_version_key.is_none());
    assert!(staging.current_run_id.is_none());
}

#[test]
fn leaves_orphaned_legacy_deployments_unlinked() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("orphaned-run.db");
    let connection = Connection::open(&path).expect("open legacy database");
    connection
        .execute_batch(
            "CREATE TABLE deployment_runs (
                   id TEXT PRIMARY KEY,
                   project_path TEXT NOT NULL,
                   project_name TEXT NOT NULL,
                   environment TEXT NOT NULL,
                   status TEXT NOT NULL,
                   current_stage TEXT NOT NULL,
                   build_serial TEXT,
                   repository TEXT NOT NULL,
                   branch TEXT NOT NULL,
                   message TEXT NOT NULL,
                   completed_steps TEXT NOT NULL,
                   started_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 INSERT INTO deployment_runs VALUES (
                   'orphaned-run', '/missing/project', '已移除项目', 'production',
                   'failed', 'deploy', NULL, 'owner/missing', 'main', '失败', '[]',
                   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                 );",
        )
        .expect("create orphaned deployment");
    drop(connection);

    let database = WorkspaceState::open(&path).expect("migrate orphaned deployment");
    assert!(
        database
            .deployment_run("orphaned-run")
            .expect_err("orphaned run must not be refreshable")
            .contains("AD-ADOPT-101")
    );
    let connection = database.connection.lock().expect("database lock");
    let links: (Option<String>, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT project_id, environment_id, version_id
                 FROM deployment_runs WHERE id = 'orphaned-run'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("orphaned links");
    assert_eq!(links, (None, None, None));
}

#[test]
fn stores_reusable_profiles_and_project_bindings_without_secret_values() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    let profile = ConfigProfile {
        id: "minimax-primary".to_string(),
        kind: "ai".to_string(),
        provider: "minimax".to_string(),
        name: "常用 MiniMax".to_string(),
        scope: "any".to_string(),
        values: BTreeMap::from([
            (
                "base_url".to_string(),
                "https://api.minimax.chat/v1".to_string(),
            ),
            ("model".to_string(), "MiniMax-M2.5".to_string()),
        ]),
        secret_fields: vec!["api_key".to_string()],
        configured_secret_fields: vec!["api_key".to_string()],
        is_default: true,
        updated_at: String::new(),
    };

    database
        .save_config_profile(&profile)
        .expect("save profile metadata");
    let profiles = database.list_config_profiles().expect("list profiles");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].values["model"], "MiniMax-M2.5");
    assert!(profiles[0].configured_secret_fields.is_empty());

    let fallback = ConfigProfile {
        id: "minimax-backup".to_string(),
        name: "备用 MiniMax".to_string(),
        is_default: false,
        ..profile.clone()
    };
    database
        .save_config_profile(&fallback)
        .expect("save fallback profile");

    database
        .bind_config_profile(directory.path(), "development", "ai", &profile.id)
        .expect("bind profile");
    let bindings = database
        .config_profile_bindings(directory.path(), "development")
        .expect("list bindings");
    assert_eq!(bindings[0].profile_id, profile.id);

    assert!(
        database
            .remove_config_profile(&profile.id)
            .expect("remove profile")
    );
    assert!(
        database
            .config_profile(&fallback.id)
            .expect("fallback profile")
            .expect("fallback exists")
            .is_default
    );
    assert!(
        database
            .config_profile_bindings(directory.path(), "development")
            .expect("bindings removed")
            .is_empty()
    );
}

#[test]
fn keeps_independent_defaults_for_local_and_remote_connections() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    let local = ConfigProfile {
        id: "local-postgres".to_string(),
        kind: "database".to_string(),
        provider: "postgresql".to_string(),
        name: "本地 PostgreSQL".to_string(),
        scope: "local".to_string(),
        values: BTreeMap::new(),
        secret_fields: vec!["url".to_string()],
        configured_secret_fields: Vec::new(),
        is_default: true,
        updated_at: String::new(),
    };
    let remote = ConfigProfile {
        id: "remote-postgres".to_string(),
        name: "线上 PostgreSQL".to_string(),
        scope: "remote".to_string(),
        ..local.clone()
    };

    database
        .save_config_profile(&local)
        .expect("save local default");
    database
        .save_config_profile(&remote)
        .expect("save remote default");
    let profiles = database.list_config_profiles().expect("profiles");
    assert_eq!(profiles.len(), 2);
    assert!(profiles.iter().all(|profile| profile.is_default));
}

#[test]
fn upgrades_profile_bindings_and_supports_multiple_profiles_per_environment() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("legacy-bindings.db");
    let connection = Connection::open(&path).expect("open legacy database");
    connection
        .execute_batch(
            "CREATE TABLE config_profiles (
                   id TEXT PRIMARY KEY,
                   kind TEXT NOT NULL,
                   provider TEXT NOT NULL,
                   name TEXT NOT NULL,
                   scope TEXT NOT NULL DEFAULT 'any',
                   values_json TEXT NOT NULL,
                   secret_fields_json TEXT NOT NULL DEFAULT '[]',
                   is_default INTEGER NOT NULL DEFAULT 0,
                   updated_at TEXT NOT NULL,
                   created_at TEXT NOT NULL
                 );
                 CREATE TABLE project_profile_bindings (
                   project_path TEXT NOT NULL,
                   environment TEXT NOT NULL,
                   profile_kind TEXT NOT NULL,
                   profile_id TEXT NOT NULL,
                   updated_at TEXT NOT NULL,
                   PRIMARY KEY(project_path, environment, profile_kind),
                   FOREIGN KEY(profile_id) REFERENCES config_profiles(id)
                 );
                 INSERT INTO config_profiles VALUES
                   ('legacy-custom', 'custom', 'environment', '旧接口密钥', 'remote',
                    '{\"env_name\":\"API_KEY\"}', '[\"API_KEY\"]', 1,
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   ('legacy-database', 'database', 'postgresql', '旧数据库', 'remote',
                    '{}', '[\"url\"]', 1,
                    '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
                 INSERT INTO project_profile_bindings VALUES
                   ('/legacy/project', 'staging', 'custom', 'legacy-custom',
                    '2026-01-01T00:00:00Z'),
                   ('/legacy/project', 'staging', 'database', 'legacy-database',
                    '2026-01-01T00:00:00Z');",
        )
        .expect("create legacy binding schema");
    drop(connection);

    let database = WorkspaceState::open(&path).expect("upgrade bindings");
    database
        .remember_project(std::path::Path::new("/legacy/project"), "legacy", true, 1)
        .expect("adopt legacy binding project");
    let preserved = database
        .config_profile_bindings(std::path::Path::new("/legacy/project"), "staging")
        .expect("preserve old bindings");
    assert_eq!(preserved.len(), 2);
    assert!(
        preserved
            .iter()
            .any(|binding| binding.profile_id == "legacy-custom")
    );
    assert!(
        preserved
            .iter()
            .any(|binding| binding.profile_id == "legacy-database")
    );

    let second_custom = ConfigProfile {
        id: "second-custom".to_string(),
        kind: "custom".to_string(),
        provider: "environment".to_string(),
        name: "第二个环境变量".to_string(),
        scope: "remote".to_string(),
        values: BTreeMap::from([
            ("env_name".to_string(), "SECOND_KEY".to_string()),
            ("env_value".to_string(), "public-value".to_string()),
        ]),
        secret_fields: Vec::new(),
        configured_secret_fields: Vec::new(),
        is_default: false,
        updated_at: String::new(),
    };
    database
        .save_config_profile(&second_custom)
        .expect("save second custom profile");
    database
        .bind_config_profile(
            std::path::Path::new("/legacy/project"),
            "staging",
            "custom",
            &second_custom.id,
        )
        .expect("add another profile of the same kind");
    let additive = database
        .config_profile_bindings(std::path::Path::new("/legacy/project"), "staging")
        .expect("list additive bindings");
    assert_eq!(
        additive
            .iter()
            .filter(|binding| binding.kind == "custom")
            .count(),
        2
    );

    let replaced = database
        .set_environment_config_bindings(
            std::path::Path::new("/legacy/project"),
            "staging",
            &[
                "second-custom".to_string(),
                "legacy-custom".to_string(),
                "second-custom".to_string(),
            ],
        )
        .expect("replace environment bindings");
    assert_eq!(replaced.len(), 2);
    drop(database);

    let reopened = WorkspaceState::open(&path).expect("idempotent reopen");
    let bindings = reopened
        .config_profile_bindings(std::path::Path::new("/legacy/project"), "staging")
        .expect("read migrated bindings");
    assert_eq!(bindings.len(), 2);
    assert!(bindings.iter().all(|binding| binding.kind == "custom"));
    reopened
        .set_environment_config_bindings(std::path::Path::new("/legacy/project"), "staging", &[])
        .expect("clear bindings explicitly");
    assert!(
        reopened
            .config_profile_bindings(std::path::Path::new("/legacy/project"), "staging")
            .expect("bindings cleared")
            .is_empty()
    );
}

#[test]
fn preserves_the_same_deployment_task_when_preparation_is_paused_and_resumed() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("workspace.db");
    let task_id;
    {
        let database = WorkspaceState::open(&path).expect("open workspace");
        database
            .remember_project(directory.path(), "sample", true, 2)
            .expect("remember project");
        let mut task = database
            .create_deployment_run(
                directory.path(),
                "sample",
                "staging",
                "owner/sample",
                "main",
            )
            .expect("create deployment task");
        task_id = task.id.clone();
        task.commit_sha = Some("0123456789abcdef0123456789abcdef01234567".to_string());
        task.completed_steps.clear();
        task.status = "needs_action".to_string();
        task.current_stage = "sync-source".to_string();
        task.issue_code = Some("AD-GIT-102".to_string());
        task.action_kind = Some("retry-staging-preparation".to_string());
        task.message = "代码版本已保存，修复同步问题后继续当前任务".to_string();
        database
            .save_deployment_run(&task)
            .expect("pause deployment task");
    }

    let reopened = WorkspaceState::open(&path).expect("reopen workspace");
    let mut resumed = reopened
        .deployment_run(&task_id)
        .expect("load paused deployment task");
    assert_eq!(resumed.id, task_id);
    assert_eq!(resumed.status, "needs_action");
    assert_eq!(resumed.current_stage, "sync-source");
    assert_eq!(
        resumed.commit_sha.as_deref(),
        Some("0123456789abcdef0123456789abcdef01234567")
    );
    assert_eq!(
        resumed.action_kind.as_deref(),
        Some("retry-staging-preparation")
    );

    resumed.status = "queued".to_string();
    resumed.current_stage = "trigger-build".to_string();
    resumed.issue_code = None;
    resumed.action_kind = None;
    reopened
        .save_deployment_run(&resumed)
        .expect("resume the same deployment task");
    let after_resume = reopened
        .deployment_run(&task_id)
        .expect("reload resumed deployment task");
    assert_eq!(after_resume.id, task_id);
    assert_eq!(after_resume.status, "queued");
    assert_eq!(after_resume.current_stage, "trigger-build");
    assert_eq!(
        after_resume.commit_sha.as_deref(),
        Some("0123456789abcdef0123456789abcdef01234567")
    );
}

#[test]
fn keeps_the_latest_attention_task_for_each_environment() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database =
        WorkspaceState::open(&directory.path().join("workspace.db")).expect("open workspace");
    database
        .remember_project(directory.path(), "sample", true, 2)
        .expect("remember project");

    let mut production = database
        .create_deployment_run(
            directory.path(),
            "sample",
            "production",
            "owner/sample",
            "main",
        )
        .expect("create production run");
    production.status = "needs_action".to_string();
    production.current_stage = "healthcheck".to_string();
    production.action_kind = Some("route-check".to_string());
    production.started_at = "2026-01-01T00:00:00Z".to_string();
    production.updated_at = production.started_at.clone();
    database
        .save_deployment_run(&production)
        .expect("save pending production");

    let mut staging = database
        .create_deployment_run(
            directory.path(),
            "sample",
            "staging",
            "owner/sample",
            "main",
        )
        .expect("create staging run");
    staging.status = "success".to_string();
    staging.current_stage = "complete".to_string();
    staging.started_at = "2026-01-02T00:00:00Z".to_string();
    staging.updated_at = staging.started_at.clone();
    database
        .save_deployment_run(&staging)
        .expect("save newer staging success");

    let projects = database.list_projects().expect("list projects");
    assert_eq!(projects[0].latest_status.as_deref(), Some("success"));
    assert_eq!(projects[0].latest_environment.as_deref(), Some("staging"));
    let attention = database
        .list_attention_deployment_runs()
        .expect("attention runs");
    assert_eq!(attention.len(), 1);
    assert_eq!(attention[0].id, production.id);
    assert_eq!(attention[0].environment, "production");

    let mut completed_production = database
        .create_deployment_run(
            directory.path(),
            "sample",
            "production",
            "owner/sample",
            "main",
        )
        .expect("create completed production run");
    completed_production.status = "success".to_string();
    completed_production.current_stage = "complete".to_string();
    completed_production.source_run_id = Some(staging.id.clone());
    completed_production.started_at = "2026-01-03T00:00:00Z".to_string();
    completed_production.updated_at = completed_production.started_at.clone();
    database
        .save_deployment_run(&completed_production)
        .expect("save completed production");
    assert!(
        database
            .list_attention_deployment_runs()
            .expect("resolved attention runs")
            .is_empty()
    );

    let completed = database
        .list_recent_successful_deployment_runs()
        .expect("recent successful runs");
    assert_eq!(completed.len(), 2);
    assert_eq!(completed[0].id, completed_production.id);
    assert_eq!(completed[1].id, staging.id);

    let mut newer_staging = database
        .create_deployment_run(
            directory.path(),
            "sample",
            "staging",
            "owner/sample",
            "main",
        )
        .expect("create newer staging run");
    newer_staging.status = "success".to_string();
    newer_staging.current_stage = "complete".to_string();
    newer_staging.started_at = "2026-01-04T00:00:00Z".to_string();
    newer_staging.updated_at = newer_staging.started_at.clone();
    database
        .save_deployment_run(&newer_staging)
        .expect("save newer staging success");

    let completed = database
        .list_recent_successful_deployment_runs()
        .expect("deduplicated successful runs");
    assert_eq!(completed.len(), 2);
    assert_eq!(completed[0].id, newer_staging.id);
    assert_eq!(completed[1].id, completed_production.id);

    completed_production.updated_at = "2026-01-05T00:00:00Z".to_string();
    database
        .save_deployment_run(&completed_production)
        .expect("refresh older production result");
    let completed = database
        .list_recent_successful_deployment_runs()
        .expect("refresh must not reorder history");
    assert_eq!(completed[0].id, newer_staging.id);
    assert_eq!(completed[1].id, completed_production.id);
}

#[test]
fn remembers_and_resumes_projects_without_storing_secrets() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database =
        WorkspaceState::open(&directory.path().join("workspace.db")).expect("open workspace");
    database
        .remember_project(directory.path(), "sample", false, 3)
        .expect("remember project");
    database
        .set_project_step(directory.path(), "connections")
        .expect("save step");

    let projects = database.list_projects().expect("list projects");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "sample");
    assert_eq!(projects[0].service_count, 3);
    assert!(projects[0].path_exists);
    assert_eq!(
        database.project_step(directory.path()).expect("step"),
        Some("connections".to_string())
    );

    assert!(
        database
            .remove_project(directory.path())
            .expect("remove project")
    );
    assert!(database.list_projects().expect("empty").is_empty());
    assert!(
        !database
            .remove_project(directory.path())
            .expect("already-removed project")
    );

    database
        .remember_project(directory.path(), "sample", false, 3)
        .expect("re-add project from scratch");
    assert_eq!(
        database.project_step(directory.path()).expect("fresh step"),
        Some("inspection".to_string())
    );

    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "test-only-placeholder").expect("write key placeholder");
    database
        .remember_server(&SshProfile {
            name: "test-server".to_string(),
            host: "203.0.113.10".to_string(),
            user: "ubuntu".to_string(),
            port: 22,
            key_path: key_path.clone(),
            host_fingerprint: Some("SHA256:test".to_string()),
        })
        .expect("remember server");
    let servers = database.list_servers().expect("list servers");
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].host, "203.0.113.10");
    assert_eq!(servers[0].host_fingerprint.as_deref(), Some("SHA256:test"));
    assert_eq!(
        servers[0].key_path,
        key_path
            .canonicalize()
            .expect("canonical key")
            .to_string_lossy()
    );
    assert!(servers[0].key_path_exists);

    database
        .remember_project(directory.path(), "sample", true, 3)
        .expect("remember project again");
    assert_eq!(
        database
            .project_step(directory.path())
            .expect("fresh step remains"),
        Some("inspection".to_string())
    );
    assert_eq!(database.list_projects().expect("restored project").len(), 1);
    let mut run = database
        .create_deployment_run(
            directory.path(),
            "sample",
            "staging",
            "owner/sample",
            "main",
        )
        .expect("create run");
    run.status = "running".to_string();
    run.current_stage = "build".to_string();
    run.build_serial = Some("42".to_string());
    run.source_run_id = Some("tested-version".to_string());
    run.source_title = Some("修复登录并优化首页速度".to_string());
    run.candidate_tag = Some("deploydesk-0123456789abcdef".to_string());
    run.completed_steps = vec!["write-config".to_string(), "verify-build".to_string()];
    run.artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            .to_string(),
    }];
    run.started_at = "2025-01-02T03:04:05Z".to_string();
    run.updated_at = chrono::Utc::now().to_rfc3339();
    database.save_deployment_run(&run).expect("save run");
    let resumed = database.deployment_run(&run.id).expect("resume run");
    assert_eq!(resumed.build_serial.as_deref(), Some("42"));
    assert_eq!(resumed.current_stage, "build");
    assert_eq!(
        resumed.source_title.as_deref(),
        Some("修复登录并优化首页速度")
    );
    assert_eq!(resumed.started_at, "2025-01-02T03:04:05Z");
    assert_eq!(resumed.artifacts, run.artifacts);
    assert_eq!(
        database
            .list_active_deployment_runs()
            .expect("active runs")
            .len(),
        1
    );
    let projects = database.list_projects().expect("projects with status");
    assert_eq!(projects[0].latest_status.as_deref(), Some("running"));
    assert_eq!(projects[0].latest_run_id.as_deref(), Some(run.id.as_str()));
    assert_eq!(
        projects[0].latest_source_run_id.as_deref(),
        Some("tested-version")
    );
    assert_eq!(projects[0].latest_current_stage.as_deref(), Some("build"));
    assert_eq!(projects[0].latest_completed_steps, run.completed_steps);
    assert_eq!(
        projects[0].latest_updated_at.as_deref(),
        Some(run.updated_at.as_str())
    );
    assert_eq!(projects[0].active_run_count, 1);
    assert_eq!(
        database
            .list_deployment_runs(directory.path())
            .expect("list runs")
            .len(),
        1
    );

    let profile = SshProfile {
        name: "test-server".to_string(),
        host: "203.0.113.10".to_string(),
        user: "ubuntu".to_string(),
        port: 22,
        key_path,
        host_fingerprint: Some("SHA256:test".to_string()),
    };
    database
        .bind_project_server(directory.path(), "staging", &profile)
        .expect("bind server");
    assert_eq!(
        database
            .server_for_project(directory.path(), "staging")
            .expect("bound server")
            .expect("server")
            .host,
        "203.0.113.10"
    );
    database
        .set_setting("active-project", &directory.path().to_string_lossy())
        .expect("save setting");
    assert!(
        database
            .setting("active-project")
            .expect("read setting")
            .is_some()
    );
    let long_project_setting = format!(
        "project.{}.cnb-secret-pending.production",
        "Users%2Fdeveloper%2FDocuments%2FDeployWorkspace%2Fprojects%2F".repeat(3)
    );
    assert!(long_project_setting.len() > 80);
    database
        .set_setting(&long_project_setting, "true")
        .expect("save long project-scoped setting");
    assert_eq!(
        database
            .setting(&long_project_setting)
            .expect("read long project-scoped setting")
            .as_deref(),
        Some("true")
    );
    let settings = database
        .settings(&[
            "active-project".to_string(),
            long_project_setting.clone(),
            "missing".to_string(),
        ])
        .expect("read settings in one batch");
    let expected_active_project = directory.path().to_string_lossy().into_owned();
    assert_eq!(
        settings.get(&long_project_setting).map(String::as_str),
        Some("true")
    );
    assert_eq!(
        settings.get("active-project").map(String::as_str),
        Some(expected_active_project.as_str())
    );
    assert!(!settings.contains_key("missing"));
}

#[test]
fn persists_per_address_route_checks_across_workspace_restart() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database_path = directory.path().join("workspace.db");
    let database = WorkspaceState::open(&database_path).expect("open workspace");
    database
        .remember_project(directory.path(), "sample", true, 1)
        .expect("remember project");
    let mut run = database
        .create_deployment_run(
            directory.path(),
            "sample",
            "production",
            "owner/sample",
            "main",
        )
        .expect("create deployment");
    run.route_checks = vec![
        PublicRouteStatus {
            host: "app.example.com".to_string(),
            url: "https://app.example.com/".to_string(),
            phase: "ready".to_string(),
            reachable: true,
            http_status: Some(200),
            message: "app.example.com 可以访问".to_string(),
        },
        PublicRouteStatus {
            host: "api.example.com".to_string(),
            url: "https://api.example.com/".to_string(),
            phase: "https".to_string(),
            reachable: false,
            http_status: None,
            message: "api.example.com 的 HTTPS 尚未就绪".to_string(),
        },
    ];
    let run_id = run.id.clone();
    database
        .save_deployment_run(&run)
        .expect("save route checks");
    drop(database);

    let reopened = WorkspaceState::open(&database_path).expect("reopen workspace");
    let restored = reopened
        .deployment_run(&run_id)
        .expect("restore deployment");
    assert_eq!(restored.route_checks, run.route_checks);
    assert_eq!(
        reopened
            .list_deployment_runs(directory.path())
            .expect("list deployments")[0]
            .route_checks,
        run.route_checks
    );
}

#[test]
fn relinks_a_moved_project_without_losing_history_bindings_or_settings() {
    let directory = tempfile::tempdir().expect("temp dir");
    let old_path = directory.path().join("original project");
    let new_path = directory.path().join("moved project");
    fs::create_dir_all(&old_path).expect("create original project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&old_path, "sample", true, 2)
        .expect("remember project");
    database
        .set_project_step(&old_path, "connections")
        .expect("save project step");
    let original = database.list_projects().expect("original project")[0].clone();
    let recorded_old_path = std::path::PathBuf::from(&original.path);
    let original_storage_id = project_storage_id(&old_path);

    let mut run = database
        .create_deployment_run(&old_path, "sample", "staging", "team/sample", "main")
        .expect("create deployment history");
    run.status = "success".to_string();
    run.current_stage = "complete".to_string();
    database.save_deployment_run(&run).expect("save deployment");

    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "test-only-placeholder").expect("write key placeholder");
    database
        .bind_project_server(
            &old_path,
            "staging",
            &SshProfile {
                name: "test-server".to_string(),
                host: "203.0.113.20".to_string(),
                user: "ubuntu".to_string(),
                port: 22,
                key_path,
                host_fingerprint: Some("SHA256:moved".to_string()),
            },
        )
        .expect("bind server");
    let profile = ConfigProfile {
        id: "moved-database".to_string(),
        kind: "database".to_string(),
        provider: "postgresql".to_string(),
        name: "线上数据库".to_string(),
        scope: "remote".to_string(),
        values: BTreeMap::new(),
        secret_fields: vec!["url".to_string()],
        configured_secret_fields: Vec::new(),
        is_default: true,
        updated_at: String::new(),
    };
    database
        .save_config_profile(&profile)
        .expect("save profile");
    database
        .bind_config_profile(&old_path, "staging", "database", &profile.id)
        .expect("bind profile");

    let old_normalized = old_path
        .canonicalize()
        .expect("canonical original")
        .to_string_lossy()
        .into_owned();
    let old_setting = format!(
        "project.{}.verified-version",
        encode_uri_component(&old_normalized)
    );
    database
        .set_setting(&old_setting, "verified-image")
        .expect("save project setting");
    database
        .set_setting("active-project", &old_normalized)
        .expect("save active project");

    fs::rename(&old_path, &new_path).expect("move project folder");
    let recovered_path = database
        .relink_project(&recorded_old_path, &new_path, "sample", true, 2)
        .expect("relink moved project");
    let new_normalized = new_path
        .canonicalize()
        .expect("canonical moved path")
        .to_string_lossy()
        .into_owned();
    assert_eq!(recovered_path, new_normalized);
    assert_eq!(project_storage_id(&new_path), original_storage_id);
    assert!(
        fs::read_to_string(new_path.join(".deploydesk/.gitignore"))
            .expect("local state ignore")
            .lines()
            .any(|line| line == "state/")
    );

    let recovered = database.list_projects().expect("recovered project");
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].id, original.id);
    assert_eq!(recovered[0].path, new_normalized);
    assert!(recovered[0].path_exists);
    assert_eq!(recovered[0].latest_run_id.as_deref(), Some(run.id.as_str()));
    assert_eq!(
        database.project_step(&new_path).expect("preserved step"),
        Some("connections".to_string())
    );
    assert!(
        database
            .list_deployment_runs(&recorded_old_path)
            .expect("old history")
            .is_empty()
    );
    assert_eq!(
        database
            .list_deployment_runs(&new_path)
            .expect("moved history")[0]
            .id,
        run.id
    );
    assert_eq!(
        database
            .server_for_project(&new_path, "staging")
            .expect("moved server binding")
            .expect("bound server")
            .host,
        "203.0.113.20"
    );
    assert_eq!(
        database
            .config_profile_bindings(&new_path, "staging")
            .expect("moved profile binding")[0]
            .profile_id,
        profile.id
    );
    let new_setting = format!(
        "project.{}.verified-version",
        encode_uri_component(&new_normalized)
    );
    assert!(
        database
            .setting(&old_setting)
            .expect("old setting")
            .is_none()
    );
    assert_eq!(
        database
            .setting(&new_setting)
            .expect("moved setting")
            .as_deref(),
        Some("verified-image")
    );
    assert_eq!(
        database
            .setting("active-project")
            .expect("active project")
            .as_deref(),
        Some(new_normalized.as_str())
    );
}

#[test]
fn upgrades_existing_server_records_with_host_fingerprints() {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("legacy-workspace.db");
    let connection = Connection::open(&path).expect("open legacy database");
    connection
        .execute_batch(
            "CREATE TABLE servers (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   host TEXT NOT NULL,
                   user TEXT NOT NULL,
                   port INTEGER NOT NULL,
                   key_path TEXT NOT NULL,
                   last_checked_at TEXT NOT NULL,
                   created_at TEXT NOT NULL,
                   UNIQUE(host, user, port)
                 );
                 CREATE TABLE deployment_runs (
                   id TEXT PRIMARY KEY,
                   project_path TEXT NOT NULL,
                   project_name TEXT NOT NULL,
                   environment TEXT NOT NULL,
                   status TEXT NOT NULL,
                   current_stage TEXT NOT NULL,
                   build_serial TEXT,
                   repository TEXT NOT NULL,
                   branch TEXT NOT NULL,
                   message TEXT NOT NULL,
                   completed_steps TEXT NOT NULL,
                   started_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );",
        )
        .expect("create legacy server table");
    drop(connection);

    let database = WorkspaceState::open(&path).expect("upgrade workspace");
    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "test-only-placeholder").expect("write key placeholder");
    database
        .remember_server(&SshProfile {
            name: "upgraded-server".to_string(),
            host: "203.0.113.11".to_string(),
            user: "ubuntu".to_string(),
            port: 22,
            key_path,
            host_fingerprint: Some("SHA256:upgraded".to_string()),
        })
        .expect("remember upgraded server");
    let servers = database.list_servers().expect("list upgraded servers");
    assert_eq!(
        servers[0].host_fingerprint.as_deref(),
        Some("SHA256:upgraded")
    );

    database
        .remember_project(directory.path(), "upgraded-project", true, 1)
        .expect("remember upgraded project");
    let mut run = database
        .create_deployment_run(
            directory.path(),
            "upgraded-project",
            "staging",
            "owner/project",
            "main",
        )
        .expect("create upgraded run");
    run.commit_sha = Some("0123456789abcdef0123456789abcdef01234567".to_string());
    run.source_title = Some("旧数据库升级后也能保存版本说明".to_string());
    database
        .save_deployment_run(&run)
        .expect("save upgraded run");
    assert_eq!(
        database
            .deployment_run(&run.id)
            .expect("load upgraded run")
            .commit_sha
            .as_deref(),
        Some("0123456789abcdef0123456789abcdef01234567")
    );
    assert_eq!(
        database
            .deployment_run(&run.id)
            .expect("load upgraded run")
            .source_title
            .as_deref(),
        Some("旧数据库升级后也能保存版本说明")
    );
}

#[test]
fn persists_version_validation_across_workspace_restart() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database_path = directory.path().join("workspace.db");
    let expected_version_key;
    let run_id;
    {
        let database = WorkspaceState::open(&database_path).expect("open workspace");
        database
            .remember_project(&project_path, "sample", true, 1)
            .expect("remember project");
        let run = save_successful_staging_run(
            &database,
            &project_path,
            "1111111111111111111111111111111111111111",
            vec![DeploymentArtifact {
                service: " api ".to_string(),
                image: " registry.example.com/sample/api ".to_string(),
                digest: " SHA256:ABCDEF ".to_string(),
            }],
        );
        run_id = run.id.clone();
        expected_version_key =
            "images:api\0registry.example.com/sample/api\0sha256:abcdef".to_string();
        let validation = database
            .set_version_validation(&project_path, &run.id, "passed")
            .expect("confirm validation");
        assert_eq!(validation.version_key, expected_version_key);
        assert_eq!(validation.state, "passed");
    }

    let reopened = WorkspaceState::open(&database_path).expect("reopen workspace");
    let validations = reopened
        .list_version_validations(&project_path)
        .expect("list persisted validations");
    assert_eq!(validations.len(), 1);
    assert_eq!(validations[0].version_key, expected_version_key);
    assert_eq!(validations[0].state, "passed");
    assert_eq!(validations[0].run_id, run_id);
}

#[test]
fn lists_immutable_project_versions_with_artifacts_validation_and_environment_ownership() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 2)
        .expect("remember project");
    let artifacts = vec![
        DeploymentArtifact {
            service: " web ".to_string(),
            image: " registry.example.com/sample/web ".to_string(),
            digest: " SHA256:BBBB ".to_string(),
        },
        DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "sha256:aaaa".to_string(),
        },
    ];
    let mut staging = save_successful_staging_run(
        &database,
        &project_path,
        "5555555555555555555555555555555555555555",
        artifacts,
    );
    staging.build_serial = Some("501".to_string());
    staging.source_title = Some("加入批量导入".to_string());
    database
        .save_deployment_run(&staging)
        .expect("save staging source metadata");
    let validation = database
        .set_version_validation(&project_path, &staging.id, "passed")
        .expect("pass staging version");
    let production_artifacts = vec![
        DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "SHA256:AAAA".to_string(),
        },
        DeploymentArtifact {
            service: "web".to_string(),
            image: "registry.example.com/sample/web".to_string(),
            digest: "sha256:bbbb".to_string(),
        },
    ];
    let production = save_successful_production_run(
        &database,
        &staging,
        production_artifacts,
        "2030-01-01T00:00:00Z",
    );
    let mut approval = database
        .create_deployment_run(&project_path, "sample", "staging", "owner/sample", "main")
        .expect("create production approval record");
    approval.status = "success".to_string();
    approval.current_stage = "complete".to_string();
    approval.commit_sha.clone_from(&staging.commit_sha);
    approval.artifacts.clone_from(&staging.artifacts);
    approval.action_kind = Some("production-approval".to_string());
    approval.started_at = "2035-01-01T00:00:00Z".to_string();
    approval.updated_at = approval.started_at.clone();
    database
        .save_deployment_run(&approval)
        .expect("save production approval record");
    let mut failed = database
        .create_deployment_run(&project_path, "sample", "staging", "owner/sample", "main")
        .expect("create failed staging record");
    failed.status = "failed".to_string();
    failed.current_stage = "deploy".to_string();
    failed.commit_sha.clone_from(&staging.commit_sha);
    failed.artifacts.clone_from(&staging.artifacts);
    failed.started_at = "2040-01-01T00:00:00Z".to_string();
    failed.updated_at = failed.started_at.clone();
    database
        .save_deployment_run(&failed)
        .expect("save failed staging record");
    {
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE deployment_runs
                     SET version_id = (
                       SELECT version_id FROM deployment_runs WHERE id = ?2
                     )
                     WHERE id = ?1",
                rusqlite::params![failed.id, staging.id],
            )
            .expect("link legacy failed record to immutable version");
    }

    let versions = database
        .list_project_versions(&project_path)
        .expect("list versions");
    assert_eq!(versions.len(), 1);
    let version = &versions[0];
    assert_eq!(version.version_key, validation.version_key);
    assert_eq!(version.status, "available");
    assert_eq!(version.commit_sha, staging.commit_sha);
    assert_eq!(version.source_title, staging.source_title);
    assert_eq!(version.source_build_id.as_deref(), Some("501"));
    assert!(version.source_connection_id.is_none());
    assert_eq!(version.repository.as_deref(), Some("owner/sample"));
    assert_eq!(version.branch.as_deref(), Some("main"));
    assert_eq!(version.staging_run_id.as_deref(), Some(staging.id.as_str()));
    assert_ne!(
        version.staging_run_id.as_deref(),
        Some(production.id.as_str())
    );
    assert_ne!(
        version.staging_run_id.as_deref(),
        Some(approval.id.as_str())
    );
    assert_ne!(version.staging_run_id.as_deref(), Some(failed.id.as_str()));
    assert_eq!(version.validation.as_ref(), Some(&validation));
    assert_eq!(
        version.current_environments,
        vec!["staging".to_string(), "production".to_string()]
    );
    assert_eq!(
        version.artifacts,
        vec![
            DeploymentArtifact {
                service: "api".to_string(),
                image: "registry.example.com/sample/api".to_string(),
                digest: "sha256:aaaa".to_string(),
            },
            DeploymentArtifact {
                service: "web".to_string(),
                image: "registry.example.com/sample/web".to_string(),
                digest: "sha256:bbbb".to_string(),
            },
        ]
    );
    assert_eq!(
        database
            .deployment_run(&production.id)
            .expect("production remains linked")
            .source_run_id,
        Some(staging.id)
    );
}

#[test]
fn failed_deployment_does_not_create_a_project_version() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    let mut run = database
        .create_deployment_run(&project_path, "sample", "staging", "owner/sample", "main")
        .expect("create failed run");
    run.status = "failed".to_string();
    run.current_stage = "deploy".to_string();
    run.commit_sha = Some("6666666666666666666666666666666666666666".to_string());
    run.artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:cccc".to_string(),
    }];
    database.save_deployment_run(&run).expect("save failed run");

    assert!(
        database
            .list_project_versions(&project_path)
            .expect("list versions")
            .is_empty()
    );
}

#[test]
fn shares_validation_between_runs_with_the_same_immutable_artifacts() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 2)
        .expect("remember project");
    let first = save_successful_staging_run(
        &database,
        &project_path,
        "2222222222222222222222222222222222222222",
        vec![
            DeploymentArtifact {
                service: "web".to_string(),
                image: "registry.example.com/sample/web".to_string(),
                digest: "sha256:bbbb".to_string(),
            },
            DeploymentArtifact {
                service: "api".to_string(),
                image: "registry.example.com/sample/api".to_string(),
                digest: "sha256:aaaa".to_string(),
            },
        ],
    );
    database
        .set_version_validation(&project_path, &first.id, "passed")
        .expect("pass first run");
    let second = save_successful_staging_run(
        &database,
        &project_path,
        "3333333333333333333333333333333333333333",
        vec![
            DeploymentArtifact {
                service: "api".to_string(),
                image: "registry.example.com/sample/api".to_string(),
                digest: "SHA256:AAAA".to_string(),
            },
            DeploymentArtifact {
                service: "web".to_string(),
                image: "registry.example.com/sample/web".to_string(),
                digest: "SHA256:BBBB".to_string(),
            },
        ],
    );

    let connection = database.connection.lock().expect("database lock");
    let version_count: u32 = connection
        .query_row("SELECT COUNT(*) FROM versions", [], |row| row.get(0))
        .expect("version count");
    let linked_versions: (String, String) = connection
        .query_row(
            "SELECT first.version_id, second.version_id
                 FROM deployment_runs first, deployment_runs second
                 WHERE first.id = ?1 AND second.id = ?2",
            rusqlite::params![first.id, second.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("linked versions");
    drop(connection);
    assert_eq!(version_count, 1);
    assert_eq!(linked_versions.0, linked_versions.1);
    let validations = database
        .list_version_validations(&project_path)
        .expect("shared validation");
    assert_eq!(validations.len(), 1);
    assert_eq!(validations[0].state, "passed");
}

#[test]
fn latest_rejected_result_replaces_the_previous_passed_result() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    let run = save_successful_staging_run(
        &database,
        &project_path,
        "4444444444444444444444444444444444444444",
        Vec::new(),
    );
    database
        .set_version_validation(&project_path, &run.id, "passed")
        .expect("pass version");
    let rejected = database
        .set_version_validation(&project_path, &run.id, "rejected")
        .expect("reject version");
    assert_eq!(rejected.state, "rejected");
    assert_eq!(
        rejected.version_key,
        format!("commit:{}", run.commit_sha.unwrap())
    );

    let validations = database
        .list_version_validations(&project_path)
        .expect("latest validation");
    assert_eq!(validations.len(), 1);
    assert_eq!(validations[0].state, "rejected");
    let connection = database.connection.lock().expect("database lock");
    let validation_count: u32 = connection
        .query_row("SELECT COUNT(*) FROM version_validations", [], |row| {
            row.get(0)
        })
        .expect("validation count");
    assert_eq!(validation_count, 1);
}

#[test]
fn production_success_reuses_the_staging_version_and_updates_environment_pointer() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    let artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:1111".to_string(),
    }];
    let staging = save_successful_staging_run(
        &database,
        &project_path,
        "1111111111111111111111111111111111111111",
        artifacts.clone(),
    );
    let production =
        save_successful_production_run(&database, &staging, artifacts, "2026-07-01T00:00:00Z");

    let environments = database
        .list_project_environments(&project_path)
        .expect("list environments");
    assert_eq!(
        environments
            .iter()
            .map(|environment| environment.environment.as_str())
            .collect::<Vec<_>>(),
        vec!["development", "staging", "production"]
    );
    let staging_environment = environments
        .iter()
        .find(|environment| environment.environment == "staging")
        .expect("staging environment");
    let production_environment = environments
        .iter()
        .find(|environment| environment.environment == "production")
        .expect("production environment");
    assert_eq!(staging_environment.status, "healthy");
    assert_eq!(production_environment.status, "healthy");
    assert_eq!(
        production_environment.current_version_key,
        staging_environment.current_version_key
    );
    assert_eq!(
        production_environment.current_run_id.as_deref(),
        Some(production.id.as_str())
    );

    let connection = database.connection.lock().expect("database lock");
    let (staging_version_id, production_version_id): (String, String) = connection
        .query_row(
            "SELECT staging.version_id, production.version_id
                 FROM deployment_runs staging, deployment_runs production
                 WHERE staging.id = ?1 AND production.id = ?2",
            rusqlite::params![staging.id, production.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("linked versions");
    assert_eq!(production_version_id, staging_version_id);
    let version_count: u32 = connection
        .query_row("SELECT COUNT(*) FROM versions", [], |row| row.get(0))
        .expect("version count");
    assert_eq!(version_count, 1);
}

#[test]
fn newer_failed_or_needs_action_production_does_not_replace_online_version() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    let first_artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:1111".to_string(),
    }];
    let first_source = save_successful_staging_run(
        &database,
        &project_path,
        "1111111111111111111111111111111111111111",
        first_artifacts.clone(),
    );
    let first_production = save_successful_production_run(
        &database,
        &first_source,
        first_artifacts,
        "2026-07-01T00:00:00Z",
    );
    let second_source = save_successful_staging_run(
        &database,
        &project_path,
        "2222222222222222222222222222222222222222",
        vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "sha256:2222".to_string(),
        }],
    );
    for status in ["failed", "needs_action"] {
        let mut attempt = database
            .create_deployment_run(
                &project_path,
                "sample",
                "production",
                "owner/sample",
                "main",
            )
            .expect("create unsuccessful production run");
        attempt.status = status.to_string();
        attempt.source_run_id = Some(second_source.id.clone());
        attempt.started_at = format!(
            "2026-07-0{}T00:00:00Z",
            if status == "failed" { 2 } else { 3 }
        );
        attempt.updated_at.clone_from(&attempt.started_at);
        database
            .save_deployment_run(&attempt)
            .expect("save unsuccessful production run");
    }

    let production = database
        .list_project_environments(&project_path)
        .expect("list environments")
        .into_iter()
        .find(|environment| environment.environment == "production")
        .expect("production environment");
    assert_eq!(production.status, "healthy");
    assert_eq!(
        production.current_run_id.as_deref(),
        Some(first_production.id.as_str())
    );
}

#[test]
fn restart_backfills_production_history_and_preserves_a_newer_rollback() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database_path = directory.path().join("workspace.db");
    let first_source_id;
    let second_source_id;
    let first_production_id;
    let second_production_id;
    let rollback_id;
    {
        let database = WorkspaceState::open(&database_path).expect("workspace");
        database
            .remember_project(&project_path, "sample", true, 1)
            .expect("remember project");
        let first_artifacts = vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "sha256:1111".to_string(),
        }];
        let second_artifacts = vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "sha256:2222".to_string(),
        }];
        let first_source = save_successful_staging_run(
            &database,
            &project_path,
            "1111111111111111111111111111111111111111",
            first_artifacts.clone(),
        );
        let second_source = save_successful_staging_run(
            &database,
            &project_path,
            "2222222222222222222222222222222222222222",
            second_artifacts.clone(),
        );
        let first_production = save_successful_production_run(
            &database,
            &first_source,
            first_artifacts.clone(),
            "2026-07-01T00:00:00Z",
        );
        let second_production = save_successful_production_run(
            &database,
            &second_source,
            second_artifacts,
            "2026-07-02T00:00:00Z",
        );
        let rollback = save_successful_production_run(
            &database,
            &first_source,
            first_artifacts,
            "2026-07-03T00:00:00Z",
        );
        first_source_id = first_source.id;
        second_source_id = second_source.id;
        first_production_id = first_production.id;
        second_production_id = second_production.id;
        rollback_id = rollback.id;

        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE deployment_runs SET version_id = NULL
                     WHERE environment = 'production'",
                [],
            )
            .expect("clear legacy production version links");
        connection
            .execute(
                "UPDATE environments
                     SET current_version_id = NULL,
                         current_deployment_run_id = NULL,
                         status = 'unknown'
                     WHERE name = 'production'",
                [],
            )
            .expect("clear legacy production pointer");
    }

    let reopened = WorkspaceState::open(&database_path).expect("reopen workspace");
    let production = reopened
        .list_project_environments(&project_path)
        .expect("list restored environments")
        .into_iter()
        .find(|environment| environment.environment == "production")
        .expect("production environment");
    assert_eq!(production.status, "healthy");
    assert_eq!(
        production.current_run_id.as_deref(),
        Some(rollback_id.as_str())
    );
    let connection = reopened.connection.lock().expect("database lock");
    let (first_source_version, second_source_version): (String, String) = connection
        .query_row(
            "SELECT first.version_id, second.version_id
                 FROM deployment_runs first, deployment_runs second
                 WHERE first.id = ?1 AND second.id = ?2",
            rusqlite::params![first_source_id, second_source_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("source versions");
    let (first_production_version, second_production_version, rollback_version): (
        String,
        String,
        String,
    ) = connection
        .query_row(
            "SELECT first.version_id, second.version_id, rollback.version_id
                 FROM deployment_runs first, deployment_runs second, deployment_runs rollback
                 WHERE first.id = ?1 AND second.id = ?2 AND rollback.id = ?3",
            rusqlite::params![first_production_id, second_production_id, rollback_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("restored production versions");
    assert_eq!(first_production_version, first_source_version);
    assert_eq!(second_production_version, second_source_version);
    assert_eq!(rollback_version, first_source_version);
    let current_version: String = connection
        .query_row(
            "SELECT current_version_id FROM environments
                 WHERE name = 'production'",
            [],
            |row| row.get(0),
        )
        .expect("current production version");
    assert_eq!(current_version, first_source_version);
}

#[test]
fn production_digest_mismatch_is_atomic_and_does_not_switch_pointer() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");
    let first_artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:1111".to_string(),
    }];
    let first_source = save_successful_staging_run(
        &database,
        &project_path,
        "1111111111111111111111111111111111111111",
        first_artifacts.clone(),
    );
    let current = save_successful_production_run(
        &database,
        &first_source,
        first_artifacts,
        "2026-07-01T00:00:00Z",
    );
    let second_source = save_successful_staging_run(
        &database,
        &project_path,
        "2222222222222222222222222222222222222222",
        vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: "sha256:2222".to_string(),
        }],
    );
    let mut mismatch = database
        .create_deployment_run(
            &project_path,
            "sample",
            "production",
            "owner/sample",
            "main",
        )
        .expect("create mismatched production run");
    mismatch.status = "success".to_string();
    mismatch.current_stage = "complete".to_string();
    mismatch.source_run_id = Some(second_source.id);
    mismatch.artifacts = vec![DeploymentArtifact {
        service: "api".to_string(),
        image: "registry.example.com/sample/api".to_string(),
        digest: "sha256:deadbeef".to_string(),
    }];
    mismatch.started_at = "2026-07-02T00:00:00Z".to_string();
    mismatch.updated_at.clone_from(&mismatch.started_at);
    let error = database
        .save_deployment_run(&mismatch)
        .expect_err("reject mismatched digest");
    assert!(error.contains("镜像摘要与测试通过版本不一致"));

    let production = database
        .list_project_environments(&project_path)
        .expect("list environments")
        .into_iter()
        .find(|environment| environment.environment == "production")
        .expect("production environment");
    assert_eq!(
        production.current_run_id.as_deref(),
        Some(current.id.as_str())
    );
    let stored_attempt = database
        .deployment_run(&mismatch.id)
        .expect("load original queued attempt");
    assert_eq!(stored_attempt.status, "queued");
    let connection = database.connection.lock().expect("database lock");
    let version_id: Option<String> = connection
        .query_row(
            "SELECT version_id FROM deployment_runs WHERE id = ?1",
            [mismatch.id],
            |row| row.get(0),
        )
        .expect("mismatch version link");
    assert!(version_id.is_none());
}

#[test]
fn persists_pending_managed_and_fresh_draft_adoption_states_across_restarts() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database_path = directory.path().join("workspace.db");
    let existing_project = directory.path().join("existing");
    let new_project = directory.path().join("new");
    fs::create_dir_all(&existing_project).expect("create existing project");
    fs::create_dir_all(&new_project).expect("create new project");

    {
        let database = WorkspaceState::open(&database_path).expect("workspace");
        database
            .remember_project_with_identity(
                &existing_project,
                "existing",
                true,
                1,
                Some("owner/existing"),
                None,
            )
            .expect("remember existing project");
        let pending = database
            .initialize_project_adoption(&existing_project, true)
            .expect("pending adoption");
        assert_eq!(pending.mode, "pending");
        assert!(!pending.fresh_draft);
        assert!(pending.history_import_after.is_none());

        let managed = database
            .continue_existing_deployment(&existing_project)
            .expect("continue existing deployment");
        assert_eq!(managed.mode, "managed");
        assert!(!managed.fresh_draft);

        database
            .remember_project_with_identity(&new_project, "new", false, 1, Some("owner/new"), None)
            .expect("remember new project");
        let fresh = database
            .initialize_project_adoption(&new_project, false)
            .expect("fresh adoption");
        assert_eq!(fresh.mode, "fresh");
        assert!(fresh.fresh_draft);
        assert!(fresh.history_import_after.is_some());
        database
            .mark_project_fresh_draft_saved(&new_project)
            .expect("save fresh draft");
    }

    let reopened = WorkspaceState::open(&database_path).expect("reopen workspace");
    assert_eq!(
        reopened
            .project_adoption(&existing_project)
            .expect("managed adoption")
            .mode,
        "managed"
    );
    let fresh = reopened
        .project_adoption(&new_project)
        .expect("fresh adoption");
    assert_eq!(fresh.mode, "fresh");
    assert!(!fresh.fresh_draft);
    assert!(fresh.history_import_after.is_some());
}

#[test]
fn fresh_initialization_removes_legacy_rows_before_the_new_draft_is_saved() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project-with-removed-files");
    fs::create_dir_all(&project_path).expect("create project");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember managed project");
    let old_run = database
        .create_deployment_run(&project_path, "sample", "staging", "owner/sample", "main")
        .expect("create old run");
    {
        let normalized_path = super::normalize_path(&project_path);
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE projects
                     SET deployment_adoption_mode = 'pending',
                         external_import_after = NULL,
                         adoption_decided_at = NULL,
                         deployment_fresh_draft = 0
                     WHERE path = ?1",
                [&normalized_path],
            )
            .expect("simulate migrated pending project");
    }

    let fresh = database
        .initialize_project_adoption(&project_path, false)
        .expect("start fresh without deployment files");
    assert_eq!(fresh.mode, "fresh");
    assert!(fresh.fresh_draft);
    database
        .mark_project_fresh_draft_saved(&project_path)
        .expect("save replacement draft");
    assert!(
        database
            .list_deployment_runs(&project_path)
            .expect("old history stays removed")
            .is_empty()
    );
    assert!(
        database
            .deployment_run(&old_run.id)
            .expect_err("old run was deleted")
            .contains("找不到这次部署记录")
    );
}

#[test]
fn reset_clears_only_project_deployment_state_and_blocks_stale_resurrection() {
    let directory = tempfile::tempdir().expect("temp dir");
    let project_path = directory.path().join("project");
    fs::create_dir_all(&project_path).expect("create project");
    let manifest_path = project_path.join("deploy.yaml");
    fs::write(&manifest_path, "project: unchanged\n").expect("write project manifest");
    let database = WorkspaceState::open(&directory.path().join("workspace.db")).expect("workspace");
    database
        .remember_project(&project_path, "sample", true, 1)
        .expect("remember project");

    let metadata = BTreeMap::new();
    database
        .upsert_compat_connection(
            CNB_SOURCE_CONNECTION_ID,
            "source",
            "cnb",
            "CNB",
            Some("cnb-token"),
            &metadata,
            &["builds".to_string()],
            "ready",
            None,
        )
        .expect("save source connection");
    database
        .upsert_compat_connection(
            TCR_REGISTRY_CONNECTION_ID,
            "registry",
            "tcr",
            "TCR",
            Some("registry.tcr.v2.password"),
            &metadata,
            &["pull".to_string()],
            "ready",
            None,
        )
        .expect("save registry connection");
    database
        .bind_project_source_connection(&project_path, Some(CNB_SOURCE_CONNECTION_ID))
        .expect("bind source");
    database
        .bind_project_registry_connection(
            &project_path,
            "staging",
            Some(TCR_REGISTRY_CONNECTION_ID),
        )
        .expect("bind registry");

    let key_path = directory.path().join("id_ed25519");
    fs::write(&key_path, "private-key-placeholder").expect("write key placeholder");
    let server = SshProfile {
        name: "test server".to_string(),
        host: "192.0.2.10".to_string(),
        user: "ubuntu".to_string(),
        port: 22,
        key_path,
        host_fingerprint: Some("SHA256:test".to_string()),
    };
    database
        .bind_project_server(&project_path, "staging", &server)
        .expect("bind server");

    let profile = ConfigProfile {
        id: "profile-shared".to_string(),
        kind: "custom".to_string(),
        provider: "environment".to_string(),
        name: "shared config".to_string(),
        scope: "any".to_string(),
        values: BTreeMap::from([("FEATURE".to_string(), "on".to_string())]),
        secret_fields: Vec::new(),
        configured_secret_fields: Vec::new(),
        is_default: false,
        updated_at: String::new(),
    };
    database
        .save_config_profile(&profile)
        .expect("save config profile");
    database
        .bind_config_profile(&project_path, "staging", "custom", &profile.id)
        .expect("bind staging config");
    database
        .bind_config_profile(&project_path, "development", "custom", &profile.id)
        .expect("bind development config");

    let run = save_successful_staging_run(
        &database,
        &project_path,
        "1111111111111111111111111111111111111111",
        vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/sample/api".to_string(),
            digest: format!("sha256:{}", "1".repeat(64)),
        }],
    );
    database
        .set_version_validation(&project_path, &run.id, "passed")
        .expect("validate version");

    let normalized_path = super::normalize_path(&project_path);
    let prefix = format!("project.{}.", encode_uri_component(&normalized_path));
    for suffix in [
        "version-setup-complete",
        "verified-run",
        "cnb-secret-progress.staging",
        "production-health-check.old-run",
        "staging-runtime-ready.ubuntu%40host%3A22",
    ] {
        database
            .set_setting(&format!("{prefix}{suffix}"), "saved")
            .expect("save deployment setting");
    }
    database
        .set_setting(&format!("{prefix}local-milestone"), "opened")
        .expect("save local setting");
    database
        .set_setting("registry.mode", "tcr")
        .expect("save global setting");

    {
        let connection = database.connection.lock().expect("database lock");
        let project_id: String = connection
            .query_row(
                "SELECT id FROM projects WHERE path = ?1",
                [&normalized_path],
                |row| row.get(0),
            )
            .expect("project id");
        connection
            .execute(
                "INSERT INTO automation_rules (
                       id, project_id, name, trigger_kind, action_kind,
                       desired_state, observed_state, created_at, updated_at
                     ) VALUES ('rule', ?1, 'main', 'push', 'deploy',
                               'enabled', 'ready', 'now', 'now')",
                [&project_id],
            )
            .expect("save automation rule");
    }

    let reset = database
        .reset_project_deployment(&project_path)
        .expect("reset deployment");
    assert_eq!(reset.mode, "fresh");
    assert!(reset.fresh_draft);
    assert!(reset.history_import_after.is_some());
    assert_eq!(
        fs::read_to_string(&manifest_path).expect("read manifest"),
        "project: unchanged\n"
    );
    assert!(
        database
            .list_deployment_runs(&project_path)
            .expect("list runs")
            .is_empty()
    );
    assert!(
        database
            .list_project_versions(&project_path)
            .expect("list versions")
            .is_empty()
    );
    for environment in database
        .list_project_environments(&project_path)
        .expect("list environments")
        .into_iter()
        .filter(|environment| matches!(environment.environment.as_str(), "staging" | "production"))
    {
        assert_eq!(environment.status, "unknown");
        assert!(environment.current_run_id.is_none());
        assert!(environment.current_version_key.is_none());
    }
    assert_eq!(
        database
            .project_connection_bindings(&project_path)
            .expect("connection bindings"),
        super::ProjectConnectionBindings::default()
    );
    assert!(
        database
            .server_for_project(&project_path, "staging")
            .expect("server binding")
            .is_none()
    );
    assert!(
        database
            .config_profile_bindings(&project_path, "staging")
            .expect("staging config bindings")
            .is_empty()
    );
    assert_eq!(
        database
            .config_profile_bindings(&project_path, "development")
            .expect("development config bindings")
            .len(),
        1
    );
    assert_eq!(
        database.list_connections(None).expect("connections").len(),
        3
    );
    assert_eq!(database.list_servers().expect("servers").len(), 1);
    assert!(
        database
            .config_profile(&profile.id)
            .expect("profile")
            .is_some()
    );
    assert_eq!(
        database
            .setting("registry.mode")
            .expect("global setting")
            .as_deref(),
        Some("tcr")
    );
    assert_eq!(
        database
            .setting(&format!("{prefix}local-milestone"))
            .expect("local setting")
            .as_deref(),
        Some("opened")
    );
    assert!(
        database
            .setting(&format!("{prefix}version-setup-complete"))
            .expect("setup setting")
            .is_none()
    );

    let stale_error = database
        .save_deployment_run(&run)
        .expect_err("stale run must not be resurrected");
    assert!(stale_error.contains("AD-STATE-STALE"));
    assert!(
        database
            .list_deployment_runs(&project_path)
            .expect("runs after stale save")
            .is_empty()
    );
}

#[test]
fn pending_and_fresh_draft_hide_legacy_state_until_continue_backfills_it() {
    let directory = tempfile::tempdir().expect("temp dir");
    let database_path = directory.path().join("workspace.db");
    let project_path = directory.path().join("legacy-project");
    fs::create_dir_all(&project_path).expect("create project");
    let normalized_path = super::normalize_path(&project_path);
    let success_id = "legacy-staging-success".to_string();
    let active_id = "legacy-production-active".to_string();

    {
        let database = WorkspaceState::open(&database_path).expect("workspace");
        database
            .remember_project_with_identity(
                &project_path,
                "legacy",
                true,
                1,
                Some("owner/legacy"),
                None,
            )
            .expect("remember pending project");

        let key_path = directory.path().join("legacy_id_ed25519");
        fs::write(&key_path, "private-key-placeholder").expect("write key placeholder");
        let server = SshProfile {
            name: "legacy server".to_string(),
            host: "192.0.2.44".to_string(),
            user: "ubuntu".to_string(),
            port: 22,
            key_path,
            host_fingerprint: Some("SHA256:legacy".to_string()),
        };
        database.remember_server(&server).expect("remember server");
        let server_id =
            super::project_id(&format!("{}@{}:{}", server.user, server.host, server.port));

        let mut success = database
            .deployment_run_draft(&project_path, "legacy", "staging", "owner/legacy", "main")
            .expect("staging draft");
        success.id.clone_from(&success_id);
        success.status = "success".to_string();
        success.current_stage = "complete".to_string();
        success.commit_sha = Some("1111111111111111111111111111111111111111".to_string());
        success.artifacts = vec![DeploymentArtifact {
            service: "api".to_string(),
            image: "registry.example.com/legacy/api".to_string(),
            digest: format!("sha256:{}", "1".repeat(64)),
        }];
        success.started_at = "2026-07-01T00:00:00Z".to_string();
        success.updated_at.clone_from(&success.started_at);

        let mut active = database
            .deployment_run_draft(
                &project_path,
                "legacy",
                "production",
                "owner/legacy",
                "main",
            )
            .expect("production draft");
        active.id.clone_from(&active_id);
        active.status = "running".to_string();
        active.current_stage = "deploy".to_string();
        active.started_at = "2026-07-02T00:00:00Z".to_string();
        active.updated_at.clone_from(&active.started_at);

        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "INSERT INTO project_server_bindings (
                       project_path, environment, server_id, updated_at
                     ) VALUES (?1, 'staging', ?2, '2026-07-01T00:00:00Z')",
                rusqlite::params![normalized_path, server_id],
            )
            .expect("insert legacy server binding");
        for run in [&success, &active] {
            let artifacts = serde_json::to_string(&run.artifacts).expect("artifacts");
            let completed_steps =
                serde_json::to_string(&run.completed_steps).expect("completed steps");
            connection
                .execute(
                    "INSERT INTO deployment_runs (
                           id, project_path, project_name, environment, status,
                           current_stage, build_serial, commit_sha, source_title,
                           source_run_id, candidate_tag, artifacts, action_kind,
                           action_url, issue_code, repository, branch, message,
                           completed_steps, started_at, updated_at
                         ) VALUES (
                           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                           ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
                         )",
                    rusqlite::params![
                        run.id,
                        run.project_path,
                        run.project_name,
                        run.environment,
                        run.status,
                        run.current_stage,
                        run.build_serial,
                        run.commit_sha,
                        run.source_title,
                        run.source_run_id,
                        run.candidate_tag,
                        artifacts,
                        run.action_kind,
                        run.action_url,
                        run.issue_code,
                        run.repository,
                        run.branch,
                        run.message,
                        completed_steps,
                        run.started_at,
                        run.updated_at,
                    ],
                )
                .expect("insert legacy run");
        }
    }

    let database = WorkspaceState::open(&database_path).expect("reopen workspace");
    assert_eq!(
        database
            .project_adoption(&project_path)
            .expect("pending adoption")
            .mode,
        "pending"
    );
    assert!(
        database
            .list_deployment_runs(&project_path)
            .expect("hidden runs")
            .is_empty()
    );
    assert!(
        database
            .list_project_versions(&project_path)
            .expect("hidden versions")
            .is_empty()
    );
    assert!(
        database
            .server_for_project(&project_path, "staging")
            .expect("hidden server")
            .is_none()
    );
    assert!(
        database
            .list_active_deployment_runs()
            .expect("hidden active runs")
            .is_empty()
    );
    assert!(
        database
            .list_attention_deployment_runs()
            .expect("hidden attention runs")
            .is_empty()
    );
    assert!(
        database
            .list_recent_successful_deployment_runs()
            .expect("hidden successful runs")
            .is_empty()
    );
    assert!(
        database
            .deployment_run(&active_id)
            .expect_err("refresh must be blocked")
            .contains("AD-ADOPT-101")
    );
    let pending_project = database.list_projects().expect("pending project").remove(0);
    assert!(pending_project.latest_run_id.is_none());
    assert_eq!(pending_project.active_run_count, 0);

    database
        .continue_existing_deployment(&project_path)
        .expect("continue managing");
    assert_eq!(
        database
            .list_deployment_runs(&project_path)
            .expect("visible runs")
            .len(),
        2
    );
    assert_eq!(
        database
            .list_project_versions(&project_path)
            .expect("backfilled versions")
            .len(),
        1
    );
    assert!(
        database
            .server_for_project(&project_path, "staging")
            .expect("visible server")
            .is_some()
    );
    assert_eq!(
        database
            .list_active_deployment_runs()
            .expect("visible active runs")
            .len(),
        1
    );
    assert_eq!(
        database
            .list_recent_successful_deployment_runs()
            .expect("visible successful runs")
            .len(),
        1
    );
    assert_eq!(
        database
            .list_projects()
            .expect("managed project")
            .remove(0)
            .latest_run_id
            .as_deref(),
        Some(active_id.as_str())
    );

    // The same storage gates also cover the short fresh-draft window,
    // even if a stale row somehow exists outside the public save API.
    {
        let connection = database.connection.lock().expect("database lock");
        connection
            .execute(
                "UPDATE projects
                     SET deployment_adoption_mode = 'fresh', deployment_fresh_draft = 1
                     WHERE path = ?1",
                [&normalized_path],
            )
            .expect("mark fresh draft");
    }
    assert!(
        database
            .list_deployment_runs(&project_path)
            .expect("fresh draft runs")
            .is_empty()
    );
    assert!(
        database
            .list_active_deployment_runs()
            .expect("fresh draft active runs")
            .is_empty()
    );
    assert!(
        database
            .server_for_project(&project_path, "staging")
            .expect("fresh draft server")
            .is_none()
    );
}
