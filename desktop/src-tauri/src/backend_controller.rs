use std::{path::PathBuf, sync::Arc};

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::Mutex;

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
    running: RunningBackend,
}

impl BackendController {
    pub async fn new(
        data_dir: PathBuf,
        launch_at_login: bool,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error + Send + Sync>> {
        let settings = RuntimeSettings::from_store(&data_dir, launch_at_login)?;
        let running = start_backend(settings.clone()).await?;
        Ok(Arc::new(Self {
            data_dir,
            inner: Mutex::new(ControllerState { settings, running }),
        }))
    }

    pub async fn host_state(&self) -> HostSurfaceState {
        let inner = self.inner.lock().await;
        host_surface_state(&inner.settings, !inner.running.task.is_finished(), true)
    }

    pub async fn save_settings(
        &self,
        app: &AppHandle,
        update: SettingsUpdate,
    ) -> Result<HostSurfaceState, Box<dyn std::error::Error + Send + Sync>> {
        let mut inner = self.inner.lock().await;
        let next = inner.settings.with_update(update)?;
        self.replace_backend_locked(app, &mut inner, next).await?;
        Ok(host_surface_state(
            &inner.settings,
            !inner.running.task.is_finished(),
            true,
        ))
    }

    pub async fn reset_pairing_token(
        &self,
        app: &AppHandle,
    ) -> Result<HostSurfaceState, Box<dyn std::error::Error + Send + Sync>> {
        let mut inner = self.inner.lock().await;
        let next = inner.settings.with_new_token();
        self.replace_backend_locked(app, &mut inner, next).await?;
        Ok(host_surface_state(
            &inner.settings,
            !inner.running.task.is_finished(),
            true,
        ))
    }

    async fn replace_backend_locked(
        &self,
        app: &AppHandle,
        inner: &mut ControllerState,
        next: RuntimeSettings,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let current = inner.settings.clone();
        let next_running = start_backend(next.clone()).await?;
        if let Err(error) = set_launch_at_login(app, next.launch_at_login) {
            next_running.shutdown.cancel();
            return Err(error);
        }
        if let Err(error) = persist_settings(&self.data_dir, &next) {
            let _ = set_launch_at_login(app, current.launch_at_login);
            next_running.shutdown.cancel();
            return Err(error.into());
        }

        let previous = std::mem::replace(&mut inner.running, next_running);
        inner.settings = next;
        previous.shutdown.cancel();
        Ok(())
    }
}

async fn start_backend(
    settings: RuntimeSettings,
) -> Result<RunningBackend, Box<dyn std::error::Error + Send + Sync>> {
    let runtime = BackendRuntime::new(settings)?;
    let listener = backend::bind(runtime.settings()).await?;
    backend::spawn(listener, runtime)
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
