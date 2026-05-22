#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::Manager;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
enum AppError {
    #[error("Cannot resolve local data directory")]
    DataDirUnavailable,
    #[error("Filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid store payload: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Validation failed: {0}")]
    Validation(String),
    #[error("Host not found: {0}")]
    HostNotFound(String),
    #[error("Port forward not found: {0}")]
    PortForwardNotFound(String),
    #[error("Remote command failed: {0}")]
    RemoteCommand(String),
    #[error("Internal runtime state is unavailable")]
    StateLockPoisoned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostWorkspace {
    id: String,
    name: String,
    ssh_target: String,
    notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkspaceState {
    hosts: Vec<HostWorkspace>,
    selected_host_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertHostInput {
    id: Option<String>,
    name: String,
    ssh_target: String,
    notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContainerSummary {
    id: String,
    name: String,
    image: String,
    status: String,
    ports: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivePortForward {
    id: String,
    host_id: String,
    host_name: String,
    container_name: String,
    local_port: u16,
    remote_port: u16,
    target_host: String,
    target_port: u16,
    pid: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartPortForwardInput {
    host_id: String,
    container_id: String,
    container_name: String,
    local_port: u16,
    remote_port: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerLogsInput {
    host_id: String,
    container_id: String,
    tail: Option<u16>,
    since: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerInspectInput {
    host_id: String,
    container_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerRestartInput {
    host_id: String,
    container_id: String,
}

#[derive(Debug, Deserialize)]
struct DockerPsLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Ports")]
    ports: Option<String>,
}

struct PortForwardProcess {
    info: ActivePortForward,
    child: Child,
}

#[derive(Default)]
struct RuntimeState {
    forwards: Mutex<HashMap<String, PortForwardProcess>>,
}

impl RuntimeState {
    fn lock_forwards(
        &self,
    ) -> Result<MutexGuard<'_, HashMap<String, PortForwardProcess>>, AppError> {
        self.forwards
            .lock()
            .map_err(|_| AppError::StateLockPoisoned)
    }
}

fn data_file_path() -> Result<PathBuf, AppError> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or(AppError::DataDirUnavailable)?;
    let dir = base.join("quickssh");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("workspaces.json"))
}

fn load_state() -> Result<WorkspaceState, AppError> {
    let path = data_file_path()?;
    if !path.exists() {
        return Ok(WorkspaceState::default());
    }

    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(WorkspaceState::default());
    }

    let mut state: WorkspaceState = serde_json::from_str(&raw)?;
    if let Some(selected_id) = state.selected_host_id.clone() {
        let exists = state.hosts.iter().any(|entry| entry.id == selected_id);
        if !exists {
            state.selected_host_id = None;
        }
    }

    Ok(state)
}

fn save_state(state: &WorkspaceState) -> Result<(), AppError> {
    let path = data_file_path()?;
    let payload = serde_json::to_string_pretty(state)?;
    fs::write(path, payload)?;
    Ok(())
}

fn required_field(label: &str, value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{label} cannot be empty")));
    }
    Ok(trimmed.to_owned())
}

fn validate_ssh_target(value: &str) -> Result<String, AppError> {
    let target = required_field("ssh target", value)?;

    if target.starts_with('-') {
        return Err(AppError::Validation(
            "ssh target cannot start with '-'".to_string(),
        ));
    }

    if target
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(AppError::Validation(
            "ssh target cannot contain whitespace or control characters".to_string(),
        ));
    }

    Ok(target)
}

fn optional_field(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_owned())
        }
    })
}

fn find_host_by_id(host_id: &str) -> Result<HostWorkspace, AppError> {
    let state = load_state()?;
    let mut host = state
        .hosts
        .into_iter()
        .find(|entry| entry.id == host_id)
        .ok_or_else(|| AppError::HostNotFound(host_id.to_owned()))?;

    host.ssh_target = validate_ssh_target(&host.ssh_target)?;
    Ok(host)
}

fn validate_port(label: &str, port: u16) -> Result<(), AppError> {
    if port == 0 {
        return Err(AppError::Validation(format!(
            "{label} must be in range 1..=65535"
        )));
    }
    Ok(())
}

fn ensure_local_port_available(port: u16) -> Result<(), AppError> {
    TcpListener::bind(("127.0.0.1", port))
        .map(|listener| drop(listener))
        .map_err(|_| AppError::Validation(format!("local port {port} is already in use")))
}

