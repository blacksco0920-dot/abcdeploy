use std::collections::BTreeMap;

use deploy_core::model::PublicRouteStatus;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAdoptionRecord {
    pub mode: String,
    pub history_import_after: Option<String>,
    pub fresh_draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResource {
    pub id: String,
    pub kind: String,
    pub provider: String,
    pub name: String,
    pub status: String,
    pub last_checked_at: Option<String>,
    pub capabilities: Vec<String>,
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentConnectionBindings {
    pub target_connection_id: Option<String>,
    pub registry_connection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConnectionBindings {
    pub source_connection_id: Option<String>,
    pub staging: EnvironmentConnectionBindings,
    pub production: EnvironmentConnectionBindings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPath {
    pub id: String,
    pub project_path: String,
    pub name: String,
    pub source_connection_id: Option<String>,
    pub registry_connection_id: Option<String>,
    pub server_id: Option<String>,
    pub config_profile_ids: Vec<String>,
    pub address: String,
    pub routes: Vec<DeploymentPathRoute>,
    pub state: String,
    pub last_run_id: Option<String>,
    pub current_run_id: Option<String>,
    pub last_successful_revision: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPathInput {
    pub id: Option<String>,
    pub project_path: String,
    pub name: String,
    pub source_connection_id: Option<String>,
    pub registry_connection_id: Option<String>,
    pub server_id: Option<String>,
    #[serde(default)]
    pub config_profile_ids: Vec<String>,
    pub address: String,
    #[serde(default)]
    pub routes: Vec<DeploymentPathRoute>,
    pub state: Option<String>,
    pub last_run_id: Option<String>,
    pub current_run_id: Option<String>,
    pub last_successful_revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentPathRoute {
    pub service: String,
    pub host: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentAttempt {
    pub id: String,
    pub task_id: String,
    pub ordinal: u32,
    pub status: String,
    pub current_stage: String,
    pub input_snapshot: serde_json::Value,
    pub output: serde_json::Value,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ProjectRelinkIdentity {
    pub name: String,
    pub service_count: u32,
    pub storage_id: String,
    pub repository: Option<String>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub id: String,
    pub path: String,
    pub name: String,
    pub current_step: String,
    pub manifest_exists: bool,
    pub service_count: u32,
    pub last_opened_at: String,
    pub path_exists: bool,
    pub latest_status: Option<String>,
    pub latest_environment: Option<String>,
    pub latest_message: Option<String>,
    pub latest_run_id: Option<String>,
    pub latest_source_run_id: Option<String>,
    pub latest_current_stage: Option<String>,
    pub latest_action_kind: Option<String>,
    pub latest_issue_code: Option<String>,
    pub latest_completed_steps: Vec<String>,
    pub latest_updated_at: Option<String>,
    pub active_run_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerResource {
    pub id: String,
    pub name: String,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub key_path: String,
    pub host_fingerprint: Option<String>,
    pub key_path_exists: bool,
    pub last_checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigProfile {
    pub id: String,
    pub kind: String,
    pub provider: String,
    pub name: String,
    pub scope: String,
    pub values: BTreeMap<String, String>,
    pub secret_fields: Vec<String>,
    #[serde(default)]
    pub configured_secret_fields: Vec<String>,
    pub is_default: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectProfileBinding {
    pub environment: String,
    pub kind: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEnvironment {
    pub environment: String,
    pub display_name: String,
    pub status: String,
    pub current_version_key: Option<String>,
    pub current_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentRun {
    pub id: String,
    pub project_path: String,
    pub project_name: String,
    pub environment: String,
    pub status: String,
    pub current_stage: String,
    pub build_serial: Option<String>,
    pub commit_sha: Option<String>,
    pub source_title: Option<String>,
    pub source_run_id: Option<String>,
    pub candidate_tag: Option<String>,
    pub artifacts: Vec<DeploymentArtifact>,
    #[serde(default)]
    pub route_checks: Vec<PublicRouteStatus>,
    pub action_kind: Option<String>,
    pub action_url: Option<String>,
    pub issue_code: Option<String>,
    pub repository: String,
    pub branch: String,
    pub message: String,
    pub completed_steps: Vec<String>,
    pub started_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentArtifact {
    pub service: String,
    pub image: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionValidation {
    pub version_key: String,
    pub state: String,
    pub run_id: String,
    pub verified_at: String,
}

/// One immutable project version. Deployment failures deliberately do not
/// appear here: a version exists only after a successful deployment produced
/// a stable commit or OCI digest identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVersion {
    pub id: String,
    pub version_key: String,
    pub status: String,
    pub commit_sha: Option<String>,
    pub source_title: Option<String>,
    pub source_connection_id: Option<String>,
    pub source_build_id: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub candidate_tag: Option<String>,
    pub staging_run_id: Option<String>,
    pub artifacts: Vec<DeploymentArtifact>,
    pub validation: Option<VersionValidation>,
    pub current_environments: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}
