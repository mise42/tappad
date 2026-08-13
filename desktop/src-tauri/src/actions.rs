use std::{collections::BTreeMap, sync::Arc};

use serde::Serialize;
use tokio::sync::Mutex;

use crate::input::InputDevice;

#[derive(Debug, Clone, Serialize)]
pub struct CapabilityStatus {
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

pub const ACTION_IDS: &[&str] = &[
    "screenrecord.screen",
    "screenrecord.window",
    "screenrecord.screen.audio",
    "screenrecord.screen.webcam",
    "screenrecord.stop",
    "open_recordings_folder",
    "screenshot",
    "close_window",
    "app_launcher",
    "lock_screen",
    "media.prev",
    "media.play_pause",
    "media.next",
    "media.volume_down",
    "media.mute",
    "media.volume_up",
];

pub fn action_capabilities() -> BTreeMap<String, CapabilityStatus> {
    ACTION_IDS
        .iter()
        .map(|action| ((*action).to_string(), capability_for_action(action)))
        .collect()
}

pub async fn run_named_action(
    _input: Arc<Mutex<InputDevice>>,
    action: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    #[cfg(target_os = "linux")]
    {
        run_linux_action(action).await
    }

    #[cfg(target_os = "windows")]
    {
        run_windows_action(_input, action).await
    }

    #[cfg(target_os = "macos")]
    {
        let _ = _input;
        run_macos_action(action).await
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = _input;
        Err(format!(
            "TapPad desktop actions are supported on Linux, macOS, and Windows, not {action}"
        )
        .into())
    }
}

fn capability_for_action(action: &str) -> CapabilityStatus {
    #[cfg(target_os = "linux")]
    {
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

    #[cfg(target_os = "windows")]
    {
        match action {
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

    #[cfg(target_os = "macos")]
    {
        match action {
            "screenrecord.screen"
            | "screenrecord.window"
            | "screenrecord.screen.audio"
            | "screenrecord.screen.webcam"
            | "screenrecord.stop" => capability("hidden", None),
            _ => capability("supported", None),
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = action;
        capability(
            "deferred",
            Some("The unified Tauri host ships for Linux, macOS, and Windows."),
        )
    }
}

pub fn capability(state: &'static str, note: Option<&str>) -> CapabilityStatus {
    CapabilityStatus {
        state,
        note: note.map(ToString::to_string),
    }
}

#[cfg(target_os = "linux")]
async fn run_linux_action(action: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Some(command) = linux_command(action) else {
        return Err(format!("unknown Linux desktop action: {action}").into());
    };
    run_shell_command(command).await
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "macos")]
async fn run_macos_action(action: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match action {
        "open_recordings_folder" => {
            run_shell_command(r#"mkdir -p "$HOME/Movies/TapPad" && open "$HOME/Movies/TapPad""#)
                .await
        }
        "screenshot" => {
            run_shell_command(
                r#"mkdir -p "$HOME/Movies/TapPad" && screencapture -x "$HOME/Movies/TapPad/screenshot-$(date +'%Y%m%d-%H%M%S')-$(uuidgen).png""#,
            )
            .await
        }
        "close_window" => {
            run_shell_command(
                r#"osascript -e 'tell application "System Events" to keystroke "w" using {command down}'"#,
            )
            .await
        }
        "app_launcher" => run_shell_command("open -a Launchpad").await,
        "lock_screen" => run_shell_command("pmset displaysleepnow").await,
        "media.prev" => {
            run_shell_command(
                r#"osascript -e 'tell application "System Events" to key code 123 using command down'"#,
            )
            .await
        }
        "media.play_pause" => {
            run_shell_command(r#"osascript -e 'tell application "System Events" to key code 49'"#)
                .await
        }
        "media.next" => {
            run_shell_command(
                r#"osascript -e 'tell application "System Events" to key code 124 using command down'"#,
            )
            .await
        }
        "media.volume_down" => {
            run_shell_command(
                r#"osascript -e 'set volume output volume ((output volume of (get volume settings)) - 5)'"#,
            )
            .await
        }
        "media.mute" => {
            run_shell_command(
                r#"osascript -e 'set volume output muted not (output muted of (get volume settings))'"#,
            )
            .await
        }
        "media.volume_up" => {
            run_shell_command(
                r#"osascript -e 'set volume output volume ((output volume of (get volume settings)) + 5)'"#,
            )
            .await
        }
        "screenrecord.screen"
        | "screenrecord.window"
        | "screenrecord.screen.audio"
        | "screenrecord.screen.webcam"
        | "screenrecord.stop" => {
            Err(format!("macOS Tauri host does not expose {action} yet.").into())
        }
        _ => Err(format!("unknown or unsupported macOS desktop action: {action}").into()),
    }
}

#[cfg(target_os = "windows")]
async fn run_windows_action(
    input: Arc<Mutex<InputDevice>>,
    action: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    match action {
        "open_recordings_folder" => open_recordings_folder().await,
        "screenshot" => {
            input.lock().await.chord(&["MetaLeft", "PrintScreen"])?;
            Ok(())
        }
        "close_window" => {
            input.lock().await.chord(&["AltLeft", "F4"])?;
            Ok(())
        }
        "app_launcher" => {
            input.lock().await.tap("MetaLeft")?;
            Ok(())
        }
        "lock_screen" => run_shell_command("rundll32.exe user32.dll,LockWorkStation").await,
        "media.prev" => {
            input.lock().await.tap("MediaPrevTrack")?;
            Ok(())
        }
        "media.play_pause" => {
            input.lock().await.tap("MediaPlayPause")?;
            Ok(())
        }
        "media.next" => {
            input.lock().await.tap("MediaNextTrack")?;
            Ok(())
        }
        "media.volume_down" => {
            input.lock().await.tap("VolumeDown")?;
            Ok(())
        }
        "media.mute" => {
            input.lock().await.tap("VolumeMute")?;
            Ok(())
        }
        "media.volume_up" => {
            input.lock().await.tap("VolumeUp")?;
            Ok(())
        }
        "screenrecord.screen"
        | "screenrecord.window"
        | "screenrecord.screen.audio"
        | "screenrecord.stop" => Err(format!("Windows beta downgrades {action}; use Xbox Game Bar until TapPad-managed capture lands.").into()),
        _ => Err(format!("unknown or unsupported Windows desktop action: {action}").into()),
    }
}

#[cfg(target_os = "windows")]
async fn open_recordings_folder() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let Some(user_profile) = std::env::var_os("USERPROFILE") else {
        return Err("USERPROFILE is not set".into());
    };
    let path = std::path::Path::new(&user_profile)
        .join("Videos")
        .join("TapPad");
    std::fs::create_dir_all(&path)?;
    tokio::process::Command::new("explorer.exe")
        .arg(path)
        .spawn()?;
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
async fn run_shell_command(command: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let output = if cfg!(target_os = "windows") {
        tokio::process::Command::new("cmd")
            .arg("/C")
            .arg(command)
            .output()
            .await?
    } else {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .output()
            .await?
    };

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string().into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mobile_action_has_a_capability() {
        let capabilities = action_capabilities();

        for action in ACTION_IDS {
            assert!(capabilities.contains_key(*action), "missing {action}");
        }
        assert!(!capabilities.contains_key("raw-shell"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn close_window_uses_the_lua_hyprland_dispatcher() {
        assert_eq!(
            linux_command("close_window"),
            Some("hyprctl eval 'hl.dispatch(hl.dsp.window.close())'")
        );
    }
}
