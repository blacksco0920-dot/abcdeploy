use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use deploy_core::{ServiceKind, inspect_project};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::{local_preview_status, local_project_plan};

const MAX_SOURCE_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SOURCE_SNAPSHOT_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedSourceSnapshot {
    source_path: String,
    managed_path: String,
    pub(super) snapshot_id: String,
    project_name: String,
    service_count: usize,
    http_service_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedLocalRunWorkspace {
    run_id: String,
    snapshot_id: String,
    workspace_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedLocalServiceEvidence {
    id: String,
    running: bool,
    url: Option<String>,
    reachable: bool,
    http_status: Option<u16>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ManagedLocalEvidenceRound {
    run_id: String,
    snapshot_id: String,
    checked_at_ms: i64,
    services: Vec<ManagedLocalServiceEvidence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedLocalRunMetadata<'a> {
    snapshot_id: &'a str,
}

#[tauri::command]
pub(super) fn resolve_local_folder_source(
    app: AppHandle,
    path: String,
) -> Result<ManagedSourceSnapshot, String> {
    let app_data = app.path().app_data_dir().map_err(source_error)?;
    snapshot_local_source(Path::new(&path), &app_data.join("source-snapshots"))
}

#[tauri::command]
pub(super) fn create_managed_local_run_workspace(
    app: AppHandle,
    snapshot_id: String,
) -> Result<ManagedLocalRunWorkspace, String> {
    let app_data = app.path().app_data_dir().map_err(source_error)?;
    create_local_run_workspace(&app_data, &snapshot_id)
}

#[tauri::command]
pub(super) fn verify_managed_local_run(
    app: AppHandle,
    run_id: String,
) -> Result<ManagedLocalEvidenceRound, String> {
    let app_data = app.path().app_data_dir().map_err(source_error)?;
    verify_local_run(&app_data, &run_id)
}

pub(super) fn snapshot_local_source(
    source: &Path,
    snapshot_root: &Path,
) -> Result<ManagedSourceSnapshot, String> {
    let source = source.canonicalize().map_err(|error| {
        format!("AD-SRC-101：无法读取所选项目文件夹；尚未创建运行任务。请重新选择项目。技术原因：{error}")
    })?;
    if !source.is_dir() {
        return Err(
            "AD-SRC-101：所选位置不是项目文件夹；尚未创建运行任务。请重新选择项目。".to_string(),
        );
    }

    let inspection = inspect_project(&source).map_err(|error| {
        format!("AD-SRC-102：无法识别这个项目的运行结构；源文件没有改动。请让开发 AI 完善项目后重新选择。技术原因：{error}")
    })?;
    let http_service_count =
        count_http_services(inspection.services.iter().map(|service| &service.kind));
    if http_service_count == 0 {
        return Err("AD-SRC-103：当前版本只支持至少包含一个网页或 HTTP 服务的项目；源文件没有改动，也没有创建运行任务。".to_string());
    }

    fs::create_dir_all(snapshot_root).map_err(source_error)?;
    let snapshot_root = snapshot_root.canonicalize().map_err(source_error)?;
    if snapshot_root.starts_with(&source) {
        return Err("AD-SRC-104：ABCDeploy 管理目录不能位于项目文件夹内部；源文件没有改动。请移动应用数据目录后重试。".to_string());
    }

    let files = collect_source_files(&source)?;
    let pending = create_pending_directory(&snapshot_root)?;
    let result = copy_and_hash_source(&source, &pending, &files);
    let (snapshot_id, _) = match result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_dir_all(&pending);
            return Err(error);
        }
    };
    let managed = snapshot_root.join(&snapshot_id);
    if managed.is_dir() {
        fs::remove_dir_all(&pending).map_err(source_error)?;
    } else {
        fs::rename(&pending, &managed).map_err(|error| {
            let _ = fs::remove_dir_all(&pending);
            format!("AD-SRC-105：项目快照已经生成，但没有保存到管理目录；源文件没有改动。请重试。技术原因：{error}")
        })?;
    }

    Ok(ManagedSourceSnapshot {
        source_path: source.to_string_lossy().into_owned(),
        managed_path: managed.to_string_lossy().into_owned(),
        snapshot_id,
        project_name: inspection.project_name,
        service_count: inspection.services.len(),
        http_service_count,
    })
}

fn count_http_services<'a>(kinds: impl IntoIterator<Item = &'a ServiceKind>) -> usize {
    kinds
        .into_iter()
        .filter(|kind| {
            matches!(
                kind,
                ServiceKind::Api | ServiceKind::Web | ServiceKind::Static
            )
        })
        .count()
}

