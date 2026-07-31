use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::checklist::{is_checklist_revision_current, project_checklist};
use super::model::{
    ActionChecklist, ChecklistPhase, ChecklistRevisionInputs, ChecklistState,
    DeploymentEnvironmentKind,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrimaryActionKind {
    AwaitSelection,
    RunLocally,
    DeployToServer,
    ContinueVerification,
    RetryChecks,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrimaryActionReason {
    SourceRequired,
    EnvironmentRequired,
    Idle,
    Scanning,
    Blocked,
    CheckFailed,
    StaleRevision,
    Ready,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryActionProjection {
    pub kind: PrimaryActionKind,
    pub enabled: bool,
    pub reason: PrimaryActionReason,
    pub checklist_state: ChecklistState,
    pub unresolved_action_count: usize,
}

#[must_use]
pub fn project_primary_action(
    source_selected: bool,
    environment: Option<DeploymentEnvironmentKind>,
    checklist: &ActionChecklist,
    current_revision: Option<&ChecklistRevisionInputs>,
) -> PrimaryActionProjection {
    let checklist_projection = project_checklist(checklist);
    let unavailable = |reason| PrimaryActionProjection {
        kind: PrimaryActionKind::AwaitSelection,
        enabled: false,
        reason,
        checklist_state: checklist_projection.state,
        unresolved_action_count: checklist_projection.unresolved_action_count,
    };

    if !source_selected {
        return unavailable(PrimaryActionReason::SourceRequired);
    }
    let Some(environment) = environment else {
        return unavailable(PrimaryActionReason::EnvironmentRequired);
    };

    let intended_kind = match checklist.phase {
        ChecklistPhase::Verification => PrimaryActionKind::ContinueVerification,
        ChecklistPhase::Readiness => match environment {
            DeploymentEnvironmentKind::Local => PrimaryActionKind::RunLocally,
            DeploymentEnvironmentKind::Server => PrimaryActionKind::DeployToServer,
        },
    };
    let projected = |kind, enabled, reason| PrimaryActionProjection {
        kind,
        enabled,
        reason,
        checklist_state: checklist_projection.state,
        unresolved_action_count: checklist_projection.unresolved_action_count,
    };

    if checklist_projection.state == ChecklistState::Idle {
        return projected(intended_kind, false, PrimaryActionReason::Idle);
    }
    if current_revision
        .is_none_or(|current| !is_checklist_revision_current(checklist.revision.as_ref(), current))
    {
        return projected(intended_kind, false, PrimaryActionReason::StaleRevision);
    }

    match checklist_projection.state {
        ChecklistState::Idle => projected(intended_kind, false, PrimaryActionReason::Idle),
        ChecklistState::Scanning => projected(intended_kind, false, PrimaryActionReason::Scanning),
        ChecklistState::Blocked => projected(intended_kind, false, PrimaryActionReason::Blocked),
        ChecklistState::Ready => projected(intended_kind, true, PrimaryActionReason::Ready),
        ChecklistState::CheckFailed => projected(
            PrimaryActionKind::RetryChecks,
            true,
            PrimaryActionReason::CheckFailed,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mvp::model::{
        ActionItem, ActionItemStatus, ChecklistPhase, ChecklistRevision, RequiredCheck,
        RequiredCheckStatus,
    };

    fn inputs() -> ChecklistRevisionInputs {
        ChecklistRevisionInputs {
            source_version: "source-v1".into(),
            environment_version: "environment-v1".into(),
            configuration_version: "configuration-v1".into(),
        }
    }

    fn checklist(phase: ChecklistPhase) -> ActionChecklist {
        ActionChecklist {
            phase,
            revision: Some(ChecklistRevision {
                id: "revision-1".into(),
                source_version: "source-v1".into(),
                environment_version: "environment-v1".into(),
                configuration_version: "configuration-v1".into(),
            }),
            required_check_ids: vec!["source".into()],
            checks: vec![RequiredCheck {
                id: "source".into(),
                status: RequiredCheckStatus::Passed,
            }],
            items: Vec::new(),
        }
    }

    #[test]
    fn selection_gaps_never_enable_an_execution_action() {
        let snapshot = checklist(ChecklistPhase::Readiness);
        let no_source = project_primary_action(
            false,
            Some(DeploymentEnvironmentKind::Local),
            &snapshot,
            Some(&inputs()),
        );
        assert_eq!(no_source.kind, PrimaryActionKind::AwaitSelection);
        assert_eq!(no_source.reason, PrimaryActionReason::SourceRequired);
        assert!(!no_source.enabled);

        let no_environment = project_primary_action(true, None, &snapshot, Some(&inputs()));
        assert_eq!(no_environment.kind, PrimaryActionKind::AwaitSelection);
        assert_eq!(
            no_environment.reason,
            PrimaryActionReason::EnvironmentRequired
        );
        assert!(!no_environment.enabled);
    }

    #[test]
    fn current_ready_readiness_projects_the_environment_specific_action() {
        let snapshot = checklist(ChecklistPhase::Readiness);

        let local = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Local),
            &snapshot,
            Some(&inputs()),
        );
        assert_eq!(local.kind, PrimaryActionKind::RunLocally);
        assert_eq!(local.reason, PrimaryActionReason::Ready);
        assert!(local.enabled);

        let server = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Server),
            &snapshot,
            Some(&inputs()),
        );
        assert_eq!(server.kind, PrimaryActionKind::DeployToServer);
        assert!(server.enabled);
    }

    #[test]
    fn verification_can_only_project_continue_verification() {
        let snapshot = checklist(ChecklistPhase::Verification);
        let projection = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Server),
            &snapshot,
            Some(&inputs()),
        );

        assert_eq!(projection.kind, PrimaryActionKind::ContinueVerification);
        assert_eq!(projection.reason, PrimaryActionReason::Ready);
        assert!(projection.enabled);
    }

    #[test]
    fn stale_scanning_and_blocked_states_keep_the_projected_action_disabled() {
        let mut snapshot = checklist(ChecklistPhase::Readiness);
        let stale = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Local),
            &snapshot,
            Some(&ChecklistRevisionInputs {
                source_version: "source-v2".into(),
                ..inputs()
            }),
        );
        assert_eq!(stale.kind, PrimaryActionKind::RunLocally);
        assert_eq!(stale.reason, PrimaryActionReason::StaleRevision);
        assert!(!stale.enabled);

        snapshot.checks[0].status = RequiredCheckStatus::Running;
        let scanning = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Local),
            &snapshot,
            Some(&inputs()),
        );
        assert_eq!(scanning.reason, PrimaryActionReason::Scanning);
        assert!(!scanning.enabled);

        snapshot.checks[0].status = RequiredCheckStatus::NeedsUserAction;
        snapshot.items.push(ActionItem {
            id: "configuration".into(),
            title: "configuration".into(),
            reason: "required".into(),
            status: ActionItemStatus::Pending,
            action_key: "configure".into(),
            validator_key: "validate-configuration".into(),
            invalidated_by: Vec::new(),
            last_validation: None,
        });
        let blocked = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Local),
            &snapshot,
            Some(&inputs()),
        );
        assert_eq!(blocked.reason, PrimaryActionReason::Blocked);
        assert!(!blocked.enabled);
        assert_eq!(blocked.unresolved_action_count, 1);
    }

    #[test]
    fn system_check_failure_projects_retry_instead_of_an_execution_action() {
        let mut snapshot = checklist(ChecklistPhase::Readiness);
        snapshot.checks[0].status = RequiredCheckStatus::SystemFailed;

        let projection = project_primary_action(
            true,
            Some(DeploymentEnvironmentKind::Server),
            &snapshot,
            Some(&inputs()),
        );

        assert_eq!(projection.kind, PrimaryActionKind::RetryChecks);
        assert_eq!(projection.reason, PrimaryActionReason::CheckFailed);
        assert!(projection.enabled);
    }
}
