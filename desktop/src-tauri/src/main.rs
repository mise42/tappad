#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod actions;
mod authorization;
mod backend;
mod backend_controller;
mod diagnostics;
mod discovery;
mod host_contract;
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
use tauri_plugin_log::{Builder as LogBuilder, Target, TargetKind};

const HOST_LOG_LEVEL: log::LevelFilter = log::LevelFilter::Info;
const RAW_PAYLOAD_LOG_TARGETS: [&str; 2] = ["tungstenite", "tokio_tungstenite"];

fn host_log_level_for(target: &str) -> log::LevelFilter {
    if RAW_PAYLOAD_LOG_TARGETS
        .iter()
        .any(|prefix| target == *prefix || target.starts_with(&format!("{prefix}::")))
    {
        log::LevelFilter::Off
    } else {
        HOST_LOG_LEVEL
    }
}

fn host_log_builder() -> LogBuilder {
    RAW_PAYLOAD_LOG_TARGETS.iter().fold(
        LogBuilder::new()
            .level(HOST_LOG_LEVEL)
            .clear_targets()
            .target(Target::new(TargetKind::Stdout))
            .target(Target::new(TargetKind::LogDir { file_name: None })),
        |builder, target| builder.level_for(*target, host_log_level_for(target)),
    )
}

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
        .plugin(host_log_builder().build())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_payload_log_targets_are_disabled() {
        assert_eq!(HOST_LOG_LEVEL, log::LevelFilter::Info);
        assert_eq!(host_log_level_for("tungstenite"), log::LevelFilter::Off);
        assert_eq!(
            host_log_level_for("tokio_tungstenite"),
            log::LevelFilter::Off
        );
        assert_eq!(
            host_log_level_for("tungstenite::protocol::frame"),
            log::LevelFilter::Off
        );
    }
}
