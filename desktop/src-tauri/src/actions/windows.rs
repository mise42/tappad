use std::{path::Path, sync::Arc};

use tokio::sync::Mutex;

use crate::input::InputDevice;

use super::{
    ActionError, ActionFuture, CapabilityStatus, DesktopActionAdapter, capability,
    run_shell_command,
};

pub(super) struct WindowsActionAdapter;

#[derive(Debug, PartialEq, Eq)]
enum WindowsInputAction {
    Chord(&'static [&'static str]),
    Tap(&'static str),
}

impl DesktopActionAdapter for WindowsActionAdapter {
    fn platform_name(&self) -> &'static str {
        "Windows"
    }

    fn capability(&self, action: &str) -> CapabilityStatus {
        match action {
            "codex.voice.start" | "codex.voice.end" | "codex.voice.toggle_microphone" => {
                super::scoped_capability(
                    "unavailable",
                    "Codex voice shortcut control has only been verified for the Linux desktop host.",
                    "unknown",
                    Some("codex_platform_not_verified"),
                )
            }
            "screenrecord.screen" => capability(
                "downgraded",
                Some(
                    "Windows beta does not save recordings into Videos\\TapPad yet. Use Xbox Game Bar capture on the PC for now.",
                ),
            ),
            "screenrecord.window" => capability(
                "downgraded",
                Some(
                    "Windows beta does not ship dedicated active-window capture yet. Use Xbox Game Bar on the PC for now.",
                ),
            ),
            "screenrecord.screen.audio" => capability(
                "downgraded",
                Some(
                    "Windows beta does not ship TapPad-managed desktop-plus-mic capture yet. Use Xbox Game Bar audio capture on the PC for now.",
                ),
            ),
            "screenrecord.stop" => capability(
                "downgraded",
                Some(
                    "Stop recording from Xbox Game Bar on the PC until TapPad-managed capture lands.",
                ),
            ),
            "screenrecord.screen.webcam" => capability("hidden", None),
            _ => capability("supported", None),
        }
    }

    fn execute<'a>(&'a self, input: Arc<Mutex<InputDevice>>, action: &'a str) -> ActionFuture<'a> {
        Box::pin(async move {
            match action {
                "open_recordings_folder" => open_recordings_folder(action).await,
                "lock_screen" => {
                    run_shell_command(
                        self.platform_name(),
                        action,
                        "rundll32.exe user32.dll,LockWorkStation",
                    )
                    .await
                }
                _ => match windows_input_action(action) {
                    Some(WindowsInputAction::Chord(keys)) => chord(&input, action, keys).await,
                    Some(WindowsInputAction::Tap(key)) => tap(&input, action, key).await,
                    None => Err(ActionError::unknown(action)),
                },
            }
        })
    }
}

fn windows_input_action(action: &str) -> Option<WindowsInputAction> {
    match action {
        "screenshot" => Some(WindowsInputAction::Chord(&["MetaLeft", "PrintScreen"])),
        "close_window" => Some(WindowsInputAction::Chord(&["AltLeft", "F4"])),
        "app_launcher" => Some(WindowsInputAction::Tap("MetaLeft")),
        "media.prev" => Some(WindowsInputAction::Tap("MediaPrevTrack")),
        "media.play_pause" => Some(WindowsInputAction::Tap("MediaPlayPause")),
        "media.next" => Some(WindowsInputAction::Tap("MediaNextTrack")),
        "media.volume_down" => Some(WindowsInputAction::Tap("VolumeDown")),
        "media.mute" => Some(WindowsInputAction::Tap("VolumeMute")),
        "media.volume_up" => Some(WindowsInputAction::Tap("VolumeUp")),
        _ => None,
    }
}

async fn chord(
    input: &Arc<Mutex<InputDevice>>,
    action: &str,
    keys: &[&str],
) -> Result<(), ActionError> {
    input
        .lock()
        .await
        .chord(keys)
        .map_err(|error| ActionError::failed("Windows", action, error))
}

async fn tap(input: &Arc<Mutex<InputDevice>>, action: &str, key: &str) -> Result<(), ActionError> {
    input
        .lock()
        .await
        .tap(key)
        .map_err(|error| ActionError::failed("Windows", action, error))
}

async fn open_recordings_folder(action: &str) -> Result<(), ActionError> {
    let Some(user_profile) = std::env::var_os("USERPROFILE") else {
        return Err(ActionError::failed(
            "Windows",
            action,
            "USERPROFILE is not set",
        ));
    };
    let path = Path::new(&user_profile).join("Videos").join("TapPad");
    std::fs::create_dir_all(&path)
        .map_err(|error| ActionError::failed("Windows", action, error))?;
    tokio::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| ActionError::failed("Windows", action, error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::ACTION_IDS;

    #[test]
    fn close_window_keeps_the_alt_f4_chord() {
        assert_eq!(
            windows_input_action("close_window"),
            Some(WindowsInputAction::Chord(&["AltLeft", "F4"]))
        );
    }

    #[test]
    fn recording_capability_downgrades_remain_visible() {
        let adapter = WindowsActionAdapter;
        assert_eq!(
            adapter.capability("screenrecord.screen").state,
            "downgraded"
        );
        assert_eq!(
            adapter.capability("screenrecord.screen.webcam").state,
            "hidden"
        );
        assert_eq!(adapter.capability("screenshot").state, "supported");
    }

    #[test]
    fn every_supported_windows_action_has_an_implementation() {
        let adapter = WindowsActionAdapter;
        for action in ACTION_IDS {
            let implemented = matches!(*action, "open_recordings_folder" | "lock_screen")
                || windows_input_action(action).is_some();
            assert_eq!(
                adapter.capability(action).state == "supported",
                implemented,
                "capability and implementation disagree for {action}"
            );
        }
    }
}
