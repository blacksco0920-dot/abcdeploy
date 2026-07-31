use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChecklistPhase {
    Readiness,
    Verification,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChecklistState {
    Idle,
    Scanning,
    Blocked,
    Ready,
    CheckFailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequiredCheckStatus {
    Pending,
    Running,
    Passed,
    NeedsUserAction,
    SystemFailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActionItemStatus {
    Pending,
    Checking,
    Completed,
    StillBlocked,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChecklistRevisionDimension {
    Source,
    Environment,
    Configuration,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistRevisionInputs {
    pub source_version: String,
    pub environment_version: String,
    pub configuration_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistRevision {
    pub id: String,
    pub source_version: String,
    pub environment_version: String,
    pub configuration_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RequiredCheck {
    pub id: String,
    pub status: RequiredCheckStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionItemValidation {
    pub passed: bool,
    pub checked_at_ms: i64,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionItem {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub status: ActionItemStatus,
    pub action_key: String,
    pub validator_key: String,
    #[serde(default)]
    pub invalidated_by: Vec<ChecklistRevisionDimension>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_validation: Option<ActionItemValidation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActionChecklist {
    pub phase: ChecklistPhase,
    pub revision: Option<ChecklistRevision>,
    pub required_check_ids: Vec<String>,
    pub checks: Vec<RequiredCheck>,
    pub items: Vec<ActionItem>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentEnvironmentKind {
    Local,
    Server,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceCheckKind {
    SourceIdentity,
    RuntimeIdentity,
    ServiceHealth,
    DependencyHealth,
    PublicAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct EvidenceRequirement {
    pub id: String,
    pub kind: EvidenceCheckKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceCheck {
    pub requirement_id: String,
    pub kind: EvidenceCheckKind,
    pub expected: String,
    pub actual: String,
    pub location: String,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_evidence_ref: Option<String>,
}

/// One verifier sampling round. `checked_at_ms` is the observation time for
/// every check in the round, keeping the checks on one comparable clock.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRound {
    pub checked_at_ms: i64,
    pub checks: Vec<EvidenceCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct DeploymentEvidence {
    pub requirements: Vec<EvidenceRequirement>,
    pub rounds: Vec<EvidenceRound>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VerificationAvailability {
    Online,
    Offline,
}
