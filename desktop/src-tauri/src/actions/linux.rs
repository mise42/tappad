use std::sync::Arc;

use tokio::sync::Mutex;

use crate::input::InputDevice;

use super::codex;
use super::{
    ActionError, ActionFuture, CapabilityStatus, DesktopActionAdapter, OMARCHY_ACTION_IDS,
    capability, run_shell_command,
};

pub(super) struct LinuxActionAdapter;

impl DesktopActionAdapter for LinuxActionAdapter {
    fn platform_name(&self) -> &'static str {
        "Linux"
    }

    fn additional_action_ids(&self) -> &'static [&'static str] {
        OMARCHY_ACTION_IDS
    }

    fn capability(&self, action: &str) -> CapabilityStatus {
        if let Some(capability) = codex::capability(action) {
            return capability;
        }
        match action {
            "screenrecord.screen.webcam" => capability(
                "deferred",
                Some(
                    "Visible on Linux/Omarchy when webcam tooling and a free video device are available.",
                ),
            ),
            _ => capability("supported", None),
        }
    }

    fn execute<'a>(&'a self, input: Arc<Mutex<InputDevice>>, action: &'a str) -> ActionFuture<'a> {
        Box::pin(async move {
            if codex::is_codex_action(action) {
                return codex::execute(input, action).await;
            }
            let Some(command) = linux_command(action) else {
                return Err(ActionError::unknown(action));
            };
            run_shell_command(self.platform_name(), action, command).await
        })
    }
}

