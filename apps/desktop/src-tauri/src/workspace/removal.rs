use rusqlite::{Connection, OptionalExtension, params};

use super::{encode_uri_component, public_storage_error};

/// Remove the client-owned deployment aggregate for a project.
///
/// Global reusable connections, servers, profiles, secrets, project files and
/// remote services deliberately remain outside this transaction.
pub(super) fn remove_project_deployment(
    connection: &mut Connection,
    normalized_path: &str,
) -> Result<bool, String> {
    let transaction = connection.transaction().map_err(public_storage_error)?;
    let project_id: Option<String> = transaction
        .query_row(
            "SELECT id FROM projects WHERE path = ?1",
            [normalized_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(public_storage_error)?;
    let Some(project_id) = project_id else {
        return Ok(false);
    };

    transaction
        .execute(
            "DELETE FROM deployment_runs
             WHERE project_id = ?1 OR project_path = ?2",
            params![project_id, normalized_path],
        )
        .map_err(public_storage_error)?;
    for statement in [
        "DELETE FROM project_server_bindings WHERE project_path = ?1",
        "DELETE FROM project_profile_bindings WHERE project_path = ?1",
        "DELETE FROM deployment_paths WHERE project_path = ?1",
    ] {
        transaction
            .execute(statement, [normalized_path])
            .map_err(public_storage_error)?;
    }

    let setting_prefix = format!("project.{}.", encode_uri_component(normalized_path));
    transaction
        .execute(
            "DELETE FROM app_settings WHERE substr(key, 1, length(?1)) = ?1",
            [&setting_prefix],
        )
        .map_err(public_storage_error)?;
    let changed = transaction
        .execute("DELETE FROM projects WHERE id = ?1", [&project_id])
        .map_err(public_storage_error)?;
    transaction.commit().map_err(public_storage_error)?;
    Ok(changed > 0)
}
