use std::collections::BTreeMap;

use crate::workspace::{DeploymentArtifact, DeploymentRun};

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct DeployedServiceState {
    pub(crate) service: String,
    pub(crate) container: String,
    pub(crate) status: String,
    pub(crate) health: String,
    pub(crate) image: Option<String>,
}

pub(crate) fn deployed_services_match_artifacts(
    states: &[DeployedServiceState],
    artifacts: &[DeploymentArtifact],
) -> bool {
    !artifacts.is_empty()
        && states.len() == artifacts.len()
        && states.iter().all(|state| {
            let expected_image = artifacts
                .iter()
                .find(|artifact| artifact.service == state.service)
                .map(|artifact| format!("{}@{}", artifact.image, artifact.digest));
            state.status == "running"
                && matches!(state.health.as_str(), "healthy" | "none")
                && state.image.as_deref() == expected_image.as_deref()
        })
}

pub(crate) fn resume_deployment_from_verified_server_state(
    run: &mut DeploymentRun,
    states: &[DeployedServiceState],
) -> bool {
    if !deployed_services_match_artifacts(states, &run.artifacts) {
        return false;
    }
    run.status = "running".to_string();
    run.current_stage = "deploy".to_string();
    run.issue_code = None;
    run.action_kind = None;
    run.action_url = None;
    run.message = "已确认服务器正在运行本次版本，正在继续配置访问地址".to_string();
    if !run.completed_steps.iter().any(|step| step == "server") {
        run.completed_steps.push("server".to_string());
    }
    true
}

pub(crate) fn parse_deployed_service_states(
    output: &str,
    expected: &[(String, String)],
) -> Vec<DeployedServiceState> {
    let reported = output
        .lines()
        .filter_map(|line| {
            let mut fields = line.trim().split('\t');
            let service = fields.next()?.trim();
            let status = fields.next()?.trim();
            let health = fields.next()?.trim();
            let image = fields
                .next()
                .map(str::trim)
                .filter(|image| !image.is_empty() && *image != "missing")
                .map(ToString::to_string);
            if service.is_empty() || status.is_empty() || health.is_empty() {
                return None;
            }
            Some((
                service.to_string(),
                (status.to_string(), health.to_string(), image),
            ))
        })
        .collect::<BTreeMap<_, _>>();
    expected
        .iter()
        .map(|(service, container)| {
            let (status, health, image) = reported
                .get(service)
                .cloned()
                .unwrap_or_else(|| ("missing".to_string(), "missing".to_string(), None));
            DeployedServiceState {
                service: service.clone(),
                container: container.clone(),
                status,
                health,
                image,
            }
        })
        .collect()
}

pub(crate) fn apply_deployed_service_states(
    run: &mut DeploymentRun,
    states: &[DeployedServiceState],
) {
    if let Some(problem) = states.iter().find(|state| {
        state.status != "running" || !matches!(state.health.as_str(), "healthy" | "none")
    }) {
        run.status = "needs_action".to_string();
        run.current_stage = "healthcheck".to_string();
        run.issue_code = Some("AD-CTR-201".to_string());
        run.message = format!("服务容器 {} 启动后未通过健康检查", problem.container);
        run.completed_steps.retain(|step| step != "healthcheck");
        return;
    }
    run.status = "success".to_string();
    run.current_stage = "complete".to_string();
    run.issue_code = None;
    run.message = if run.environment == "production" {
        "正式版服务仍在服务器运行".to_string()
    } else {
        "测试版仍在服务器运行".to_string()
    };
    if !run.completed_steps.iter().any(|step| step == "healthcheck") {
        run.completed_steps.push("healthcheck".to_string());
    }
}
