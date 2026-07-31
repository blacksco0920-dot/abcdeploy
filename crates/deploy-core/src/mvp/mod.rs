pub mod checklist;
pub mod evidence;
pub mod model;
pub mod projection;

pub use checklist::{
    ChecklistProjection, DeploymentStartGate, DeploymentStartGateReason,
    is_checklist_revision_current, project_checklist, project_deployment_start_gate,
};
pub use evidence::{
    EVIDENCE_FRESHNESS_MS, EvidenceContinuation, EvidenceProjection, EvidenceStatus,
    MINIMUM_PASS_INTERVAL_MS, MINIMUM_STABILITY_WINDOW_MS, REQUIRED_CONSECUTIVE_PASSES,
    project_evidence,
};
pub use model::*;
pub use projection::{
    PrimaryActionKind, PrimaryActionProjection, PrimaryActionReason, project_primary_action,
};
