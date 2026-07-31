use super::{
    DeploymentRun, WorkspaceState, deployment_run_from_row, hydrate_deployment_route_checks,
    lock_error, public_storage_error,
};

impl WorkspaceState {
    pub fn list_recent_successful_deployment_runs(&self) -> Result<Vec<DeploymentRun>, String> {
        let connection = self.connection.lock().map_err(lock_error)?;
        let mut statement = connection
            .prepare(
                "SELECT current.id, current.project_path, current.project_name,
                        current.environment, current.status, current.current_stage,
                        current.build_serial, current.commit_sha, current.source_title,
                        current.source_run_id, current.candidate_tag, current.artifacts,
                        current.action_kind, current.action_url, current.issue_code,
                        current.repository, current.branch, current.message,
                        current.completed_steps, current.started_at, current.updated_at
                 FROM deployment_runs current
                 WHERE current.status = 'success'
                   AND EXISTS (
                     SELECT 1 FROM projects visible
                     WHERE visible.path = current.project_path
                       AND visible.hidden_at IS NULL
                       AND visible.deployment_adoption_mode <> 'pending'
                       AND visible.deployment_fresh_draft = 0
                   )
                   AND current.id = (
                     SELECT latest.id FROM deployment_runs latest
                     WHERE latest.project_path = current.project_path
                       AND latest.environment = current.environment
                       AND latest.status = 'success'
                     ORDER BY latest.started_at DESC, latest.updated_at DESC, latest.id DESC
                     LIMIT 1
                   )
                 ORDER BY current.started_at DESC, current.updated_at DESC, current.id DESC
                 LIMIT 20",
            )
            .map_err(public_storage_error)?;
        collect_runs(
            &connection,
            statement.query_map([], deployment_run_from_row),
        )
    }

    pub fn list_current_deployment_runs(&self) -> Result<Vec<DeploymentRun>, String> {
        let connection = self.connection.lock().map_err(lock_error)?;
        let mut statement = connection
            .prepare(
                "SELECT current.id, current.project_path, current.project_name,
                        current.environment, current.status, current.current_stage,
                        current.build_serial, current.commit_sha, current.source_title,
                        current.source_run_id, current.candidate_tag, current.artifacts,
                        current.action_kind, current.action_url, current.issue_code,
                        current.repository, current.branch, current.message,
                        current.completed_steps, current.started_at, current.updated_at
                 FROM deployment_runs current
                 WHERE current.status = 'success'
                   AND EXISTS (
                     SELECT 1 FROM projects visible
                     WHERE visible.path = current.project_path
                       AND visible.hidden_at IS NULL
                       AND visible.deployment_adoption_mode <> 'pending'
                       AND visible.deployment_fresh_draft = 0
                   )
                   AND EXISTS (
                     SELECT 1 FROM deployment_paths path
                     WHERE path.current_run_id = current.id
                   )
                 ORDER BY current.updated_at DESC, current.id DESC
                 LIMIT 100",
            )
            .map_err(public_storage_error)?;
        collect_runs(
            &connection,
            statement.query_map([], deployment_run_from_row),
        )
    }
}

fn collect_runs(
    connection: &rusqlite::Connection,
    rows: Result<
        rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<DeploymentRun>>,
        rusqlite::Error,
    >,
) -> Result<Vec<DeploymentRun>, String> {
    let mut runs = rows
        .map_err(public_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(public_storage_error)?;
    for run in &mut runs {
        hydrate_deployment_route_checks(connection, run)?;
    }
    Ok(runs)
}