fn collect_source_files(source: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = if let Some(files) = collect_git_visible_files(source)? {
        files
    } else {
        let mut files = Vec::new();
        collect_directory(source, source, &mut files)?;
        files
    };
    files.sort();
    files.dedup();
    if files.is_empty() {
        return Err("AD-SRC-102：项目文件夹中没有可用于运行的源文件；源文件没有改动。".to_string());
    }
    Ok(files)
}

fn collect_git_visible_files(source: &Path) -> Result<Option<Vec<PathBuf>>, String> {
    let output = match Command::new("git")
        .arg("-C")
        .arg(source)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            ".",
        ])
        .output()
    {
        Ok(output) if output.status.success() => output,
        Ok(_) | Err(_) => return Ok(None),
    };
    let output = String::from_utf8(output.stdout).map_err(|_| {
        "AD-SRC-105：项目包含当前系统无法读取的文件名；源文件没有改动。请重命名该文件后重试。"
            .to_string()
    })?;
    let mut files = Vec::new();
    for value in output.split('\0').filter(|value| !value.is_empty()) {
        let relative = PathBuf::from(value);
        if !safe_source_relative_path(&relative) {
            return Err(
                "AD-SRC-105：项目文件清单包含不安全路径；源文件没有改动。请检查 Git 工作区后重试。"
                    .to_string(),
            );
        }
        if ignored_source_path(&relative) {
            continue;
        }
        let path = source.join(&relative);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(source_error(error)),
        };
        if metadata.file_type().is_symlink() {
            return Err(unsupported_source_symlink(&relative));
        }
        if metadata.is_dir() {
            collect_directory(source, &path, &mut files)?;
        } else if metadata.is_file() {
            validate_source_file(&relative, &metadata)?;
            files.push(relative);
        }
    }
    Ok(Some(files))
}

fn safe_source_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn collect_directory(
    source: &Path,
    directory: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(source_error)?;
    for entry in entries {
        let entry = entry.map_err(source_error)?;
        let path = entry.path();
        let relative = path.strip_prefix(source).map_err(source_error)?;
        if ignored_source_path(relative) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path).map_err(source_error)?;
        if metadata.file_type().is_symlink() {
            return Err(unsupported_source_symlink(relative));
        }
        if metadata.is_dir() {
            collect_directory(source, &path, files)?;
        } else if metadata.is_file() {
            validate_source_file(relative, &metadata)?;
            files.push(relative.to_path_buf());
        }
    }
    Ok(())
}

fn unsupported_source_symlink(relative: &Path) -> String {
    format!(
        "AD-SRC-106：项目包含当前版本无法安全复制的符号链接 {}；源文件没有改动。请将它改为项目内的普通文件后重试。",
        relative.display()
    )
}

fn validate_source_file(relative: &Path, metadata: &fs::Metadata) -> Result<(), String> {
    if metadata.len() > MAX_SOURCE_FILE_BYTES {
        return Err(format!(
            "AD-SRC-107：项目文件 {} 超过 64 MB，当前版本不会把它复制到运行快照；源文件没有改动。请移除生成物后重试。",
            relative.display()
        ));
    }
    Ok(())
}

