use axum::{
    Router,
    extract::{
        Query, State,
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, Uri, header},
    response::IntoResponse,
    routing::get,
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{info, warn};

#[cfg(any(target_os = "linux", target_os = "windows", test))]
use tokio::time::sleep;
#[cfg(target_os = "linux")]
use tokio::time::timeout;

mod commands;
#[cfg(target_os = "windows")]
mod enigo_input;
mod input;
mod protocol;
mod protocol_router;
#[cfg(target_os = "linux")]
mod uinput;

use commands::CommandRegistry;
use input::InputDevice;
use protocol::{ClientMessage, ServerMessage};
use protocol_router::{BackendEffect, ProtocolRouter};

#[derive(Debug, serde::Deserialize)]
struct WsQuery {
    token: Option<String>,
}

struct AppState {
    input: Mutex<InputDevice>,
    token: Option<String>,
    commands: CommandRegistry,
    router: Mutex<ProtocolRouter>,
}

static CLIENT_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_client_id() -> String {
    format!("client-{}", CLIENT_COUNTER.fetch_add(1, Ordering::SeqCst))
}

fn get_hostname() -> String {
    if let Ok(hostname) = std::fs::read_to_string("/proc/sys/kernel/hostname") {
        let hostname = hostname.trim();
        if !hostname.is_empty() {
            return hostname.to_string();
        }
    }

    if let Ok(hostname) = std::env::var("HOSTNAME") {
        let hostname = hostname.trim();
        if !hostname.is_empty() {
            return hostname.to_string();
        }
    }

    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|hostname| hostname.trim().to_string())
        .filter(|hostname| !hostname.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

fn shell_command(command: &str) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if let Some(expected) = &state.token {
        match &query.token {
            Some(provided) if provided == expected => {}
            _ => return (axum::http::StatusCode::FORBIDDEN, "Forbidden").into_response(),
        }
    }
    let client_id = next_client_id();
    ws.on_upgrade(move |socket| handle_socket(socket, state, client_id))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>, client_id: String) {
    info!("client connected: {}", client_id);

    let hostname = get_hostname();
    let ready = ServerMessage::ready(hostname);
    let _ = socket
        .send(WsMessage::Text(
            serde_json::to_string(&ready).unwrap().into(),
        ))
        .await;

    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            WsMessage::Text(t) => t,
            _ => continue,
        };

        let msg: ClientMessage = match serde_json::from_str(&text) {
            Ok(m) => {
                info!("msg from {}: {:?}", client_id, m);
                m
            }
            Err(e) => {
                warn!("invalid JSON from {}: {} (raw: {})", client_id, e, text);
                continue;
            }
        };

        let effect = state.router.lock().await.route(&client_id, msg);
        if let Some(effect) = effect {
            apply_backend_effect(Arc::clone(&state), &client_id, effect).await;
        }
    }

    info!("client disconnected: {}", client_id);
}

