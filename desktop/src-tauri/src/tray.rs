use std::sync::Arc;

use tauri::{
    App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent,
    menu::{MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder},
    tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_notification::NotificationExt;
use tracing::warn;

use crate::{
    backend_controller::BackendController,
    host_surface::{HostSurfaceState, ServerStatus},
};

const STATUS_ID: &str = "tap-pad-status";
const SHOW_PAIRING_ID: &str = "show-pairing";
const OPEN_SETTINGS_ID: &str = "open-settings";
const QUIT_ID: &str = "quit";
const NAVIGATE_EVENT: &str = "navigate_host_view";

pub struct TapPadTray<R: Runtime> {
    _icon: TrayIcon<R>,
    status_item: MenuItem<R>,
}

pub fn init<R: Runtime>(app: &mut App<R>, controller: Arc<BackendController>) -> tauri::Result<()> {
    let handle = app.handle().clone();
    let initial_state = tauri::async_runtime::block_on(controller.host_state());
    let status_item =
        MenuItemBuilder::with_id(STATUS_ID, tray_status_label(&initial_state.server_status))
            .enabled(false)
            .build(&handle)?;
    let menu = MenuBuilder::new(&handle)
        .item(&status_item)
        .text(SHOW_PAIRING_ID, "Show Pairing")
        .text(OPEN_SETTINGS_ID, "Open Settings")
        .separator()
        .text(QUIT_ID, "Quit")
        .build()?;

    let mut builder = TrayIconBuilder::with_id("tap-pad")
        .menu(&menu)
        .tooltip("TapPad")
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if is_primary_click(&event) {
                show_host_view(tray.app_handle(), "pairing");
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let icon = builder.build(app)?;
    app.manage(TapPadTray {
        _icon: icon,
        status_item,
    });
    Ok(())
}

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };

    if window.label() != "main" || window.app_handle().try_state::<TapPadTray<R>>().is_none() {
        return;
    }

    api.prevent_close();
    if let Err(error) = window.hide() {
        warn!("failed to hide TapPad window to tray: {error}");
    }
    maybe_send_close_to_tray_hint(window.app_handle().clone());
}

pub fn update_status<R: Runtime>(app: &AppHandle<R>, state: &HostSurfaceState) {
    if let Some(tray) = app.try_state::<TapPadTray<R>>() {
        if let Err(error) = tray
            .status_item
            .set_text(tray_status_label(&state.server_status))
        {
            warn!("failed to update TapPad tray status: {error}");
        }
    }
}

pub fn tray_status_label(status: &ServerStatus) -> String {
    if status.running {
        format!("TapPad: Running on :{}", status.port)
    } else {
        status
            .reason
            .as_ref()
            .filter(|reason| !reason.trim().is_empty())
            .map(|reason| format!("TapPad: {reason}"))
            .unwrap_or_else(|| "TapPad: Needs Attention".to_string())
    }
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_PAIRING_ID => show_host_view(app, "pairing"),
        OPEN_SETTINGS_ID => show_host_view(app, "settings"),
        QUIT_ID => app.exit(0),
        _ => {}
    }
}

fn show_host_view<R: Runtime>(app: &AppHandle<R>, view: &'static str) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            warn!("failed to show TapPad window: {error}");
        }
        if let Err(error) = window.set_focus() {
            warn!("failed to focus TapPad window: {error}");
        }
    }
    if let Err(error) = app.emit(NAVIGATE_EVENT, view) {
        warn!("failed to emit TapPad navigation event: {error}");
    }
}

fn maybe_send_close_to_tray_hint<R: Runtime>(app: AppHandle<R>) {
    let controller = app.state::<Arc<BackendController>>().inner().clone();
    tauri::async_runtime::spawn(async move {
        match controller.mark_close_to_tray_hint_shown().await {
            Ok(true) => {
                let _ = app
                    .notification()
                    .builder()
                    .title("TapPad is still running")
                    .body("Use the tray icon to reopen pairing or quit.")
                    .show();
            }
            Ok(false) => {}
            Err(error) => warn!("failed to persist close-to-tray hint state: {error}"),
        }
    });
}

fn is_primary_click(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            ..
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server_status(running: bool, reason: Option<&str>) -> ServerStatus {
        ServerStatus {
            host: "desktop".to_string(),
            port: 8765,
            bind_address: "0.0.0.0".to_string(),
            token_enabled: true,
            running,
            reason: reason.map(ToString::to_string),
        }
    }

    #[test]
    fn tray_status_reports_running_port() {
        assert_eq!(
            tray_status_label(&server_status(true, None)),
            "TapPad: Running on :8765"
        );
    }

    #[test]
    fn tray_status_reports_attention_reason() {
        assert_eq!(
            tray_status_label(&server_status(false, Some("port is already in use"))),
            "TapPad: port is already in use"
        );
    }

    #[test]
    fn tray_status_falls_back_to_needs_attention() {
        assert_eq!(
            tray_status_label(&server_status(false, None)),
            "TapPad: Needs Attention"
        );
    }
}
