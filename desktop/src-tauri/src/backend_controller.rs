use std::{path::PathBuf, sync::Arc};

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::Mutex;
use tracing::warn;

use crate::{
    backend::{self, BackendRuntime, RunningBackend},
    host_surface::{HostSurfaceState, host_surface_state},
    settings::{RuntimeSettings, SettingsUpdate, persist_settings},
};

pub struct BackendController {
    data_dir: PathBuf,
    inner: Mutex<ControllerState>,
}

struct ControllerState {
    settings: RuntimeSettings,
    backend: BackendState,
}

enum BackendState {
    Running(RunningBackend),
    Stopped { reason: String },
}

impl BackendController {
    pub async fn new(
        data_dir: PathBuf,
        launch_at_login: bool,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error + Send + Sync>> {
        let settings = RuntimeSettings::from_store(&data_dir, launch_at_login)?;
        let backend = match start_backend(settings.clone()).await {
            Ok(running) => BackendState::Running(running),
            Err(error) => {
                let reason = backend_error_reason(error.as_ref());
                warn!("TapPad backend failed to start: {reason}");
                BackendState::Stopped { reason }
            }
        };
        Ok(Arc::new(Self {
            data_dir,
            inner: Mutex::new(ControllerState { settings, backend }),
        }))
    }

    pub async fn host_state(&self) -> HostSurfaceState {
        let inner = self.inner.lock().await;
        inner.host_state()
    }

    pub async fn save_settings(
        &self,
        app: &AppHandle,
        update: SettingsUpdate,
    ) -> Result<HostSurfaceState, Box<dyn std::error::Error + Send + Sync>> {
        let mut inner = self.inner.lock().await;
        let next = inner.settings.with_update(update)?;
        self.replace_backend_locked(app, &mut inner, next).await?;
        Ok(inner.host_state())
    }

    pub async fn reset_pairing_token(
        &self,
        app: &AppHandle,
    ) -> Result<HostSurfaceState, Box<dyn std::error::Error + Send + Sync>> {
        let mut inner = self.inner.lock().await;
        let next = inner.settings.with_new_token();
        self.replace_backend_locked(app, &mut inner, next).await?;
        Ok(inner.host_state())
    }

    pub async fn mark_close_to_tray_hint_shown(
        &self,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let mut inner = self.inner.lock().await;
        if inner.settings.close_to_tray_hint_shown {
            return Ok(false);
        }

        let next = inner.settings.with_close_to_tray_hint_shown();
        persist_settings(&self.data_dir, &next)?;
        inner.settings = next;
        Ok(true)
    }

    async fn replace_backend_locked(
        &self,
        app: &AppHandle,
        inner: &mut ControllerState,
        next: RuntimeSettings,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let current = inner.settings.clone();
        let previous_was_running = inner.backend.is_running();
        let next_running = match start_backend(next.clone()).await {
            Ok(running) => running,
            Err(error) if previous_was_running => return Err(error),
            Err(error) => {
                let reason = backend_error_reason(error.as_ref());
                if let Err(error) = set_launch_at_login(app, next.launch_at_login) {
                    return Err(error);
                }
                if let Err(error) = persist_settings(&self.data_dir, &next) {
                    let _ = set_launch_at_login(app, current.launch_at_login);
                    return Err(error.into());
                }
                inner.settings = next;
                inner.backend = BackendState::Stopped { reason };
                return Ok(());
            }
        };
        if let Err(error) = set_launch_at_login(app, next.launch_at_login) {
            next_running.shutdown.cancel();
            return Err(error);
        }
        if let Err(error) = persist_settings(&self.data_dir, &next) {
            let _ = set_launch_at_login(app, current.launch_at_login);
            next_running.shutdown.cancel();
            return Err(error.into());
        }

        let previous = std::mem::replace(&mut inner.backend, BackendState::Running(next_running));
        inner.settings = next;
        previous.shutdown();
        Ok(())
    }
}

impl ControllerState {
    fn host_state(&self) -> HostSurfaceState {
        host_surface_state(
            &self.settings,
            self.backend.is_running(),
            self.backend.reason(),
            true,
        )
    }
}

impl BackendState {
    fn is_running(&self) -> bool {
        match self {
            Self::Running(running) => !running.task.is_finished(),
            Self::Stopped { .. } => false,
        }
    }

    fn reason(&self) -> Option<String> {
        match self {
            Self::Running(running) if running.task.is_finished() => {
                Some("backend task stopped unexpectedly".to_string())
            }
            Self::Running(_) => None,
            Self::Stopped { reason } => Some(reason.clone()),
        }
    }

    fn shutdown(self) {
        if let Self::Running(running) = self {
            running.shutdown.cancel();
        }
    }
}

async fn start_backend(
    settings: RuntimeSettings,
) -> Result<RunningBackend, Box<dyn std::error::Error + Send + Sync>> {
    let runtime = BackendRuntime::new(settings)?;
    let listener = backend::bind(runtime.settings()).await?;
    backend::spawn(listener, runtime)
}

fn backend_error_reason(error: &(dyn std::error::Error + Send + Sync)) -> String {
    let text = error.to_string();
    if text.contains("Address already in use") {
        "port is already in use".to_string()
    } else if text.trim().is_empty() {
        "backend failed to start".to_string()
    } else {
        text
    }
}

pub fn set_launch_at_login(
    app: &AppHandle,
    enabled: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()?;
    } else {
        manager.disable()?;
    }
    Ok(())
}

pub fn launch_at_login_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::settings::settings_path;

    #[tokio::test]
    async fn controller_reports_stopped_state_when_backend_port_is_busy() {
        let dir = tempfile::tempdir().expect("tempdir");
        let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
            .await
            .expect("busy listener");
        let port = listener.local_addr().expect("listener address").port();
        fs::write(
            settings_path(dir.path()),
            format!(r#"{{"port":{port},"token":"token","launchAtLogin":false}}"#),
        )
        .expect("write settings");

        let controller = BackendController::new(dir.path().to_path_buf(), false)
            .await
            .expect("controller");
        let state = controller.host_state().await;

        assert_eq!(state.server_status.port, port);
        assert!(!state.server_status.running);
        assert!(state.server_status.reason.is_some());
    }
}