async fn apply_backend_effect(state: Arc<AppState>, client_id: &str, effect: BackendEffect) {
    match effect {
        BackendEffect::Move { dx, dy } => {
            let mut input = state.input.lock().await;
            let _ = input.move_rel(dx, dy);
        }
        BackendEffect::Wheel { dy } => {
            let mut input = state.input.lock().await;
            let _ = input.scroll(dy);
        }
        BackendEffect::Click {
            button,
            click_count,
        } => {
            let mut input = state.input.lock().await;
            let _ = input.click(&button, click_count);
        }
        BackendEffect::Key { code, down } => {
            let mut input = state.input.lock().await;
            let _ = input.key(&code, down);
        }
        BackendEffect::Text { value } => {
            let mut input = state.input.lock().await;
            info!(
                "type_text request from {}: '{}' ({} chars)",
                client_id,
                value,
                value.chars().count()
            );
            // Backends that cannot type a character directly may fall back
            // to the clipboard path.
            let has_non_ascii = value.chars().any(|c| !input.is_typeable(c));
            if has_non_ascii {
                info!("text contains non-ASCII chars, falling back to paste");
                let text = if value.len() > 12000 {
                    value[..12000].to_string()
                } else {
                    value
                };
                drop(input);
                let state_clone = Arc::clone(&state);
                tokio::spawn(async move {
                    if let Err(e) = do_paste(state_clone, &text).await {
                        warn!("paste failed: {}", e);
                    }
                });
            } else {
                match input.type_text(&value) {
                    Ok(_) => info!("type_text completed"),
                    Err(e) => warn!("type_text failed: {}", e),
                }
            }
        }
        BackendEffect::Paste { value } => {
            let text = if value.len() > 12000 {
                value[..12000].to_string()
            } else {
                value
            };
            info!("paste request from {}: {} chars", client_id, text.len());
            let state_clone = Arc::clone(&state);
            tokio::spawn(async move {
                if let Err(e) = do_paste(state_clone, &text).await {
                    warn!("paste failed: {}", e);
                }
            });
        }
        BackendEffect::Exec { command } => {
            let client_id = client_id.to_string();
            info!("exec request from {}: {}", client_id, command);
            tokio::spawn(async move {
                let output = shell_command(&command).output().await;
                match output {
                    Ok(o) if o.status.success() => {}
                    Ok(o) => {
                        warn!(
                            "exec failed for {}: stderr: {}",
                            client_id,
                            String::from_utf8_lossy(&o.stderr)
                        );
                    }
                    Err(e) => {
                        warn!("exec error for {}: {}", client_id, e);
                    }
                }
            });
        }
        BackendEffect::Cmd { action } => {
            let client_id = client_id.to_string();
            let command = state.commands.resolve(&action).map(|s| s.to_string());
            if let Some(command) = command {
                info!("cmd request from {}: {} -> {}", client_id, action, command);
                tokio::spawn(async move {
                    let output = shell_command(&command).output().await;
                    match output {
                        Ok(o) if o.status.success() => {}
                        Ok(o) => {
                            warn!(
                                "cmd failed for {} ({}): stderr: {}",
                                client_id,
                                action,
                                String::from_utf8_lossy(&o.stderr)
                            );
                        }
                        Err(e) => {
                            warn!("cmd error for {} ({}): {}", client_id, action, e);
                        }
                    }
                });
            } else {
                warn!("unknown cmd action from {}: {}", client_id, action);
            }
        }
    }
}