fn ignored_source_path(relative: &Path) -> bool {
    const IGNORED_DIRECTORIES: &[&str] = &[
        ".git",
        ".next",
        ".nuxt",
        ".pnpm-store",
        ".turbo",
        ".venv",
        "__pycache__",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "target",
        "venv",
    ];
    if relative.components().any(|component| match component {
        Component::Normal(value) => IGNORED_DIRECTORIES.iter().any(|ignored| value == *ignored),
        _ => false,
    }) {
        return true;
    }
    let Some(name) = relative.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if name == ".DS_Store"
        || relative
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("log"))
    {
        return true;
    }
    if name == ".env" || name.starts_with(".env.") {
        return !matches!(name, ".env.example" | ".env.sample" | ".env.template");
    }
    false
}

fn create_pending_directory(snapshot_root: &Path) -> Result<PathBuf, String> {
    for attempt in 0..100_u32 {
        let name = format!(
            ".pending-{}-{}-{attempt}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let path = snapshot_root.join(name);
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(source_error(error)),
        }
    }
    Err("AD-SRC-105：无法创建项目快照临时目录；源文件没有改动。请重试。".to_string())
}

fn copy_and_hash_source(
    source: &Path,
    pending: &Path,
    files: &[PathBuf],
) -> Result<(String, u64), String> {
    let mut digest = Sha256::new();
    let mut total_bytes = 0_u64;
    let mut buffer = vec![0_u8; 64 * 1024];
    for relative in files {
        let input_path = source.join(relative);
        let output_path = pending.join(relative);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(source_error)?;
        }
        let mut input = File::open(&input_path).map_err(source_error)?;
        let mut output = File::create(&output_path).map_err(source_error)?;
        let relative_bytes = relative.to_string_lossy();
        digest.update((relative_bytes.len() as u64).to_be_bytes());
        digest.update(relative_bytes.as_bytes());
        loop {
            let read = input.read(&mut buffer).map_err(source_error)?;
            if read == 0 {
                break;
            }
            total_bytes = total_bytes.saturating_add(read as u64);
            if total_bytes > MAX_SOURCE_SNAPSHOT_BYTES {
                return Err("AD-SRC-108：项目有效源文件超过 1 GB，当前版本不会创建过大的运行快照；源文件没有改动。请移除生成物后重试。".to_string());
            }
            digest.update(&buffer[..read]);
            output.write_all(&buffer[..read]).map_err(source_error)?;
        }
        output.sync_all().map_err(source_error)?;
        let permissions = fs::metadata(&input_path)
            .map_err(source_error)?
            .permissions();
        fs::set_permissions(&output_path, permissions).map_err(source_error)?;
    }
    Ok((format!("{:x}", digest.finalize()), total_bytes))
}

pub(super) fn create_local_run_workspace(
    app_data: &Path,
    snapshot_id: &str,
) -> Result<ManagedLocalRunWorkspace, String> {
    if snapshot_id.len() != 64 || !snapshot_id.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err(
            "AD-SRC-109：项目快照标识无效；尚未创建本机运行任务。请重新选择项目。".to_string(),
        );
    }
    let source = app_data.join("source-snapshots").join(snapshot_id);
    if !source.is_dir() {
        return Err(
            "AD-SRC-110：找不到本次检查使用的项目快照；尚未创建本机运行任务。请重新读取项目。"
                .to_string(),
        );
    }
    let runs = app_data.join("local-runs");
    fs::create_dir_all(&runs).map_err(source_error)?;
    let run_id = format!(
        "local-{}-{}",
        &snapshot_id[..12],
        chrono::Utc::now().timestamp_millis()
    );
    let run_root = runs.join(&run_id);
    if run_root.exists() {
        return Err("AD-SRC-111：本机运行目录发生冲突；项目快照仍然保留。请重试。".to_string());
    }
    fs::create_dir(&run_root).map_err(source_error)?;
    let workspace = run_root.join("project");
    fs::create_dir(&workspace).map_err(source_error)?;
    if let Err(error) = copy_directory_exact(&source, &workspace) {
        let _ = fs::remove_dir_all(&run_root);
        return Err(error);
    }
    let metadata =
        serde_json::to_vec(&ManagedLocalRunMetadata { snapshot_id }).map_err(source_error)?;
    if let Err(error) = fs::write(run_root.join("metadata.json"), metadata) {
        let _ = fs::remove_dir_all(&run_root);
        return Err(source_error(error));
    }
    Ok(ManagedLocalRunWorkspace {
        run_id,
        snapshot_id: snapshot_id.to_ascii_lowercase(),
        workspace_path: workspace.to_string_lossy().into_owned(),
    })
}

