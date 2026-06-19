use axum::{
    Json, Router,
    body::Body,
    extract::{
        Query, State,
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
    },
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::get,
};
use include_dir::{Dir, include_dir};
use std::{
    io,
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::{net::TcpListener, sync::Mutex, task::JoinHandle};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::{
    actions::{action_capabilities, run_named_action},
    host_surface::{HostSurfaceState, host_surface_state, render_mobile_index},
    input::InputDevice,
    protocol::{ClientMessage, ServerMessage},
    protocol_router::{BackendEffect, ProtocolRouter},
    settings::RuntimeSettings,
};

static MOBILE_ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../mobile");
static CLIENT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, serde::Deserialize)]
struct WsQuery {
    token: Option<String>,
}

pub struct BackendRuntime {
    input: Arc<Mutex<InputDevice>>,
    router: Mutex<ProtocolRouter>,
    settings: RuntimeSettings,
}

pub struct RunningBackend {
    pub shutdown: CancellationToken,
    pub task: JoinHandle<()>,
}

impl BackendRuntime {
    pub fn new(settings: RuntimeSettings) -> io::Result<Self> {
        Ok(Self {
            input: Arc::new(Mutex::new(InputDevice::new()?)),
            router: Mutex::new(ProtocolRouter::new()),
            settings,
        })
    }

    pub fn settings(&self) -> &RuntimeSettings {
        &self.settings
    }
}

pub fn spawn(
    listener: TcpListener,
    runtime: BackendRuntime,
) -> Result<RunningBackend, Box<dyn std::error::Error + Send + Sync>> {
    let addr = listener.local_addr()?;
    let shutdown = CancellationToken::new();
    let shutdown_for_task = shutdown.clone();
    let state = Arc::new(runtime);

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/host-state", get(api_host_state))
        .fallback(static_fallback)
        .with_state(state);

    let task = tokio::spawn(async move {
        info!("TapPad backend listening on http://{addr}");
        let result = axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_for_task.cancelled_owned())
            .await;

        if let Err(error) = result {
            warn!("TapPad backend stopped with error: {error}");
        }
    });

    Ok(RunningBackend { shutdown, task })
}

pub async fn bind(settings: &RuntimeSettings) -> io::Result<TcpListener> {
    let addr: SocketAddr = format!("{}:{}", settings.bind_host, settings.port)
        .parse()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    TcpListener::bind(addr).await
}

async fn api_host_state(State(state): State<Arc<BackendRuntime>>) -> Json<HostSurfaceState> {
    Json(host_surface_state(state.settings(), true, false))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<BackendRuntime>>,
) -> impl IntoResponse {
    match &query.token {
        Some(provided) if provided == &state.settings.token => {}
        _ => return (StatusCode::FORBIDDEN, "Forbidden").into_response(),
    }

    let client_id = format!("client-{}", CLIENT_COUNTER.fetch_add(1, Ordering::SeqCst));
    ws.on_upgrade(move |socket| handle_socket(socket, state, client_id))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<BackendRuntime>, client_id: String) {
    info!("client connected: {client_id}");

    let ready = ServerMessage::ready(state.settings.hostname.clone());
    let _ = socket
        .send(WsMessage::Text(
            serde_json::to_string(&ready).unwrap_or_default().into(),
        ))
        .await;

    while let Some(Ok(message)) = socket.recv().await {
        let text = match message {
            WsMessage::Text(text) => text,
            _ => continue,
        };

        let message: ClientMessage = match serde_json::from_str(&text) {
            Ok(message) => message,
            Err(error) => {
                warn!("invalid JSON from {client_id}: {error} (raw: {text})");
                continue;
            }
        };

        let effect = state.router.lock().await.route(&client_id, message);
        if let Some(effect) = effect {
            apply_backend_effect(Arc::clone(&state), &client_id, effect).await;
        }
    }

    info!("client disconnected: {client_id}");
}