async fn do_paste(
    state: Arc<AppState>,
    text: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = state;
        let _ = text;
        return Err("paste is not supported by this target backend yet".into());
    }

    #[cfg(target_os = "windows")]
    {
        use arboard::Clipboard;

        let mut clipboard = Clipboard::new()?;
        clipboard.set_text(text.to_string())?;

        sleep(Duration::from_millis(80)).await;

        send_windows_paste_shortcut(&state.input, |input, code_name, down| {
            input.key(code_name, down)
        })
        .await?;

        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Stdio;
        use tokio::io::AsyncWriteExt;
        use tokio::process::Command;

        // Set clipboard (for browsers/GUI apps)
        let mut child = Command::new("wl-copy")
            .arg("--type")
            .arg("text/plain;charset=utf-8")
            .stdin(Stdio::piped())
            .spawn()?;

        if let Some(stdin) = child.stdin.take() {
            let mut stdin = stdin;
            stdin.write_all(text.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let result = timeout(Duration::from_secs(2), child.wait()).await;
        match result {
            Ok(Ok(status)) if status.success() => {}
            Ok(Ok(_)) => return Err("wl-copy failed".into()),
            Ok(Err(e)) => return Err(e.into()),
            Err(_) => {
                child.kill().await.ok();
                return Err("wl-copy timeout".into());
            }
        }

        // Set primary selection (for terminals via Shift+Insert)
        let mut child_primary = Command::new("wl-copy")
            .arg("--primary")
            .stdin(Stdio::piped())
            .spawn()?;

        if let Some(stdin) = child_primary.stdin.take() {
            let mut stdin = stdin;
            stdin.write_all(text.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let _ = timeout(Duration::from_secs(2), child_primary.wait()).await;

        sleep(Duration::from_millis(250)).await;

        let mut input = state.input.lock().await;
        // Send Shift+Insert (works in terminals and most GTK/Qt apps)
        input.key("ShiftLeft", true)?;
        input.key("Insert", true)?;
        sleep(Duration::from_millis(35)).await;
        input.key("Insert", false)?;
        sleep(Duration::from_millis(35)).await;
        input.key("ShiftLeft", false)?;

        Ok(())
    }
}

async fn send_windows_paste_shortcut<T, E, F>(
    input: &Mutex<T>,
    mut send_key: F,
) -> Result<(), E>
where
    F: FnMut(&mut T, &str, bool) -> Result<(), E>,
{
    {
        let mut input = input.lock().await;
        send_key(&mut input, "ControlLeft", true)?;
        send_key(&mut input, "KeyV", true)?;
    }
    sleep(Duration::from_millis(35)).await;
    {
        let mut input = input.lock().await;
        send_key(&mut input, "KeyV", false)?;
    }
    sleep(Duration::from_millis(35)).await;
    {
        let mut input = input.lock().await;
        send_key(&mut input, "ControlLeft", false)?;
    }

    Ok(())
}

async fn static_fallback(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let file_path = std::path::PathBuf::from("static").join(if path.is_empty() || path == "/" {
        "index.html"
    } else {
        path
    });

    match tokio::fs::read(&file_path).await {
        Ok(body) => {
            let mime = match file_path.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html; charset=utf-8",
                Some("css") => "text/css; charset=utf-8",
                Some("js") => "application/javascript; charset=utf-8",
                Some("json") => "application/json; charset=utf-8",
                Some("svg") => "image/svg+xml",
                _ => "application/octet-stream",
            };
            (
                [
                    (header::CONTENT_TYPE, mime),
                    (header::CACHE_CONTROL, "no-store"),
                ],
                body,
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Not found\n",
        )
            .into_response(),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let host = std::env::var("TOUCHPAD_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("TOUCHPAD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8765u16);
    let token = std::env::var("TOUCHPAD_TOKEN").ok();

    let input = InputDevice::new().expect("Failed to initialize input device");

    let state = Arc::new(AppState {
        input: Mutex::new(input),
        token,
        commands: CommandRegistry::new(),
        router: Mutex::new(ProtocolRouter::new()),
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback(static_fallback)
        .with_state(state.clone());

    let addr: SocketAddr = format!("{}:{}", host, port).parse().unwrap();
    info!("touchpad listening on http://{}", addr);
    if state.token.is_some() {
        info!("auth token enabled");
    }

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::send_windows_paste_shortcut;
    use std::io;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Mutex;
    use tokio::time::{sleep, timeout};

    #[tokio::test]
    async fn windows_paste_shortcut_releases_lock_between_key_stages() {
        let events = Arc::new(Mutex::new(Vec::<(String, bool)>::new()));

        let task = tokio::spawn({
            let events = Arc::clone(&events);
            async move {
                send_windows_paste_shortcut(&events, |events, code_name, down| {
                    events.push((code_name.to_string(), down));
                    Ok::<(), io::Error>(())
                })
                .await
            }
        });

        sleep(Duration::from_millis(5)).await;

        let guard = timeout(Duration::from_millis(10), events.lock())
            .await
            .expect("input lock should be available while paste waits between keys");
        drop(guard);

        task.await.expect("paste task should finish").expect("paste helper should succeed");

        let events = events.lock().await.clone();
        assert_eq!(
            events,
            vec![
                ("ControlLeft".to_string(), true),
                ("KeyV".to_string(), true),
                ("KeyV".to_string(), false),
                ("ControlLeft".to_string(), false),
            ]
        );
    }
}
