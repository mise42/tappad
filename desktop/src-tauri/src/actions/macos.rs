use std::sync::Arc;

use tokio::sync::Mutex;

use crate::input::InputDevice;

use super::{
    ActionError, ActionFuture, CapabilityStatus, DesktopActionAdapter, capability,
    run_shell_command,
};

pub(super) struct MacOsActionAdapter;

impl DesktopActionAdapter for MacOsActionAdapter {
    fn platform_name(&self) -> &'static str {
        "macOS"
    }

    fn capability(&self, action: &str) -> CapabilityStatus {
        match action {
            "screenrecord.screen"
            | "screenrecord.window"
            | "screenrecord.screen.audio"
            | "screenrecord.screen.webcam"
            | "screenrecord.stop" => capability("hidden", None),
            _ => capability("supported", None),
        }
    }

    fn execute<'a>(&'a self, _input: Arc<Mutex<InputDevice>>, action: &'a str) -> ActionFuture<'a> {
        Box::pin(async move {
            let Some(command) = macos_command(action) else {
                return Err(ActionError::unknown(action));
            };
            run_shell_command(self.platform_name(), action, command).await
        })
    }
}

fn macos_command(action: &str) -> Option<&'static str> {
    match action {
        "open_recordings_folder" => {
            Some(r#"mkdir -p "$HOME/Movies/TapPad" && open "$HOME/Movies/TapPad""#)
        }
        "screenshot" => Some(
            r#"mkdir -p "$HOME/Movies/TapPad" && screencapture -x "$HOME/Movies/TapPad/screenshot-$(date +'%Y%m%d-%H%M%S')-$(uuidgen).png""#,
        ),
        "close_window" => Some(
            r#"osascript -e 'tell application "System Events" to keystroke "w" using {command down}'"#,
        ),
        "app_launcher" => Some("open -a Launchpad"),
        "lock_screen" => Some("pmset displaysleepnow"),
        "media.prev" => Some(
            r#"osascript -e 'tell application "System Events" to key code 123 using command down'"#,
        ),
        "media.play_pause" => {
            Some(r#"osascript -e 'tell application "System Events" to key code 49'"#)
        }
        "media.next" => Some(
            r#"osascript -e 'tell application "System Events" to key code 124 using command down'"#,
        ),
        "media.volume_down" => Some(
            r#"osascript -e 'set volume output volume ((output volume of (get volume settings)) - 5)'"#,
        ),
        "media.mute" => Some(
            r#"osascript -e 'set volume output muted not (output muted of (get volume settings))'"#,
        ),
        "media.volume_up" => Some(
            r#"osascript -e 'set volume output volume ((output volume of (get volume settings)) + 5)'"#,
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::ACTION_IDS;

    #[test]
    fn close_window_keeps_the_command_w_shortcut() {
        assert_eq!(
            macos_command("close_window"),
            Some(
                r#"osascript -e 'tell application "System Events" to keystroke "w" using {command down}'"#
            )
        );
    }

    #[test]
    fn recording_actions_remain_hidden() {
        let adapter = MacOsActionAdapter;
        assert_eq!(adapter.capability("screenrecord.screen").state, "hidden");
        assert_eq!(adapter.capability("screenshot").state, "supported");
    }

    #[test]
    fn every_supported_macos_action_has_an_implementation() {
        let adapter = MacOsActionAdapter;
        for action in ACTION_IDS {
            assert_eq!(
                adapter.capability(action).state == "supported",
                macos_command(action).is_some(),
                "capability and implementation disagree for {action}"
            );
        }
    }
}