pub(super) fn verify_local_run(
    app_data: &Path,
    run_id: &str,
) -> Result<ManagedLocalEvidenceRound, String> {
    if !valid_run_id(run_id) {
        return Err(
            "AD-LOC-121：本机运行记录无效；现有项目进程没有被修改。请返回部署列表重新打开。"
                .to_string(),
        );
    }
    let run_root = app_data.join("local-runs").join(run_id);
    let metadata: serde_json::Value = serde_json::from_slice(
        &fs::read(run_root.join("metadata.json")).map_err(|error| {
            format!("AD-LOC-122：找不到本机运行身份；现有项目进程没有被修改。请重新运行项目。技术原因：{error}")
        })?,
    )
    .map_err(source_error)?;
    let snapshot_id = metadata
        .get("snapshotId")
        .or_else(|| metadata.get("snapshot_id"))
        .and_then(serde_json::Value::as_str)
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            "AD-LOC-122：本机运行身份不完整；现有项目进程没有被修改。请重新运行项目。".to_string()
        })?
        .to_string();
    let workspace = run_root.join("project");
    let (inspection, manifest, _) = local_project_plan(&workspace)?;
    let status = local_preview_status(&workspace, &inspection, &manifest, Vec::new());
    let services = status
        .services
        .iter()
        .map(|service| {
            let health_path = manifest
                .services
                .iter()
                .find(|candidate| candidate.id == service.id)
                .map_or("/", |candidate| candidate.healthcheck.path.as_str());
            let (reachable, http_status) = service
                .host_port
                .and_then(|port| u16::try_from(port).ok())
                .map_or((false, None), |port| local_http_check(port, health_path));
            ManagedLocalServiceEvidence {
                id: service.id.clone(),
                running: service.running,
                url: service.url.clone(),
                reachable,
                http_status,
            }
        })
        .collect();
    Ok(ManagedLocalEvidenceRound {
        run_id: run_id.to_string(),
        snapshot_id,
        checked_at_ms: chrono::Utc::now().timestamp_millis(),
        services,
    })
}

fn valid_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id.len() <= 96
        && run_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-')
}

fn local_http_check(port: u16, path: &str) -> (bool, Option<u16>) {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(3)) else {
        return (false, None);
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let safe_path = if path.starts_with('/') { path } else { "/" };
    let request =
        format!("GET {safe_path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return (false, None);
    }
    let mut first_line = String::new();
    if BufReader::new(stream).read_line(&mut first_line).is_err() {
        return (false, None);
    }
    let status = first_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok());
    (
        status.is_some_and(|value| (200..400).contains(&value)),
        status,
    )
}

fn copy_directory_exact(source: &Path, destination: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(source_error)? {
        let entry = entry.map_err(source_error)?;
        let input = entry.path();
        let output = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&input).map_err(source_error)?;
        if metadata.file_type().is_symlink() {
            return Err("AD-SRC-106：受管项目快照包含无法安全复制的符号链接；快照仍然保留。请重新读取项目。".to_string());
        }
        if metadata.is_dir() {
            fs::create_dir(&output).map_err(source_error)?;
            copy_directory_exact(&input, &output)?;
        } else if metadata.is_file() {
            fs::copy(&input, &output).map_err(source_error)?;
            fs::set_permissions(&output, metadata.permissions()).map_err(source_error)?;
        }
    }
    Ok(())
}

