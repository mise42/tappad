use axum::{
    Router,
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
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::protocol::{ClientMessage, ServerMessage};
#[path = "../../../../src/protocol_router.rs"]
mod protocol_router;
use protocol_router::{BackendEffect, ProtocolRouter};

#[cfg(not(target_os = "windows"))]
use crate::unsupported_input::InputDevice;
#[cfg(target_os = "windows")]
use crate::windows_input::InputDevice;

static STATIC_ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../../static");
static CLIENT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, serde::Deserialize)]
struct WsQuery {
    token: Option<String>,
}

struct AppState {
    input: Mutex<InputDevice>,
    token: Option<String>,
    router: Mutex<ProtocolRouter>,
}

pub async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let host = std::env::var("TOUCHPAD_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("TOUCHPAD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8765u16);
    let token = std::env::var("TOUCHPAD_TOKEN").ok();

    let input = InputDevice::new()?;
    let state = Arc::new(AppState {
        input: Mutex::new(input),
        token,
        router: Mutex::new(ProtocolRouter::new()),
    });

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback(static_fallback)
        .with_state(state);

    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    info!("TapPad Windows backend listening on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if let Some(expected) = &state.token {
        match &query.token {
            Some(provided) if provided == expected => {}
            _ => return (StatusCode::FORBIDDEN, "Forbidden").into_response(),
        }
    }

    let client_id = format!("client-{}", CLIENT_COUNTER.fetch_add(1, Ordering::SeqCst));
    ws.on_upgrade(move |socket| handle_socket(socket, state, client_id))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>, client_id: String) {
    info!("client connected: {client_id}");

    let ready = ServerMessage::ready(get_hostname());
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
            apply_backend_effect(Arc::clone(&state), effect).await;
        }
    }

    info!("client disconnected: {client_id}");
}

async fn apply_backend_effect(state: Arc<AppState>, effect: BackendEffect) {
    match effect {
        BackendEffect::Move { dx, dy } => {
            let mut input = state.input.lock().await;
            if let Err(error) = input.move_rel(dx, dy) {
                warn!("move failed: {error}");
            }
        }
        BackendEffect::Wheel { dy } => {
            let mut input = state.input.lock().await;
            if let Err(error) = input.scroll(dy) {
                warn!("scroll failed: {error}");
            }
        }
        BackendEffect::Click {
            button,
            click_count,
        } => {
            let mut input = state.input.lock().await;
            if let Err(error) = input.click(&button, click_count) {
                warn!("click failed: {error}");
            }
        }
        BackendEffect::Key { code, down } => {
            let mut input = state.input.lock().await;
            if let Err(error) = input.key(&code, down) {
                warn!("key failed: {error}");
            }
        }
        BackendEffect::Text { value } => {
            let mut input = state.input.lock().await;
            if let Err(error) = input.type_text(&value) {
                warn!("text failed: {error}");
            }
        }
        BackendEffect::Paste { value } => {
            tokio::spawn(async move {
                if let Err(error) = do_paste(state, value).await {
                    warn!("paste failed: {error}");
                }
            });
        }
        BackendEffect::Exec { command } => {
            tokio::spawn(async move {
                if let Err(error) = run_shell_command(&command).await {
                    warn!("exec failed: {error}");
                }
            });
        }
        BackendEffect::Cmd { action } => {
            tokio::spawn(async move {
                if let Err(error) = run_named_action(&action).await {
                    warn!("cmd failed for {action}: {error}");
                }
            });
        }
    }
}

async fn do_paste(
    state: Arc<AppState>,
    text: String,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(target_os = "windows")]
    {
        use arboard::Clipboard;

        let mut clipboard = Clipboard::new()?;
        clipboard.set_text(text)?;

        tokio::time::sleep(std::time::Duration::from_millis(80)).await;

        let mut input = state.input.lock().await;
        input.key("ControlLeft", true)?;
        input.key("KeyV", true)?;
        tokio::time::sleep(std::time::Duration::from_millis(35)).await;
        input.key("KeyV", false)?;
        tokio::time::sleep(std::time::Duration::from_millis(35)).await;
        input.key("ControlLeft", false)?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        let _ = text;
        Err("paste is only implemented for the Windows backend".into())
    }
}

async fn run_named_action(action: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match action {
        "lock_screen" => run_shell_command("rundll32.exe user32.dll,LockWorkStation").await,
        _ => Err(format!("unknown or unsupported Windows action: {action}").into()),
    }
}

async fn run_shell_command(command: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .arg("/C")
            .arg(command)
            .output()
            .await?
    } else {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .output()
            .await?
    };

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string().into())
    }
}

async fn static_fallback(uri: Uri) -> Response {
    let mut path = uri.path().trim_start_matches('/');
    if path.is_empty() {
        path = "index.html";
    }

    let Some(file) = STATIC_ASSETS.get_file(path) else {
        return (StatusCode::NOT_FOUND, "Not found\n").into_response();
    };

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

fn get_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|hostname| !hostname.trim().is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}
