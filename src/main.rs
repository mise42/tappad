use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode, Uri},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use tracing::{info, warn};

mod protocol;
mod uinput;

use protocol::{ClientMessage, ServerMessage};
use uinput::UinputDevice;

#[derive(Debug, serde::Deserialize)]
struct WsQuery {
    token: Option<String>,
}

struct AppState {
    uinput: Mutex<UinputDevice>,
    token: Option<String>,
    active_client: Mutex<Option<(String, tokio::time::Instant)>>,
}

static CLIENT_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_client_id() -> String {
    format!("client-{}", CLIENT_COUNTER.fetch_add(1, Ordering::SeqCst))
}

fn get_hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .unwrap_or_default()
        .trim()
        .to_string()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if let Some(expected) = &state.token {
        match &query.token {
            Some(provided) if provided == expected => {}
            _ => {
                return (
                    axum::http::StatusCode::FORBIDDEN,
                    "Forbidden",
                )
                    .into_response()
            }
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
        .send(WsMessage::Text(serde_json::to_string(&ready).unwrap().into()))
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

        let should_handle = match &msg {
            ClientMessage::Move { .. } | ClientMessage::Wheel { .. } => {
                let mut active = state.active_client.lock().await;
                let now = tokio::time::Instant::now();

                if let Some((ref current, since)) = *active {
                    if *current == client_id {
                        // Update timestamp
                        *active = Some((client_id.clone(), now));
                        true
                    } else if now.duration_since(since) > Duration::from_secs(2) {
                        // Previous client timed out
                        *active = Some((client_id.clone(), now));
                        true
                    } else {
                        false
                    }
                } else {
                    *active = Some((client_id.clone(), now));
                    true
                }
            }
            _ => true,
        };

        if !should_handle {
            continue;
        }

        let mut uinput = state.uinput.lock().await;

        match msg {
            ClientMessage::Move { dx, dy } => {
                let _ = uinput.move_rel(dx.round() as i32, dy.round() as i32);
            }
            ClientMessage::Wheel { dy } => {
                let _ = uinput.scroll(dy.round() as i32);
            }
            ClientMessage::Click { button } => {
                let _ = uinput.click(&button);
            }
            ClientMessage::Key { code, down } => {
                let _ = uinput.key(&code, down);
            }
            ClientMessage::Text { value } => {
                info!("type_text request from {}: '{}' ({} chars)", client_id, value, value.chars().count());
                // For non-ASCII text (e.g. Chinese), fall back to paste/clipboard
                // since uinput can only simulate physical keycodes.
                let has_non_ascii = value.chars().any(|c| !uinput.is_typeable(c));
                if has_non_ascii {
                    info!("text contains non-ASCII chars, falling back to paste");
                    drop(uinput);
                    let text = if value.len() > 12000 {
                        value[..12000].to_string()
                    } else {
                        value
                    };
                    let state_clone = Arc::clone(&state);
                    tokio::spawn(async move {
                        if let Err(e) = do_paste(state_clone, &text).await {
                            warn!("paste failed: {}", e);
                        }
                    });
                } else {
                    match uinput.type_text(&value) {
                        Ok(_) => info!("type_text completed"),
                        Err(e) => warn!("type_text failed: {}", e),
                    }
                }
            }
            ClientMessage::Paste { value } => {
                drop(uinput);
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
        }
    }

    info!("client disconnected: {}", client_id);
}

async fn do_paste(
    state: Arc<AppState>,
    text: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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

    let mut uinput = state.uinput.lock().await;
    // Send Shift+Insert (works in terminals and most GTK/Qt apps)
    uinput.key("ShiftLeft", true)?;
    uinput.key("Insert", true)?;
    sleep(Duration::from_millis(35)).await;
    uinput.key("Insert", false)?;
    sleep(Duration::from_millis(35)).await;
    uinput.key("ShiftLeft", false)?;

    Ok(())
}

async fn static_fallback(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    let file_path = std::path::PathBuf::from("static").join(
        if path.is_empty() || path == "/" { "index.html" } else { path }
    );

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
            ).into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Not found\n",
        ).into_response(),
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

    let uinput = UinputDevice::new().expect("Failed to initialize uinput device");

    let state = Arc::new(AppState {
        uinput: Mutex::new(uinput),
        token,
        active_client: Mutex::new(None),
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
