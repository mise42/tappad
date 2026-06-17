mod host_surface;
mod protocol;
mod server;

#[cfg(target_os = "windows")]
mod windows_input;

#[cfg(not(target_os = "windows"))]
mod unsupported_input;

use host_surface::HostSurfaceState;
use std::sync::Arc;
use tauri::{Manager, State};

#[tauri::command]
async fn host_state(
    state: State<'_, Arc<server::SharedState>>,
) -> Result<HostSurfaceState, String> {
    Ok(state.host_state().await)
}

#[tauri::command]
async fn reset_pairing_token(
    state: State<'_, Arc<server::SharedState>>,
) -> Result<HostSurfaceState, String> {
    state
        .reset_pairing_token()
        .await
        .map_err(|error| error.to_string())?;
    Ok(state.host_state().await)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![host_state, reset_pairing_token])
        .setup(|app| {
            let token_store_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?;
            let shared = Arc::new(
                server::SharedState::new(token_store_dir).map_err(|error| error.to_string())?,
            );
            app.manage(Arc::clone(&shared));

            tauri::async_runtime::spawn(async {
                if let Err(error) = server::run(shared).await {
                    eprintln!("TapPad Windows backend failed: {error}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run TapPad Windows backend");
}
