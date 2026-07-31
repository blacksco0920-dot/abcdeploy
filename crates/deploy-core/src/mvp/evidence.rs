use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::model::{
    DeploymentEvidence, EvidenceCheckKind, EvidenceRequirement, EvidenceRound,
    VerificationAvailability,
};

pub const REQUIRED_CONSECUTIVE_PASSES: usize = 3;
pub const MINIMUM_PASS_INTERVAL_MS: i64 = 5_000;
pub const MINIMUM_STABILITY_WINDOW_MS: i64 = 10_000;
pub const EVIDENCE_FRESHNESS_MS: i64 = 5 * 60 * 1_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatus {
    Verifying,
    VerifiedCurrent,
    VerifiedStale,
    OfflineHistorical,
    ServiceRunningPublicAccessBlocked,
    VerificationFailed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceContinuation {
    None,
    Verification,
    Investigation,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceProjection {
    pub status: EvidenceStatus,
    pub can_show_current_success: bool,
    pub continuation: EvidenceContinuation,
    pub preserve_established_runtime: bool,
    pub consecutive_pass_count: usize,
    pub stability_window_ms: i64,
    pub verified_at_ms: Option<i64>,
    pub fresh_until_ms: Option<i64>,
    pub established_check_ids: Vec<String>,
    pub failed_check_ids: Vec<String>,
    pub missing_check_ids: Vec<String>,
    pub missing_requirement_kinds: Vec<EvidenceCheckKind>,
}

#[must_use]
pub fn project_evidence(
    evidence: &DeploymentEvidence,
    now_ms: i64,
    availability: VerificationAvailability,
) -> EvidenceProjection {
    let missing_requirement_kinds = missing_requirement_kinds(&evidence.requirements);
    let catalog_complete = missing_requirement_kinds.is_empty();
    let mut rounds = evidence.rounds.clone();
    rounds.sort_by_key(|round| round.checked_at_ms);
    let evaluated = rounds
        .iter()
        .map(|round| evaluate_round(&evidence.requirements, round))
        .collect::<Vec<_>>();
    let latest = evaluated.last();
    let current_stable_rounds = if catalog_complete {
        spaced_passing_suffix(&evaluated)
    } else {
        Vec::new()
    };
    let consecutive_pass_count = current_stable_rounds.len();
    let stability_window_ms = stability_window(&current_stable_rounds);
    let latest_stable_rounds = if catalog_complete {
        latest_stable_window(&evaluated)
    } else {
        Vec::new()
    };
    let verified_at_ms = latest_stable_rounds.last().map(|round| round.checked_at_ms);
    let fresh_until_ms = verified_at_ms.map(|time| time.saturating_add(EVIDENCE_FRESHNESS_MS));

    let mut projection = EvidenceProjection {
        status: EvidenceStatus::Verifying,
        can_show_current_success: false,
        continuation: EvidenceContinuation::Verification,
        preserve_established_runtime: latest.is_some_and(|round| {
            all_non_public_requirements_established(&evidence.requirements, round)
        }),
        consecutive_pass_count,
        stability_window_ms,
        verified_at_ms,
        fresh_until_ms,
        established_check_ids: latest
            .map(|round| round.established_check_ids.clone())
            .unwrap_or_default(),
        failed_check_ids: latest
            .map(|round| round.failed_check_ids.clone())
            .unwrap_or_default(),
        missing_check_ids: latest
            .map(|round| round.missing_check_ids.clone())
            .unwrap_or_default(),
        missing_requirement_kinds,
    };

    if availability == VerificationAvailability::Offline {
        projection.status = EvidenceStatus::OfflineHistorical;
        return projection;
    }

    if !catalog_complete {
        return projection;
    }

    let Some(latest) = latest else {
        projection.preserve_established_runtime = false;
        return projection;
    };

    if !latest.failed_public_check_ids.is_empty()
        && latest.failed_non_public_check_ids.is_empty()
        && all_non_public_requirements_established(&evidence.requirements, latest)
    {
        projection.status = EvidenceStatus::ServiceRunningPublicAccessBlocked;
        projection.preserve_established_runtime = true;
        return projection;
    }

    if !latest.failed_non_public_check_ids.is_empty() {
        projection.status = EvidenceStatus::VerificationFailed;
        projection.continuation = EvidenceContinuation::Investigation;
        projection.preserve_established_runtime = false;
        return projection;
    }

    let stable_now = consecutive_pass_count >= REQUIRED_CONSECUTIVE_PASSES
        && stability_window_ms >= MINIMUM_STABILITY_WINDOW_MS;
    if !stable_now || !latest.missing_check_ids.is_empty() {
        return projection;
    }

    if fresh_until_ms.is_some_and(|fresh_until| now_ms > fresh_until) {
        projection.status = EvidenceStatus::VerifiedStale;
        projection.preserve_established_runtime = true;
        return projection;
    }

    projection.status = EvidenceStatus::VerifiedCurrent;
    projection.can_show_current_success = true;
    projection.continuation = EvidenceContinuation::None;
    projection.preserve_established_runtime = true;
    projection
}

fn missing_requirement_kinds(requirements: &[EvidenceRequirement]) -> Vec<EvidenceCheckKind> {
    [
        EvidenceCheckKind::SourceIdentity,
        EvidenceCheckKind::RuntimeIdentity,
        EvidenceCheckKind::ServiceHealth,
        EvidenceCheckKind::PublicAccess,
    ]
    .into_iter()
    .filter(|required_kind| {
        !requirements
            .iter()
            .any(|requirement| requirement.kind == *required_kind)
    })
    .collect()
}

#[derive(Debug)]
struct EvaluatedRound {
    checked_at_ms: i64,
    all_passed: bool,
    established_check_ids: Vec<String>,
    failed_check_ids: Vec<String>,
    missing_check_ids: Vec<String>,
    failed_public_check_ids: Vec<String>,
    failed_non_public_check_ids: Vec<String>,
}

fn evaluate_round(requirements: &[EvidenceRequirement], round: &EvidenceRound) -> EvaluatedRound {
    let mut established_check_ids = Vec::new();
    let mut failed_check_ids = Vec::new();
    let mut missing_check_ids = Vec::new();
    let mut failed_public_check_ids = Vec::new();
    let mut failed_non_public_check_ids = Vec::new();

    for requirement in requirements {
        let mut matching_checks = round
            .checks
            .iter()
            .filter(|check| check.requirement_id == requirement.id);
        let first = matching_checks.next();
        let check = match (first, matching_checks.next()) {
            (Some(check), None) if check.kind == requirement.kind => check,
            _ => {
                missing_check_ids.push(requirement.id.clone());
                continue;
            }
        };

        if check.passed {
            established_check_ids.push(requirement.id.clone());
            continue;
        }

        failed_check_ids.push(requirement.id.clone());
        if requirement.kind == EvidenceCheckKind::PublicAccess {
            failed_public_check_ids.push(requirement.id.clone());
        } else {
            failed_non_public_check_ids.push(requirement.id.clone());
        }
    }

    EvaluatedRound {
        checked_at_ms: round.checked_at_ms,
        all_passed: failed_check_ids.is_empty() && missing_check_ids.is_empty(),
        established_check_ids,
        failed_check_ids,
        missing_check_ids,
        failed_public_check_ids,
        failed_non_public_check_ids,
    }
}

fn spaced_passing_suffix(rounds: &[EvaluatedRound]) -> Vec<&EvaluatedRound> {
    let mut selected = Vec::new();
    for round in rounds.iter().rev() {
        if !round.all_passed {
            break;
        }
        if selected.last().is_none_or(|newer: &&EvaluatedRound| {
            newer.checked_at_ms.saturating_sub(round.checked_at_ms) >= MINIMUM_PASS_INTERVAL_MS
        }) {
            selected.push(round);
        }
    }
    selected.reverse();
    selected
}

fn stability_window(rounds: &[&EvaluatedRound]) -> i64 {
    match (rounds.first(), rounds.last()) {
        (Some(first), Some(last)) => last.checked_at_ms.saturating_sub(first.checked_at_ms),
        _ => 0,
    }
}

fn latest_stable_window(rounds: &[EvaluatedRound]) -> Vec<&EvaluatedRound> {
    let mut end = rounds.len();
    while end > 0 {
        while end > 0 && !rounds[end - 1].all_passed {
            end -= 1;
        }
        if end == 0 {
            break;
        }

        let block_end = end;
        let mut block_start = block_end;
        while block_start > 0 && rounds[block_start - 1].all_passed {
            block_start -= 1;
        }
        let selected = spaced_passing_suffix(&rounds[block_start..block_end]);
        if selected.len() >= REQUIRED_CONSECUTIVE_PASSES
            && stability_window(&selected) >= MINIMUM_STABILITY_WINDOW_MS
        {
            return selected;
        }
        end = block_start;
    }
    Vec::new()
}

fn all_non_public_requirements_established(
    requirements: &[EvidenceRequirement],
    round: &EvaluatedRound,
) -> bool {
    let required_runtime_kinds = [
        EvidenceCheckKind::SourceIdentity,
        EvidenceCheckKind::RuntimeIdentity,
        EvidenceCheckKind::ServiceHealth,
    ];
    if required_runtime_kinds.iter().any(|required_kind| {
        !requirements
            .iter()
            .any(|requirement| requirement.kind == *required_kind)
    }) {
        return false;
    }

    for requirement in requirements
        .iter()
        .filter(|requirement| requirement.kind != EvidenceCheckKind::PublicAccess)
    {
        if !round.established_check_ids.contains(&requirement.id) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mvp::model::{EvidenceCheck, EvidenceCheckKind, EvidenceRequirement, EvidenceRound};

    fn requirements() -> Vec<EvidenceRequirement> {
        vec![
            EvidenceRequirement {
                id: "source".into(),
                kind: EvidenceCheckKind::SourceIdentity,
            },
            EvidenceRequirement {
                id: "runtime".into(),
                kind: EvidenceCheckKind::RuntimeIdentity,
            },
            EvidenceRequirement {
                id: "service".into(),
                kind: EvidenceCheckKind::ServiceHealth,
            },
            EvidenceRequirement {
                id: "public-web".into(),
                kind: EvidenceCheckKind::PublicAccess,
            },
        ]
    }

    fn round(checked_at_ms: i64, failures: &[&str]) -> EvidenceRound {
        EvidenceRound {
            checked_at_ms,
            checks: requirements()
                .into_iter()
                .map(|requirement| {
                    let passed = !failures.contains(&requirement.id.as_str());
                    EvidenceCheck {
                        requirement_id: requirement.id.clone(),
                        kind: requirement.kind,
                        expected: format!("{}-expected", requirement.id),
                        actual: if passed {
                            format!("{}-expected", requirement.id)
                        } else {
                            format!("{}-actual", requirement.id)
                        },
                        location: format!("{}-location", requirement.id),
                        passed,
                        raw_evidence_ref: None,
                    }
                })
                .collect(),
        }
    }

    fn evidence(rounds: Vec<EvidenceRound>) -> DeploymentEvidence {
        DeploymentEvidence {
            requirements: requirements(),
            rounds,
        }
    }

    #[test]
    fn requires_three_passes_five_seconds_apart_over_ten_seconds() {
        let too_soon = project_evidence(
            &evidence(vec![round(0, &[]), round(4_999, &[]), round(10_000, &[])]),
            10_000,
            VerificationAvailability::Online,
        );
        assert_eq!(too_soon.status, EvidenceStatus::Verifying);
        assert!(!too_soon.can_show_current_success);
        assert_eq!(too_soon.consecutive_pass_count, 2);

        let stable = project_evidence(
            &evidence(vec![round(0, &[]), round(5_000, &[]), round(10_000, &[])]),
            10_000,
            VerificationAvailability::Online,
        );
        assert_eq!(stable.status, EvidenceStatus::VerifiedCurrent);
        assert!(stable.can_show_current_success);
        assert_eq!(stable.consecutive_pass_count, 3);
        assert_eq!(stable.stability_window_ms, 10_000);
        assert_eq!(stable.verified_at_ms, Some(10_000));
    }

    #[test]
    fn any_failed_round_restarts_the_consecutive_sequence() {
        let projection = project_evidence(
            &evidence(vec![
                round(0, &[]),
                round(5_000, &[]),
                round(10_000, &["service"]),
                round(15_000, &[]),
                round(20_000, &[]),
            ]),
            20_000,
            VerificationAvailability::Online,
        );

        assert_eq!(projection.status, EvidenceStatus::Verifying);
        assert!(!projection.can_show_current_success);
        assert_eq!(projection.consecutive_pass_count, 2);
        assert_eq!(projection.stability_window_ms, 5_000);
    }

    #[test]
    fn success_is_current_for_exactly_five_minutes_then_becomes_stale() {
        let snapshot = evidence(vec![round(0, &[]), round(5_000, &[]), round(10_000, &[])]);

        let boundary = project_evidence(&snapshot, 310_000, VerificationAvailability::Online);
        assert_eq!(boundary.status, EvidenceStatus::VerifiedCurrent);
        assert!(boundary.can_show_current_success);
        assert_eq!(boundary.fresh_until_ms, Some(310_000));

        let stale = project_evidence(&snapshot, 310_001, VerificationAvailability::Online);
        assert_eq!(stale.status, EvidenceStatus::VerifiedStale);
        assert!(!stale.can_show_current_success);
        assert_eq!(stale.continuation, EvidenceContinuation::Verification);
        assert!(stale.preserve_established_runtime);
    }

    #[test]
    fn offline_never_reuses_even_fresh_success_as_current() {
        let projection = project_evidence(
            &evidence(vec![round(0, &[]), round(5_000, &[]), round(10_000, &[])]),
            20_000,
            VerificationAvailability::Offline,
        );

        assert_eq!(projection.status, EvidenceStatus::OfflineHistorical);
        assert!(!projection.can_show_current_success);
        assert_eq!(projection.verified_at_ms, Some(10_000));
        assert_eq!(projection.continuation, EvidenceContinuation::Verification);
        assert!(projection.preserve_established_runtime);
    }

    #[test]
    fn public_failure_preserves_runtime_and_only_continues_verification() {
        let projection = project_evidence(
            &evidence(vec![
                round(0, &[]),
                round(5_000, &[]),
                round(10_000, &[]),
                round(15_000, &["public-web"]),
            ]),
            15_000,
            VerificationAvailability::Online,
        );

        assert_eq!(
            projection.status,
            EvidenceStatus::ServiceRunningPublicAccessBlocked
        );
        assert!(!projection.can_show_current_success);
        assert_eq!(projection.continuation, EvidenceContinuation::Verification);
        assert!(projection.preserve_established_runtime);
        assert_eq!(projection.failed_check_ids, vec!["public-web"]);
        assert_eq!(
            projection.established_check_ids,
            vec!["source", "runtime", "service"]
        );
        assert_eq!(projection.consecutive_pass_count, 0);
        assert_eq!(projection.verified_at_ms, Some(10_000));
    }

    #[test]
    fn repairing_public_access_starts_a_new_three_round_sequence() {
        let projection = project_evidence(
            &evidence(vec![
                round(0, &[]),
                round(5_000, &[]),
                round(10_000, &[]),
                round(15_000, &["public-web"]),
                round(20_000, &[]),
            ]),
            20_000,
            VerificationAvailability::Online,
        );

        assert_eq!(projection.status, EvidenceStatus::Verifying);
        assert!(!projection.can_show_current_success);
        assert_eq!(projection.continuation, EvidenceContinuation::Verification);
        assert_eq!(projection.consecutive_pass_count, 1);
        assert_eq!(projection.verified_at_ms, Some(10_000));
    }

    #[test]
    fn missing_or_mismatched_required_evidence_cannot_produce_success() {
        let mut missing = round(10_000, &[]);
        missing.checks.pop();
        let projection = project_evidence(
            &evidence(vec![round(0, &[]), round(5_000, &[]), missing]),
            10_000,
            VerificationAvailability::Online,
        );

        assert_eq!(projection.status, EvidenceStatus::Verifying);
        assert!(!projection.can_show_current_success);
        assert_eq!(projection.missing_check_ids, vec!["public-web"]);
    }

    #[test]
    fn an_incomplete_evidence_catalog_cannot_produce_success() {
        let mut snapshot = evidence(vec![round(0, &[]), round(5_000, &[]), round(10_000, &[])]);
        snapshot
            .requirements
            .retain(|requirement| requirement.kind != EvidenceCheckKind::RuntimeIdentity);
        for round in &mut snapshot.rounds {
            round
                .checks
                .retain(|check| check.kind != EvidenceCheckKind::RuntimeIdentity);
        }

        let projection = project_evidence(&snapshot, 10_000, VerificationAvailability::Online);

        assert_eq!(projection.status, EvidenceStatus::Verifying);
        assert!(!projection.can_show_current_success);
        assert!(!projection.preserve_established_runtime);
        assert_eq!(projection.consecutive_pass_count, 0);
        assert_eq!(projection.verified_at_ms, None);
        assert_eq!(
            projection.missing_requirement_kinds,
            vec![EvidenceCheckKind::RuntimeIdentity]
        );
    }
}