async fn apply_backend_effect(state: Arc<BackendRuntime>, client_id: &str, effect: BackendEffect) {
    match effect {
        BackendEffect::Move { dx, dy } => {
            if let Err(error) = state.input.lock().await.move_rel(dx, dy) {
                warn!("move failed: {error}");
            }
        }
        BackendEffect::Wheel { dy } => {
            if let Err(error) = state.input.lock().await.scroll(dy) {
                warn!("scroll failed: {error}");
            }
        }
        BackendEffect::Click {
            button,
            click_count,
        } => {
            if let Err(error) = state.input.lock().await.click(&button, click_count) {
                warn!("click failed: {error}");
            }
        }
        BackendEffect::Key { code, down } => {
            if let Err(error) = state.input.lock().await.key(&code, down) {
                warn!("key failed: {error}");
            }
        }
        BackendEffect::Text { value } => {
            let mut input = state.input.lock().await;
            let has_non_typeable = value.chars().any(|ch| !input.is_typeable(ch));
            if has_non_typeable {
                drop(input);
                tokio::spawn(async move {
                    if let Err(error) = do_paste(state.input.clone(), value).await {
                        warn!("text paste fallback failed: {error}");
                    }
                });
            } else if let Err(error) = input.type_text(&value) {
                warn!("text failed: {error}");
            }
        }
        BackendEffect::Paste { value } => {
            let input = state.input.clone();
            tokio::spawn(async move {
                if let Err(error) = do_paste(input, value).await {
                    warn!("paste failed: {error}");
                }
            });
        }
        BackendEffect::Cmd { action } => {
            let input = state.input.clone();
            let client_id = client_id.to_string();
            tokio::spawn(async move {
                if let Err(error) = run_named_action(input, &action).await {
                    warn!("cmd failed for {client_id} ({action}): {error}");
                }
            });
        }
    }
}

async fn do_paste(
    input: Arc<Mutex<InputDevice>>,
    text: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let text = if text.len() > 12000 {
        text[..12000].to_string()
    } else {
        text
    };

    #[cfg(target_os = "windows")]
    {
        use arboard::Clipboard;

        let mut clipboard = Clipboard::new()?;
        clipboard.set_text(text)?;
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        send_paste_shortcut(&input, "ControlLeft").await
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Stdio;
        use tokio::io::AsyncWriteExt;

        let mut child = tokio::process::Command::new("wl-copy")
            .arg("--type")
            .arg("text/plain;charset=utf-8")
            .stdin(Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let status = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await;
        match status {
            Ok(Ok(status)) if status.success() => {}
            Ok(Ok(_)) => return Err("wl-copy failed".into()),
            Ok(Err(error)) => return Err(error.into()),
            Err(_) => {
                child.kill().await.ok();
                return Err("wl-copy timeout".into());
            }
        }

        let mut child_primary = tokio::process::Command::new("wl-copy")
            .arg("--primary")
            .stdin(Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child_primary.stdin.take() {
            stdin.write_all(text.as_bytes()).await?;
            stdin.shutdown().await?;
        }
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), child_primary.wait()).await;

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        send_paste_shortcut(&input, "ShiftLeft").await
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = input;
        let _ = text;
        Err("paste is implemented by the Linux and Windows Tauri host backends".into())
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
async fn send_paste_shortcut(
    input: &Arc<Mutex<InputDevice>>,
    modifier: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let paste_key = if modifier == "ShiftLeft" {
        "Insert"
    } else {
        "KeyV"
    };
    {
        let mut input = input.lock().await;
        input.key(modifier, true)?;
        input.key(paste_key, true)?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(35)).await;
    {
        input.lock().await.key(paste_key, false)?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(35)).await;
    {
        input.lock().await.key(modifier, false)?;
    }
    Ok(())
}

async fn static_fallback(uri: Uri) -> Response {
    let path = match mobile_asset_path(uri.path()) {
        Some(path) => path,
        None => return (StatusCode::BAD_REQUEST, "Invalid path\n").into_response(),
    };

    let Some(file) = MOBILE_ASSETS.get_file(&path) else {
        return (StatusCode::NOT_FOUND, "Not found\n").into_response();
    };

    if path == "index.html" {
        let rendered = render_mobile_index(
            std::str::from_utf8(file.contents()).unwrap_or_default(),
            &action_capabilities(),
        );
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Body::from(rendered))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    let mime = match file
        .path()
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    };

    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(file.contents().to_vec()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn mobile_asset_path(uri_path: &str) -> Option<String> {
    let path = uri_path.trim_start_matches('/');
    if path.is_empty() {
        return Some("index.html".to_string());
    }

    if path
        .split('/')
        .any(|component| component.is_empty() || component == "." || component == "..")
    {
        return None;
    }

    Some(path.to_string())
}

#[cfg(test)]
mod tests {
    use super::mobile_asset_path;

    #[test]
    fn mobile_asset_path_rejects_traversal() {
        assert_eq!(mobile_asset_path("/"), Some("index.html".to_string()));
        assert_eq!(mobile_asset_path("/app.js"), Some("app.js".to_string()));
        assert!(mobile_asset_path("/../Cargo.toml").is_none());
        assert!(mobile_asset_path("/mobile/../../Cargo.toml").is_none());
    }
}
