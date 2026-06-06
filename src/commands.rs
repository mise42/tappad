use std::collections::HashMap;

pub struct CommandRegistry {
    commands: HashMap<String, String>,
}

impl CommandRegistry {
    pub fn new() -> Self {
        let mut commands = HashMap::new();

        // Screenshot
        commands.insert("screenshot".to_string(), "omarchy capture screenshot".to_string());

        // Screen recording — direct gpu-screen-recorder, bypass omarchy's interactive slurp picker.
        // Manually trigger waybar recording indicator (pkill -RTMIN+8 waybar) since we skip omarchy's script.
        commands.insert("screenrecord.screen".to_string(), r#"gpu-screen-recorder -w "$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .name')" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -o "$HOME/Videos/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4" & pkill -RTMIN+8 waybar"#.to_string());
        commands.insert("screenrecord.window".to_string(), r#"region=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"'); gpu-screen-recorder -w "$region" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -o "$HOME/Videos/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4" & pkill -RTMIN+8 waybar"#.to_string());
        // Screen recording with desktop + microphone audio merged into one track (same as omarchy --with-desktop-audio --with-microphone-audio)
        commands.insert("screenrecord.screen.audio".to_string(), r#"gpu-screen-recorder -w "$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .name')" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -a "default_output|default_input" -ac aac -o "$HOME/Videos/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4" & pkill -RTMIN+8 waybar"#.to_string());
        // Screen recording with webcam overlay — ffplay floats a borderless camera window; gpu-screen-recorder captures the composited display
        commands.insert("screenrecord.screen.webcam".to_string(), r#"device=$(v4l2-ctl --list-devices 2>/dev/null | grep -m1 "^\s*/dev/video" | tr -d '\t'); [[ -z $device ]] && notify-send "No webcam found" -u critical -t 3000 && exit 1; busy=$(lsof "$device" 2>/dev/null | tail -n +2 | awk '{print $1}' | head -1); [[ -n $busy ]] && notify-send "Webcam in use by $busy" -u critical -t 5000 && exit 1; scale=$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .scale'); target=$(awk "BEGIN {printf \"%.0f\", 360 * $scale}"); ffplay -f v4l2 -framerate 30 "$device" -vf "crop=iw/2:ih,scale=${target}:-1" -window_title "WebcamOverlay" -noborder -fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0 -loglevel quiet & sleep 2; gpu-screen-recorder -w "$(hyprctl monitors -j | jq -r '.[] | select(.focused == true) | .name')" -k auto -f 60 -fm cfr -fallback-cpu-encoding yes -o "$HOME/Videos/screenrecording-$(date +'%Y-%m-%d_%H-%M-%S').mp4" & pkill -RTMIN+8 waybar"#.to_string());
        commands.insert("screenrecord.stop".to_string(), "omarchy capture screenrecording --stop-recording".to_string());
        commands.insert("open_recordings_folder".to_string(), "xdg-open \"$HOME/Videos\"".to_string());

        // Window management
        commands.insert("close_window".to_string(), "hyprctl dispatch killactive".to_string());
        commands.insert("app_launcher".to_string(), "walker".to_string());

        // System
        commands.insert("nightlight.toggle".to_string(), "omarchy toggle nightlight".to_string());
        commands.insert("lock_screen".to_string(), "omarchy system lock".to_string());

        // Workspaces
        for i in 1..=10 {
            commands.insert(
                format!("workspace.{}", i),
                format!("hyprctl dispatch workspace {}", i),
            );
        }

        // Media
        commands.insert("media.play_pause".to_string(), "playerctl play-pause".to_string());
        commands.insert("media.next".to_string(), "playerctl next".to_string());
        commands.insert("media.prev".to_string(), "playerctl previous".to_string());
        commands.insert("media.volume_up".to_string(), "wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+".to_string());
        commands.insert("media.volume_down".to_string(), "wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-".to_string());
        commands.insert("media.mute".to_string(), "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle".to_string());

        Self { commands }
    }

    pub fn resolve(&self, action: &str) -> Option<&str> {
        self.commands.get(action).map(|s| s.as_str())
    }
}