fn cleanup_dead_forwards(forwards: &mut HashMap<String, PortForwardProcess>) {
    let stale_ids: Vec<String> = forwards
        .iter_mut()
        .filter_map(|(id, entry)| match entry.child.try_wait() {
            Ok(Some(_)) => Some(id.clone()),
            _ => None,
        })
        .collect();

    for stale_id in stale_ids {
        forwards.remove(&stale_id);
    }
}

fn stop_forward_process(forward: &mut PortForwardProcess) -> Result<(), AppError> {
    if forward.child.try_wait()?.is_none() {
        forward.child.kill()?;
        let _ = forward.child.wait();
    }
    Ok(())
}

fn stop_all_forwards(runtime: &RuntimeState) -> Result<(), AppError> {
    let mut forwards = runtime.lock_forwards()?;
    let ids: Vec<String> = forwards.keys().cloned().collect();

    for id in ids {
        if let Some(mut forward) = forwards.remove(&id) {
            let _ = stop_forward_process(&mut forward);
        }
    }

    Ok(())
}

fn normalize_binding_host(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.is_empty()
        || trimmed == "0.0.0.0"
        || trimmed == "::"
        || trimmed == "127.0.0.1"
        || trimmed == "::1"
    {
        "127.0.0.1".to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_binding_target(binding: &Value) -> Option<(String, u16)> {
    let host_port = binding
        .get("HostPort")
        .and_then(|entry| entry.as_str())
        .and_then(|entry| entry.parse::<u16>().ok())?;
    let host = binding
        .get("HostIp")
        .and_then(|entry| entry.as_str())
        .map(normalize_binding_host)
        .unwrap_or_else(|| "127.0.0.1".to_string());
    Some((host, host_port))
}

fn inspect_container_by_target(ssh_target: &str, container_id: &str) -> Result<Value, AppError> {
    let inspect_output = Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg(ssh_target)
        .arg("docker")
        .arg("inspect")
        .arg(container_id)
        .output()
        .map_err(|error| AppError::RemoteCommand(error.to_string()))?;

    if !inspect_output.status.success() {
        let stderr = String::from_utf8_lossy(&inspect_output.stderr)
            .trim()
            .to_string();
        let message = if stderr.is_empty() {
            format!(
                "docker inspect failed with code {:?}",
                inspect_output.status.code()
            )
        } else {
            stderr
        };
        return Err(AppError::RemoteCommand(message));
    }

    let inspect_value: Value = serde_json::from_slice(&inspect_output.stdout)?;
    inspect_value
        .as_array()
        .and_then(|items| items.first())
        .cloned()
        .ok_or_else(|| {
            AppError::RemoteCommand(format!(
                "docker inspect returned no data for {container_id}"
            ))
        })
}

fn resolve_forward_target(
    host: &HostWorkspace,
    container_id: &str,
    requested_port: u16,
) -> Result<(String, u16), AppError> {
    let container = inspect_container_by_target(&host.ssh_target, container_id)?;

    let ports_object = container
        .get("NetworkSettings")
        .and_then(|entry| entry.get("Ports"))
        .and_then(|entry| entry.as_object());

    if let Some(ports) = ports_object {
        for protocol in ["tcp", "udp"] {
            let key = format!("{requested_port}/{protocol}");
            if let Some(bindings) = ports.get(&key).and_then(|entry| entry.as_array()) {
                if let Some((target_host, target_port)) =
                    bindings.iter().find_map(parse_binding_target)
                {
                    return Ok((target_host, target_port));
                }
            }
        }

        for bindings in ports.values() {
            if let Some(entries) = bindings.as_array() {
                for entry in entries {
                    if let Some((target_host, target_port)) = parse_binding_target(entry) {
                        if target_port == requested_port {
                            return Ok((target_host, target_port));
                        }
                    }
                }
            }
        }
    }

    let container_ip = container
        .get("NetworkSettings")
        .and_then(|entry| entry.get("Networks"))
        .and_then(|entry| entry.as_object())
        .and_then(|networks| {
            networks.values().find_map(|network| {
                network
                    .get("IPAddress")
                    .and_then(|entry| entry.as_str())
                    .map(str::trim)
                    .filter(|entry| !entry.is_empty())
                    .map(|entry| entry.to_string())
            })
        });

    if let Some(ip) = container_ip {
        return Ok((ip, requested_port));
    }

    Err(AppError::Validation(format!(
        "Container {container_id} has no published port {requested_port} and no internal IP"
    )))
}

#[tauri::command]
fn get_workspace_state() -> Result<WorkspaceState, String> {
    load_state().map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_host(input: UpsertHostInput) -> Result<HostWorkspace, String> {
    let mut state = load_state().map_err(|error| error.to_string())?;

    let sanitized = HostWorkspace {
        id: input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        name: required_field("name", &input.name).map_err(|error| error.to_string())?,
        ssh_target: validate_ssh_target(&input.ssh_target).map_err(|error| error.to_string())?,
        notes: optional_field(input.notes),
    };

    if let Some(existing) = state.hosts.iter_mut().find(|host| host.id == sanitized.id) {
        *existing = sanitized.clone();
    } else {
        state.hosts.push(sanitized.clone());
    }

    if state.selected_host_id.is_none() {
        state.selected_host_id = Some(sanitized.id.clone());
    }

    save_state(&state).map_err(|error| error.to_string())?;
    Ok(sanitized)
}

#[tauri::command]
fn remove_host(host_id: String, runtime: tauri::State<RuntimeState>) -> Result<(), String> {
    let mut state = load_state().map_err(|error| error.to_string())?;
    let initial_len = state.hosts.len();
    state.hosts.retain(|entry| entry.id != host_id);

    if state.hosts.len() == initial_len {
        return Err(AppError::HostNotFound(host_id).to_string());
    }

    if state.selected_host_id.as_deref() == Some(host_id.as_str()) {
        state.selected_host_id = state.hosts.first().map(|entry| entry.id.clone());
    }

    save_state(&state).map_err(|error| error.to_string())?;

    let mut forwards = runtime.lock_forwards().map_err(|error| error.to_string())?;
    cleanup_dead_forwards(&mut forwards);

    let related_ids: Vec<String> = forwards
        .iter()
        .filter_map(|(id, entry)| {
            if entry.info.host_id == host_id {
                Some(id.clone())
            } else {
                None
            }
        })
        .collect();

    for related_id in related_ids {
        if let Some(mut forward) = forwards.remove(&related_id) {
            let _ = stop_forward_process(&mut forward);
        }
    }

    Ok(())
}

#[tauri::command]
fn select_host(host_id: String) -> Result<(), String> {
    let mut state = load_state().map_err(|error| error.to_string())?;
    let exists = state.hosts.iter().any(|entry| entry.id == host_id);
    if !exists {
        return Err(AppError::HostNotFound(host_id).to_string());
    }

    state.selected_host_id = Some(host_id);
    save_state(&state).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_containers(host_id: String) -> Result<Vec<ContainerSummary>, String> {
    let host = find_host_by_id(&host_id).map_err(|error| error.to_string())?;

    let output = Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg(&host.ssh_target)
        .arg("docker")
        .arg("ps")
        .arg("--format")
        .arg("json")
        .output()
        .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("ssh exit code {:?}", output.status.code())
        } else {
            stderr
        };
        return Err(AppError::RemoteCommand(message).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers = Vec::new();

    for line in stdout.lines().filter(|line| !line.trim().is_empty()) {
        let parsed: DockerPsLine = serde_json::from_str(line).map_err(|error| {
            AppError::RemoteCommand(format!("cannot parse docker output line '{line}': {error}"))
                .to_string()
        })?;

        containers.push(ContainerSummary {
            id: parsed.id,
            name: parsed.names,
            image: parsed.image,
            status: parsed.status,
            ports: parsed.ports.unwrap_or_else(|| "-".to_string()),
        });
    }

    Ok(containers)
}

#[tauri::command]
fn start_port_forward(
    input: StartPortForwardInput,
    runtime: tauri::State<RuntimeState>,
) -> Result<ActivePortForward, String> {
    validate_port("local port", input.local_port).map_err(|error| error.to_string())?;
    validate_port("remote port", input.remote_port).map_err(|error| error.to_string())?;

    let host = find_host_by_id(&input.host_id).map_err(|error| error.to_string())?;
    let container_id =
        required_field("container id", &input.container_id).map_err(|error| error.to_string())?;
    let container_name = required_field("container name", &input.container_name)
        .map_err(|error| error.to_string())?;
    let (target_host, target_port) =
        resolve_forward_target(&host, &container_id, input.remote_port)
            .map_err(|error| error.to_string())?;

    let mut forwards = runtime.lock_forwards().map_err(|error| error.to_string())?;
    cleanup_dead_forwards(&mut forwards);

    if forwards
        .values()
        .any(|entry| entry.info.local_port == input.local_port)
    {
        return Err(AppError::Validation(format!(
            "local port {} is already forwarded",
            input.local_port
        ))
        .to_string());
    }

    ensure_local_port_available(input.local_port).map_err(|error| error.to_string())?;

    let tunnel_spec = format!(
        "127.0.0.1:{}:{}:{}",
        input.local_port, target_host, target_port
    );

    let mut child = Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-N")
        .arg("-L")
        .arg(&tunnel_spec)
        .arg(&host.ssh_target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?;

    std::thread::sleep(Duration::from_millis(180));
    if let Some(status) = child
        .try_wait()
        .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?
    {
        return Err(AppError::RemoteCommand(format!(
            "ssh tunnel failed to start (exit code {:?})",
            status.code()
        ))
        .to_string());
    }

    let info = ActivePortForward {
        id: Uuid::new_v4().to_string(),
        host_id: host.id,
        host_name: host.name,
        container_name,
        local_port: input.local_port,
        remote_port: input.remote_port,
        target_host,
        target_port,
        pid: child.id(),
    };

    forwards.insert(
        info.id.clone(),
        PortForwardProcess {
            info: info.clone(),
            child,
        },
    );

    Ok(info)
}

#[tauri::command]
fn list_port_forwards(
    host_id: Option<String>,
    runtime: tauri::State<RuntimeState>,
) -> Result<Vec<ActivePortForward>, String> {
    let mut forwards = runtime.lock_forwards().map_err(|error| error.to_string())?;
    cleanup_dead_forwards(&mut forwards);

    let mut entries: Vec<ActivePortForward> = forwards
        .values()
        .filter(|entry| {
            if let Some(filter_host_id) = host_id.as_ref() {
                entry.info.host_id == *filter_host_id
            } else {
                true
            }
        })
        .map(|entry| entry.info.clone())
        .collect();

    entries.sort_by_key(|entry| entry.local_port);
    Ok(entries)
}

#[tauri::command]
fn stop_port_forward(
    forward_id: String,
    runtime: tauri::State<RuntimeState>,
) -> Result<(), String> {
    let mut forwards = runtime.lock_forwards().map_err(|error| error.to_string())?;
    let mut forward = forwards
        .remove(&forward_id)
        .ok_or_else(|| AppError::PortForwardNotFound(forward_id.clone()).to_string())?;

    stop_forward_process(&mut forward).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_container_logs(input: ContainerLogsInput) -> Result<String, String> {
    let host = find_host_by_id(&input.host_id).map_err(|error| error.to_string())?;
    let container_id =
        required_field("container id", &input.container_id).map_err(|error| error.to_string())?;

    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("BatchMode=yes")
        .arg(&host.ssh_target)
        .arg("docker")
        .arg("logs")
        .arg("--timestamps");

    let tail = input.tail.filter(|value| *value > 0).unwrap_or(300);
    cmd.arg("--tail").arg(tail.to_string());

    if let Some(since) = optional_field(input.since) {
        cmd.arg("--since").arg(since);
    }

    let output = cmd
        .arg(container_id)
        .output()
        .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("docker logs failed with code {:?}", output.status.code())
        } else {
            stderr
        };
        return Err(AppError::RemoteCommand(message).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stderr.trim().is_empty() {
        return Ok(stdout);
    }

    if stdout.trim().is_empty() {
        return Ok(stderr);
    }

    Ok(format!("{stdout}\n{stderr}"))
}

#[tauri::command]
async fn get_container_inspect(input: ContainerInspectInput) -> Result<Value, String> {
    let host = find_host_by_id(&input.host_id).map_err(|error| error.to_string())?;
    let container_id =
        required_field("container id", &input.container_id).map_err(|error| error.to_string())?;
    let ssh_target = host.ssh_target;

    tauri::async_runtime::spawn_blocking(move || {
        inspect_container_by_target(&ssh_target, &container_id)
    })
    .await
    .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn restart_container(input: ContainerRestartInput) -> Result<(), String> {
    let host = find_host_by_id(&input.host_id).map_err(|error| error.to_string())?;
    let container_id =
        required_field("container id", &input.container_id).map_err(|error| error.to_string())?;

    let ssh_target = host.ssh_target;
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("ssh")
            .arg("-o")
            .arg("BatchMode=yes")
            .arg(&ssh_target)
            .arg("docker")
            .arg("restart")
            .arg(container_id)
            .output()
    })
    .await
    .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?
    .map_err(|error| AppError::RemoteCommand(error.to_string()).to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            format!("docker restart failed with code {:?}", output.status.code())
        } else {
            stderr
        };
        return Err(AppError::RemoteCommand(message).to_string());
    }

    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            get_workspace_state,
            upsert_host,
            remove_host,
            select_host,
            list_containers,
            start_port_forward,
            list_port_forwards,
            stop_port_forward,
            get_container_logs,
            get_container_inspect,
            restart_container
        ])
        .build(tauri::generate_context!())
        .expect("error while building quickssh");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(runtime) = app_handle.try_state::<RuntimeState>() {
                let _ = stop_all_forwards(&runtime);
            }
        }
    });
}
