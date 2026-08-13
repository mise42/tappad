use std::sync::Arc;

use tokio::sync::Mutex;

use crate::input::InputDevice;

use super::{
    ActionError, ActionFuture, CapabilityStatus, DesktopActionAdapter, capability,
    run_shell_command,
};

pub(super) struct LinuxActionAdapter;

impl DesktopActionAdapter for LinuxActionAdapter {
    fn platform_name(&self) -> &'static str {
        "Linux"
    }

    fn capability(&self, action: &str) -> CapabilityStatus {
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

    fn execute<'a>(&'a self, _input: Arc<Mutex<InputDevice>>, action: &'a str) -> ActionFuture<'a> {
        Box::pin(async move {
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
        "app_launcher" => Some("walker"),
        "lock_screen" => Some("omarchy system lock"),
        "media.play_pause" => Some("playerctl play-pause"),
        "media.next" => Some("playerctl next"),
        "media.prev" => Some("playerctl previous"),
        "media.volume_up" => Some("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+"),
        "media.volume_down" => Some("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"),
        "media.mute" => Some("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::actions::ACTION_IDS;

    #[test]
    fn every_advertised_linux_action_has_an_implementation() {
        for action in ACTION_IDS {
            assert!(linux_command(action).is_some(), "missing {action}");
        }
    }

    #[test]
    fn close_window_uses_the_lua_hyprland_dispatcher() {
        assert_eq!(
            linux_command("close_window"),
            Some("hyprctl eval 'hl.dispatch(hl.dsp.window.close())'")
        );
    }
}