fn linux_command(action: &str) -> Option<&'static str> {
    match action {
        "screenshot" => Some("omarchy capture screenshot"),
        "screenrecord.screen" => Some(
            r#"mkdir -p "$HOME/Videos/TapPad"; filename="$HOME/Videos/TapPad/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4"; echo "$filename" > /tmp/omarchy-screenrecord-filename; gpu-screen-recorder -w "$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .name')" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -o "$filename" & pkill -RTMIN+8 waybar"#,
        ),
        "screenrecord.window" => Some(
            r#"mkdir -p "$HOME/Videos/TapPad"; filename="$HOME/Videos/TapPad/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4"; echo "$filename" > /tmp/omarchy-screenrecord-filename; region=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"'); gpu-screen-recorder -w "$region" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -o "$filename" & pkill -RTMIN+8 waybar"#,
        ),
        "screenrecord.screen.audio" => Some(
            r#"mkdir -p "$HOME/Videos/TapPad"; filename="$HOME/Videos/TapPad/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4"; echo "$filename" > /tmp/omarchy-screenrecord-filename; gpu-screen-recorder -w "$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .name')" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -a "default_output|default_input" -ac aac -o "$filename" & pkill -RTMIN+8 waybar"#,
        ),
        "screenrecord.screen.webcam" => Some(
            r#"mkdir -p "$HOME/Videos/TapPad"; filename="$HOME/Videos/TapPad/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4"; echo "$filename" > /tmp/omarchy-screenrecord-filename; device=$(v4l2-ctl --list-devices 2>/dev/null | grep -m1 "^\s*/dev/video" | tr -d '\t'); [[ -z $device ]] && notify-send "No webcam found" -u critical -t 3000 && exit 1; busy=$(lsof "$device" 2>/dev/null | tail -n +2 | awk '{print $1}' | head -1); [[ -n $busy ]] && notify-send "Webcam in use by $busy" -u critical -t 5000 && exit 1; scale=$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .scale'); target=$(awk "BEGIN {printf \"%.0f\", 360 * $scale}"); ffplay -f v4l2 -framerate 30 "$device" -vf "crop=iw/2:ih,scale=${target}:-1" -window_title "WebcamOverlay" -noborder -fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0 -loglevel quiet & sleep 2; gpu-screen-recorder -w "$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .name')" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -o "$filename" & pkill -RTMIN+8 waybar"#,
        ),
        "screenrecord.stop" => Some("omarchy capture screenrecording --stop-recording"),
        "open_recordings_folder" => {
            Some(r#"mkdir -p "$HOME/Videos/TapPad" && xdg-open "$HOME/Videos/TapPad""#)
        }
        "close_window" => Some("hyprctl eval 'hl.dispatch(hl.dsp.window.close())'"),
        "app_launcher" => Some("omarchy-menu toggle apps"),
        "lock_screen" => Some("omarchy system lock"),
        "media.play_pause" => Some("playerctl play-pause"),
        "media.next" => Some("playerctl next"),
        "media.prev" => Some("playerctl previous"),
        "media.volume_up" => Some("omarchy audio output volume raise"),
        "media.volume_down" => Some("omarchy audio output volume lower"),
        "media.mute" => Some("omarchy audio output volume mute-toggle"),
        "workspace.previous" => {
            Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"e-1\" }))'")
        }
        "workspace.former" => {
            Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"previous\" }))'")
        }
        "workspace.next" => {
            Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"e+1\" }))'")
        }
        "workspace.1" => Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"1\" }))'"),
        "workspace.2" => Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"2\" }))'"),
        "workspace.3" => Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"3\" }))'"),
        "workspace.4" => Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"4\" }))'"),
        "workspace.5" => Some("hyprctl eval 'hl.dispatch(hl.dsp.focus({ workspace = \"5\" }))'"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::{ACTION_IDS, OMARCHY_ACTION_IDS};

    #[test]
    fn every_advertised_linux_action_has_an_implementation() {
        for action in ACTION_IDS.iter().chain(OMARCHY_ACTION_IDS) {
            assert!(
                linux_command(action).is_some() || codex::is_codex_action(action),
                "missing {action}"
            );
        }
    }

    #[test]
    fn app_scoped_codex_actions_keep_app_scope_when_runtime_state_changes() {
        let adapter = LinuxActionAdapter;
        for action in [codex::END_VOICE_ACTION, codex::TOGGLE_MICROPHONE_ACTION] {
            let capability = adapter.capability(action);
            assert_eq!(capability.scope, Some("app"));
            assert!(matches!(capability.state, "supported" | "unavailable"));
        }
    }

    #[test]
    fn close_window_uses_the_lua_hyprland_dispatcher() {
        assert_eq!(
            linux_command("close_window"),
            Some("hyprctl eval 'hl.dispatch(hl.dsp.window.close())'")
        );
    }

    #[test]
    fn workspace_actions_use_direct_lua_focus_dispatches() {
        let expected = [
            ("workspace.previous", "e-1"),
            ("workspace.former", "previous"),
            ("workspace.next", "e+1"),
            ("workspace.1", "1"),
            ("workspace.2", "2"),
            ("workspace.3", "3"),
            ("workspace.4", "4"),
            ("workspace.5", "5"),
        ];

        for (action, workspace) in expected {
            let expected_command = format!(
                "hyprctl eval 'hl.dispatch(hl.dsp.focus({{ workspace = \"{workspace}\" }}))'"
            );
            assert_eq!(
                linux_command(action),
                Some(expected_command.as_str()),
                "wrong mapping for {action}"
            );
        }
        assert_eq!(OMARCHY_ACTION_IDS, expected.map(|(action, _)| action));
    }

    #[test]
    fn app_launcher_uses_the_current_omarchy_apps_menu() {
        assert_eq!(
            linux_command("app_launcher"),
            Some("omarchy-menu toggle apps")
        );
    }

    #[test]
    fn volume_actions_use_the_omarchy_osd_entrypoint() {
        assert_eq!(
            linux_command("media.volume_up"),
            Some("omarchy audio output volume raise")
        );
        assert_eq!(
            linux_command("media.volume_down"),
            Some("omarchy audio output volume lower")
        );
        assert_eq!(
            linux_command("media.mute"),
            Some("omarchy audio output volume mute-toggle")
        );
    }
}