fn source_error(error: impl std::fmt::Display) -> String {
    format!("AD-SRC-105：项目快照没有生成；源文件没有改动。请重试。技术原因：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    fn sample_project(root: &Path) {
        fs::create_dir_all(root.join("src")).expect("src");
        fs::write(
            root.join("package.json"),
            r#"{"name":"sample-store","scripts":{"start":"vite"},"dependencies":{"vite":"latest"}}"#,
        )
        .expect("package");
        fs::write(root.join("src/main.ts"), "export const value = 1;\n").expect("source");
        fs::write(root.join(".env"), "SECRET=do-not-copy\n").expect("secret");
        fs::write(root.join(".env.example"), "SECRET=\n").expect("template");
        fs::write(root.join("debug.LOG"), "ignored log output\n").expect("log");
        fs::create_dir_all(root.join("node_modules/demo")).expect("modules");
        fs::write(root.join("node_modules/demo/index.js"), "ignored").expect("module file");
    }

    fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn visit(root: &Path, current: &Path, entries: &mut BTreeMap<String, Vec<u8>>) {
            for entry in fs::read_dir(current).expect("directory") {
                let entry = entry.expect("entry");
                let path = entry.path();
                if path.is_dir() {
                    visit(root, &path, entries);
                } else {
                    entries.insert(
                        path.strip_prefix(root)
                            .expect("relative")
                            .to_string_lossy()
                            .into_owned(),
                        fs::read(path).expect("file"),
                    );
                }
            }
        }
        let mut entries = BTreeMap::new();
        visit(root, root, &mut entries);
        entries
    }

    #[test]
    fn creates_an_immutable_managed_snapshot_without_touching_source() {
        let project = tempdir().expect("project");
        let managed = tempdir().expect("managed");
        sample_project(project.path());
        let before = tree(project.path());

        let snapshot = snapshot_local_source(project.path(), managed.path()).expect("snapshot");

        assert_eq!(tree(project.path()), before);
        assert!(
            Path::new(&snapshot.managed_path)
                .join("src/main.ts")
                .is_file()
        );
        assert!(
            Path::new(&snapshot.managed_path)
                .join(".env.example")
                .is_file()
        );
        assert!(!Path::new(&snapshot.managed_path).join(".env").exists());
        assert!(!Path::new(&snapshot.managed_path).join("debug.LOG").exists());
        assert!(
            !Path::new(&snapshot.managed_path)
                .join("node_modules")
                .exists()
        );
        assert_eq!(snapshot.http_service_count, 1);
    }

    #[cfg(unix)]
    #[test]
    fn gitignored_tool_state_does_not_block_the_source_snapshot() {
        use std::os::unix::fs::symlink;

        let project = tempdir().expect("project");
        let managed = tempdir().expect("managed");
        sample_project(project.path());
        fs::write(
            project.path().join(".gitignore"),
            ".vscode/chrome-debug-mobile/\n",
        )
        .expect("gitignore");
        let tool_state = project.path().join(".vscode/chrome-debug-mobile");
        fs::create_dir_all(&tool_state).expect("tool state");
        symlink("149.0.7827.53:1", tool_state.join("RunningChromeVersion"))
            .expect("browser state symlink");
        let status = Command::new("git")
            .args(["init", "--quiet"])
            .arg(project.path())
            .status()
            .expect("git init");
        assert!(status.success());

        let snapshot = snapshot_local_source(project.path(), managed.path())
            .expect("ignored tool state must not block the snapshot");

        assert!(
            !Path::new(&snapshot.managed_path)
                .join(".vscode/chrome-debug-mobile")
                .exists()
        );
    }

    #[cfg(unix)]
    #[test]
    fn project_owned_symlinks_remain_blocked() {
        use std::os::unix::fs::symlink;

        let project = tempdir().expect("project");
        let managed = tempdir().expect("managed");
        sample_project(project.path());
        symlink("src/main.ts", project.path().join("linked-main.ts")).expect("project symlink");

        let error = snapshot_local_source(project.path(), managed.path())
            .expect_err("project-owned symlinks must remain blocked");

        assert!(error.contains("AD-SRC-106"));
        assert!(error.contains("linked-main.ts"));
    }

    #[test]
    fn reuses_identical_content_and_changes_identity_after_source_change() {
        let project = tempdir().expect("project");
        let managed = tempdir().expect("managed");
        sample_project(project.path());
        let first = snapshot_local_source(project.path(), managed.path()).expect("first");
        let repeated = snapshot_local_source(project.path(), managed.path()).expect("repeated");
        assert_eq!(repeated.snapshot_id, first.snapshot_id);
        assert_eq!(repeated.managed_path, first.managed_path);

        fs::write(
            project.path().join("src/main.ts"),
            "export const value = 2;\n",
        )
        .expect("change source");
        let changed = snapshot_local_source(project.path(), managed.path()).expect("changed");
        assert_ne!(changed.snapshot_id, first.snapshot_id);
        assert_ne!(changed.managed_path, first.managed_path);
    }

    #[test]
    fn creates_a_mutable_run_workspace_without_changing_the_snapshot() {
        let project = tempdir().expect("project");
        let app_data = tempdir().expect("app data");
        sample_project(project.path());
        let snapshot_root = app_data.path().join("source-snapshots");
        let snapshot = snapshot_local_source(project.path(), &snapshot_root).expect("snapshot");
        let snapshot_before = tree(Path::new(&snapshot.managed_path));

        let run = create_local_run_workspace(app_data.path(), &snapshot.snapshot_id).expect("run");
        fs::write(
            Path::new(&run.workspace_path).join("src/main.ts"),
            "changed in run",
        )
        .expect("change run workspace");

        assert_eq!(tree(Path::new(&snapshot.managed_path)), snapshot_before);
        assert_ne!(tree(Path::new(&run.workspace_path)), snapshot_before);
        assert_eq!(run.snapshot_id, snapshot.snapshot_id);
    }

    #[test]
    fn rejects_an_untrusted_snapshot_identifier_before_writing() {
        let app_data = tempdir().expect("app data");
        let error = create_local_run_workspace(app_data.path(), "../../project")
            .expect_err("invalid identifier");
        assert!(error.contains("快照标识无效"));
        assert!(!app_data.path().join("local-runs").exists());
    }

    #[test]
    fn rejects_an_untrusted_run_identifier_before_reading() {
        let app_data = tempdir().expect("app data");
        let error = verify_local_run(app_data.path(), "../../run").expect_err("invalid run");
        assert!(error.contains("运行记录无效"));
    }

    #[test]
    fn reads_the_source_identity_from_managed_run_metadata() {
        let project = tempdir().expect("project");
        let app_data = tempdir().expect("app data");
        sample_project(project.path());
        let snapshot =
            snapshot_local_source(project.path(), &app_data.path().join("source-snapshots"))
                .expect("snapshot");
        let run = create_local_run_workspace(app_data.path(), &snapshot.snapshot_id).expect("run");

        let evidence = verify_local_run(app_data.path(), &run.run_id).expect("evidence");

        assert_eq!(evidence.snapshot_id, snapshot.snapshot_id);
        assert_eq!(evidence.run_id, run.run_id);
        assert_eq!(evidence.services.len(), 1);
        assert!(!evidence.services[0].running);
        assert_eq!(
            evidence.services[0].reachable,
            evidence.services[0]
                .http_status
                .is_some_and(|status| (200..400).contains(&status))
        );
    }

    #[test]
    fn worker_only_projects_do_not_satisfy_the_http_service_gate() {
        assert_eq!(count_http_services([&ServiceKind::Worker]), 0);
        assert_eq!(
            count_http_services([
                &ServiceKind::Worker,
                &ServiceKind::Api,
                &ServiceKind::Static,
            ]),
            2
        );
    }
}
