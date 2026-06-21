#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod actions;
mod backend;
mod backend_controller;
mod diagnostics;
mod host_surface;
mod input;
mod input_chord;
mod protocol;
mod protocol_router;
mod settings;
mod tray;

use std::sync::Arc;

use backend_controller::{BackendController, launch_at_login_enabled};
use host_surface::HostSurfaceState;
use log::warn;
use settings::SettingsUpdate;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_log::{Target, TargetKind};

#[tauri::command]
async fn host_state(
    app: AppHandle,
    state: State<'_, Arc<BackendController>>,
) -> Result<HostSurfaceState, String> {
    let current = state.host_state().await;
    tray::update_status(&app, &current);
    Ok(current)
}

#[tauri::command]
async fn save_settings(
    port: u16,
    token: String,
    #[allow(non_snake_case)] launchAtLogin: bool,
    app: AppHandle,
    state: State<'_, Arc<BackendController>>,
) -> Result<HostSurfaceState, String> {
    let next = state
        .save_settings(
            &app,
            SettingsUpdate {
                port,
                token,
                launch_at_login: launchAtLogin,
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    tray::update_status(&app, &next);
    Ok(next)
}

#[tauri::command]
async fn reset_pairing_token(
    app: AppHandle,
    state: State<'_, Arc<BackendController>>,
) -> Result<HostSurfaceState, String> {
    let next = state
        .reset_pairing_token(&app)
        .await
        .map_err(|error| error.to_string())?;
    tray::update_status(&app, &next);
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(Target::new(TargetKind::Stdout))
                .target(Target::new(TargetKind::LogDir { file_name: None }))
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("TapPad")
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            host_state,
            save_settings,
            reset_pairing_token
        ])
        .on_window_event(tray::handle_window_event)
        .setup(|app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|error| error.to_string())?;
            let launch_at_login = launch_at_login_enabled(app.handle());
            let controller =
                tauri::async_runtime::block_on(BackendController::new(data_dir, launch_at_login))
                    .map_err(|error| error.to_string())?;
            app.manage(controller.clone());
            if let Err(error) = tray::init(app, controller) {
                warn!("TapPad tray unavailable on this desktop environment: {error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run TapPad desktop host");
}
