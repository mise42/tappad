mod actions;
mod backend;
mod backend_controller;
mod host_surface;
mod input;
mod input_chord;
mod protocol;
mod protocol_router;
mod settings;

use std::sync::Arc;

use backend_controller::{BackendController, launch_at_login_enabled};
use host_surface::HostSurfaceState;
use settings::SettingsUpdate;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
async fn host_state(state: State<'_, Arc<BackendController>>) -> Result<HostSurfaceState, String> {
    Ok(state.host_state().await)
}

#[tauri::command]
async fn save_settings(
    port: u16,
    token: String,
    #[allow(non_snake_case)] launchAtLogin: bool,
    app: AppHandle,
    state: State<'_, Arc<BackendController>>,
) -> Result<HostSurfaceState, String> {
    state
        .save_settings(
            &app,
            SettingsUpdate {
                port,
                token,
                launch_at_login: launchAtLogin,
            },
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn reset_pairing_token(
    app: AppHandle,
    state: State<'_, Arc<BackendController>>,
) -> Result<HostSurfaceState, String> {
    state
        .reset_pairing_token(&app)
        .await
        .map_err(|error| error.to_string())
}

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("TapPad")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            host_state,
            save_settings,
            reset_pairing_token
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?;
            let launch_at_login = launch_at_login_enabled(app.handle());
            let controller =
                tauri::async_runtime::block_on(BackendController::new(data_dir, launch_at_login))
                    .map_err(|error| error.to_string())?;
            app.manage(controller);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run TapPad desktop host");
}
