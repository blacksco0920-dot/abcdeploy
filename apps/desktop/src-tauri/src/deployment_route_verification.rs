use std::time::{Duration, Instant};

use deploy_core::model::{DomainRoute, PublicRouteStatus};

pub(crate) async fn collect_public_route_statuses(
    routes: &[DomainRoute],
    expected_target: Option<&str>,
) -> Vec<PublicRouteStatus> {
    let expected_target = expected_target.map(str::to_string);
    let route_inputs = routes
        .iter()
        .map(|route| (route.host.clone(), route.path.clone()))
        .collect::<Vec<_>>();
    let mut tasks = tokio::task::JoinSet::new();
    for (position, (host, path)) in route_inputs.iter().cloned().enumerate() {
        let target = expected_target.clone();
        tasks.spawn(async move {
            let status = deploy_core::health::check_public_route_status_for_target(
                &host,
                &path,
                target.as_deref(),
            )
            .await;
            (position, status)
        });
    }
    let mut checks = vec![None; route_inputs.len()];
    while let Some(result) = tasks.join_next().await {
        if let Ok((position, status)) = result
            && let Some(slot) = checks.get_mut(position)
        {
            *slot = Some(status);
        }
    }
    checks
        .into_iter()
        .enumerate()
        .map(|(position, status)| {
            status.unwrap_or_else(|| {
                interrupted_status(&route_inputs[position].0, &route_inputs[position].1)
            })
        })
        .collect()
}

pub(crate) async fn wait_for_stable_public_route_statuses(
    routes: &[DomainRoute],
    expected_target: Option<&str>,
) -> Vec<PublicRouteStatus> {
    let deadline = Instant::now() + Duration::from_secs(45);
    let mut consecutive_ready = 0;
    loop {
        let checks = collect_public_route_statuses(routes, expected_target).await;
        if checks.iter().all(|check| check.reachable) {
            consecutive_ready += 1;
            if consecutive_ready >= 3 {
                return checks;
            }
        } else {
            consecutive_ready = 0;
            if !only_waiting_for_certificates(&checks) {
                return checks;
            }
        }
        if Instant::now() >= deadline {
            return checks;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

pub(crate) fn only_waiting_for_certificates(checks: &[PublicRouteStatus]) -> bool {
    checks.iter().any(|check| !check.reachable)
        && checks
            .iter()
            .filter(|check| !check.reachable)
            .all(|check| check.phase == "https")
}

pub(crate) fn interrupted_status(host: &str, path: &str) -> PublicRouteStatus {
    let scheme = if host.to_ascii_lowercase().ends_with(".sslip.io") {
        "http"
    } else {
        "https"
    };
    let route_path = if path.starts_with('/') { path } else { "/" };
    PublicRouteStatus {
        host: host.to_string(),
        url: format!("{scheme}://{host}{route_path}"),
        phase: "check".to_string(),
        reachable: false,
        http_status: None,
        message: format!("{host} 的地址检查被中断，请重新检查"),
    }
}

#[cfg(test)]
mod tests {
    use super::only_waiting_for_certificates;
    use deploy_core::model::PublicRouteStatus;

    fn status(phase: &str, reachable: bool) -> PublicRouteStatus {
        PublicRouteStatus {
            host: "api.example.com".to_string(),
            url: "https://api.example.com/".to_string(),
            phase: phase.to_string(),
            reachable,
            http_status: None,
            message: "test".to_string(),
        }
    }

    #[test]
    fn waits_only_when_every_unready_route_is_waiting_for_tls() {
        assert!(only_waiting_for_certificates(&[status("https", false)]));
        assert!(!only_waiting_for_certificates(&[status("dns", false)]));
        assert!(!only_waiting_for_certificates(&[status("ready", true)]));
    }
}
