use super::*;
use std::fs;

#[test]
fn current_run_query_keeps_the_online_version_after_a_failed_update() {
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
    let path = database
        .save_deployment_path(DeploymentPathInput {
            id: None,
            project_path: project_path.to_string_lossy().into_owned(),
            name: "上线".to_string(),
            source_connection_id: None,
            registry_connection_id: None,
            server_id: None,
            config_profile_ids: Vec::new(),
            address: "app.example.com".to_string(),
            routes: vec![],
            state: Some("ready".to_string()),
            last_run_id: None,
            current_run_id: None,
            last_successful_revision: None,
        })
        .expect("save path");

    let mut online = database
        .create_deployment_run(&project_path, "sample", "deployment", "team/sample", "main")
        .expect("create online run");
    database
        .bind_deployment_path_run(&path.id, &online.id)
        .expect("bind online run");
    online.status = "success".to_string();
    online.current_stage = "complete".to_string();
    database
        .save_deployment_run(&online)
        .expect("save online run");
    let edited_path = database
        .save_deployment_path(DeploymentPathInput {
            id: Some(path.id.clone()),
            project_path: path.project_path.clone(),
            name: "线上".to_string(),
            source_connection_id: path.source_connection_id.clone(),
            registry_connection_id: path.registry_connection_id.clone(),
            server_id: path.server_id.clone(),
            config_profile_ids: path.config_profile_ids.clone(),
            address: path.address.clone(),
            routes: path.routes.clone(),
            state: Some("online".to_string()),
            last_run_id: Some(online.id.clone()),
            current_run_id: Some(online.id.clone()),
            last_successful_revision: path.last_successful_revision.clone(),
        })
        .expect("edit path without losing its online version");
    assert_eq!(
        edited_path.current_run_id.as_deref(),
        Some(online.id.as_str())
    );

    let mut failed = database
        .create_deployment_run(&project_path, "sample", "deployment", "team/sample", "main")
        .expect("create update run");
    database
        .bind_deployment_path_run(&path.id, &failed.id)
        .expect("bind update run");
    failed.status = "failed".to_string();
    failed.current_stage = "deploy".to_string();
    database
        .save_deployment_run(&failed)
        .expect("save failed update");

    let current = database
        .list_current_deployment_runs()
        .expect("list current deployment runs");
    assert_eq!(current.len(), 1);
    assert_eq!(current[0].id, online.id);
}
