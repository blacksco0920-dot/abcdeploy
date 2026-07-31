use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::model::{
    ActionChecklist, ActionItemStatus, ChecklistPhase, ChecklistRevision, ChecklistRevisionInputs,
    ChecklistState, RequiredCheckStatus,
};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistProjection {
    pub state: ChecklistState,
    pub revision_id: Option<String>,
    pub total_action_count: usize,
    pub completed_action_count: usize,
    pub unresolved_action_count: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentStartGateReason {
    Ready,
    Idle,
    Scanning,
    Blocked,
    CheckFailed,
    StaleRevision,
    VerificationPhase,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentStartGate {
    pub can_start: bool,
    pub reason: DeploymentStartGateReason,
    pub checklist_state: ChecklistState,
    pub revision_id: Option<String>,
    pub unresolved_action_count: usize,
}

#[must_use]
pub fn project_checklist(checklist: &ActionChecklist) -> ChecklistProjection {
    let total_action_count = checklist.items.len();
    let completed_action_count = checklist
        .items
        .iter()
        .filter(|item| item.status == ActionItemStatus::Completed)
        .count();
    let unresolved_action_count = total_action_count - completed_action_count;
    let revision_id = checklist
        .revision
        .as_ref()
        .map(|revision| revision.id.clone());

    let state = if checklist.revision.is_none() {
        ChecklistState::Idle
    } else if required_checks_are_incomplete(checklist) {
        ChecklistState::Scanning
    } else if required_checks_include(checklist, RequiredCheckStatus::SystemFailed) {
        ChecklistState::CheckFailed
    } else if required_checks_include(checklist, RequiredCheckStatus::NeedsUserAction)
        || unresolved_action_count > 0
    {
        ChecklistState::Blocked
    } else {
        ChecklistState::Ready
    };

    ChecklistProjection {
        state,
        revision_id,
        total_action_count,
        completed_action_count,
        unresolved_action_count,
    }
}

#[must_use]
pub fn is_checklist_revision_current(
    revision: Option<&ChecklistRevision>,
    current: &ChecklistRevisionInputs,
) -> bool {
    revision.is_some_and(|revision| {
        revision.source_version == current.source_version
            && revision.environment_version == current.environment_version
            && revision.configuration_version == current.configuration_version
    })
}

#[must_use]
pub fn project_deployment_start_gate(
    checklist: &ActionChecklist,
    current: &ChecklistRevisionInputs,
) -> DeploymentStartGate {
    let projection = project_checklist(checklist);
    let blocked = |reason| DeploymentStartGate {
        can_start: false,
        reason,
        checklist_state: projection.state,
        revision_id: projection.revision_id.clone(),
        unresolved_action_count: projection.unresolved_action_count,
    };

    if checklist.phase != ChecklistPhase::Readiness {
        return blocked(DeploymentStartGateReason::VerificationPhase);
    }
    if projection.state == ChecklistState::Idle {
        return blocked(DeploymentStartGateReason::Idle);
    }
    if !is_checklist_revision_current(checklist.revision.as_ref(), current) {
        return blocked(DeploymentStartGateReason::StaleRevision);
    }

    let reason = match projection.state {
        ChecklistState::Idle => DeploymentStartGateReason::Idle,
        ChecklistState::Scanning => DeploymentStartGateReason::Scanning,
        ChecklistState::Blocked => DeploymentStartGateReason::Blocked,
        ChecklistState::Ready => {
            return DeploymentStartGate {
                can_start: true,
                reason: DeploymentStartGateReason::Ready,
                checklist_state: projection.state,
                revision_id: projection.revision_id,
                unresolved_action_count: projection.unresolved_action_count,
            };
        }
        ChecklistState::CheckFailed => DeploymentStartGateReason::CheckFailed,
    };
    blocked(reason)
}

fn required_checks_are_incomplete(checklist: &ActionChecklist) -> bool {
    checklist.required_check_ids.iter().any(|required_id| {
        let matching = checklist
            .checks
            .iter()
            .filter(|check| check.id == *required_id)
            .collect::<Vec<_>>();
        matching.is_empty()
            || matching.iter().any(|check| {
                matches!(
                    check.status,
                    RequiredCheckStatus::Pending | RequiredCheckStatus::Running
                )
            })
    })
}

fn required_checks_include(checklist: &ActionChecklist, status: RequiredCheckStatus) -> bool {
    checklist.required_check_ids.iter().any(|required_id| {
        checklist
            .checks
            .iter()
            .any(|check| check.id == *required_id && check.status == status)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mvp::model::{
        ActionItem, ActionItemStatus, ChecklistPhase, RequiredCheck, RequiredCheckStatus,
    };

    fn inputs() -> ChecklistRevisionInputs {
        ChecklistRevisionInputs {
            source_version: "source-v1".into(),
            environment_version: "environment-v1".into(),
            configuration_version: "configuration-v1".into(),
        }
    }

    fn revision() -> ChecklistRevision {
        let inputs = inputs();
        ChecklistRevision {
            id: "revision-1".into(),
            source_version: inputs.source_version,
            environment_version: inputs.environment_version,
            configuration_version: inputs.configuration_version,
        }
    }

    fn required_check(id: &str, status: RequiredCheckStatus) -> RequiredCheck {
        RequiredCheck {
            id: id.into(),
            status,
        }
    }

    fn action(id: &str, status: ActionItemStatus) -> ActionItem {
        ActionItem {
            id: id.into(),
            title: format!("action {id}"),
            reason: "requires user input".into(),
            status,
            action_key: format!("resolve-{id}"),
            validator_key: format!("validate-{id}"),
            invalidated_by: Vec::new(),
            last_validation: None,
        }
    }

    fn checklist() -> ActionChecklist {
        ActionChecklist {
            phase: ChecklistPhase::Readiness,
            revision: Some(revision()),
            required_check_ids: vec!["source".into(), "environment".into()],
            checks: vec![
                required_check("source", RequiredCheckStatus::Passed),
                required_check("environment", RequiredCheckStatus::Passed),
            ],
            items: Vec::new(),
        }
    }

    #[test]
    fn stays_idle_until_an_evaluation_revision_exists() {
        let mut snapshot = checklist();
        snapshot.revision = None;
        snapshot.required_check_ids.clear();
        snapshot.checks.clear();

        let projection = project_checklist(&snapshot);

        assert_eq!(projection.state, ChecklistState::Idle);
        assert_eq!(projection.total_action_count, 0);
        assert_eq!(projection.unresolved_action_count, 0);
    }

    #[test]
    fn remains_scanning_until_every_required_check_is_terminal() {
        let mut missing = checklist();
        missing.checks.pop();
        let mut running = checklist();
        running.checks[1].status = RequiredCheckStatus::Running;

        assert_eq!(project_checklist(&missing).state, ChecklistState::Scanning);
        assert_eq!(project_checklist(&running).state, ChecklistState::Scanning);
    }

    #[test]
    fn system_failure_waits_for_other_checkers_then_projects_check_failed() {
        let mut snapshot = checklist();
        snapshot.checks[0].status = RequiredCheckStatus::SystemFailed;
        snapshot.checks[1].status = RequiredCheckStatus::Running;
        assert_eq!(project_checklist(&snapshot).state, ChecklistState::Scanning);

        snapshot.checks[1].status = RequiredCheckStatus::Passed;
        assert_eq!(
            project_checklist(&snapshot).state,
            ChecklistState::CheckFailed
        );
    }

    #[test]
    fn projects_all_actions_together_and_only_completed_actions_allow_ready() {
        let mut snapshot = checklist();
        snapshot.checks[0].status = RequiredCheckStatus::NeedsUserAction;
        snapshot.items = vec![
            action("configuration", ActionItemStatus::Pending),
            action("access", ActionItemStatus::StillBlocked),
        ];

        let blocked = project_checklist(&snapshot);
        assert_eq!(blocked.state, ChecklistState::Blocked);
        assert_eq!(blocked.total_action_count, 2);
        assert_eq!(blocked.completed_action_count, 0);
        assert_eq!(blocked.unresolved_action_count, 2);

        snapshot.checks[0].status = RequiredCheckStatus::Passed;
        for item in &mut snapshot.items {
            item.status = ActionItemStatus::Completed;
        }
        let ready = project_checklist(&snapshot);
        assert_eq!(ready.state, ChecklistState::Ready);
        assert_eq!(ready.completed_action_count, 2);
        assert_eq!(ready.unresolved_action_count, 0);
    }

    #[test]
    fn any_revision_input_change_invalidates_the_start_gate() {
        let snapshot = checklist();
        assert!(is_checklist_revision_current(
            snapshot.revision.as_ref(),
            &inputs()
        ));

        let changed_inputs = [
            ChecklistRevisionInputs {
                source_version: "source-v2".into(),
                ..inputs()
            },
            ChecklistRevisionInputs {
                environment_version: "environment-v2".into(),
                ..inputs()
            },
            ChecklistRevisionInputs {
                configuration_version: "configuration-v2".into(),
                ..inputs()
            },
        ];

        for changed in changed_inputs {
            assert!(!is_checklist_revision_current(
                snapshot.revision.as_ref(),
                &changed
            ));
            assert_eq!(
                project_deployment_start_gate(&snapshot, &changed).reason,
                DeploymentStartGateReason::StaleRevision
            );
        }
    }

    #[test]
    fn only_a_current_ready_readiness_revision_can_start_deployment() {
        let snapshot = checklist();
        assert_eq!(
            project_deployment_start_gate(&snapshot, &inputs()),
            DeploymentStartGate {
                can_start: true,
                reason: DeploymentStartGateReason::Ready,
                checklist_state: ChecklistState::Ready,
                revision_id: Some("revision-1".into()),
                unresolved_action_count: 0,
            }
        );

        let mut verification = snapshot;
        verification.phase = ChecklistPhase::Verification;
        let gate = project_deployment_start_gate(&verification, &inputs());
        assert!(!gate.can_start);
        assert_eq!(gate.reason, DeploymentStartGateReason::VerificationPhase);
    }
}
