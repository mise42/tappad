use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::Deserialize;
use tokio::sync::Mutex;

use crate::input::InputDevice;

use super::{ActionError, CapabilityStatus, scoped_capability};

pub(super) const START_VOICE_ACTION: &str = "codex.voice.start";
pub(super) const END_VOICE_ACTION: &str = "codex.voice.end";
pub(super) const TOGGLE_MICROPHONE_ACTION: &str = "codex.voice.toggle_microphone";

const START_VOICE_COMMAND: &str = "realtimeVoice";
const END_VOICE_COMMAND: &str = "realtimeVoice.endCall";
const TOGGLE_MICROPHONE_COMMAND: &str = "realtimeVoice.toggleMicrophoneMute";
const GLOBAL_SCOPE: &str = "os-global";
const APP_SCOPE: &str = "app";

const CODEX_EXECUTABLES: &[&str] = &[
    "/usr/bin/chatgpt",
    "/usr/bin/codex-desktop",
    "/usr/lib/chatgpt/ChatGPT",
];

#[derive(Debug, Deserialize)]
struct Keybinding {
    command: String,
    key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct StartBinding {
    accelerator: String,
    input_codes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProbeError {
    reason_code: &'static str,
    detail: String,
}

struct ProbePaths {
    keybindings: PathBuf,
    executables: Vec<PathBuf>,
    proc_root: PathBuf,
}

impl ProbePaths {
    fn current_host() -> Result<Self, ProbeError> {
        let home = std::env::var_os("HOME").ok_or_else(|| ProbeError {
            reason_code: "codex_home_unavailable",
            detail: "HOME is unavailable, so TapPad cannot locate Codex keybindings.".to_string(),
        })?;

        Ok(Self {
            keybindings: PathBuf::from(home).join(".codex/keybindings.json"),
            executables: CODEX_EXECUTABLES.iter().map(PathBuf::from).collect(),
            proc_root: PathBuf::from("/proc"),
        })
    }
}

pub(super) fn is_codex_action(action: &str) -> bool {
    matches!(
        action,
        START_VOICE_ACTION | END_VOICE_ACTION | TOGGLE_MICROPHONE_ACTION
    )
}

pub(super) fn capability(action: &str) -> Option<CapabilityStatus> {
    match action {
        START_VOICE_ACTION => Some(start_voice_capability()),
        END_VOICE_ACTION => Some(app_only_capability("End Voice Chat", END_VOICE_COMMAND)),
        TOGGLE_MICROPHONE_ACTION => Some(app_only_capability(
            "Toggle Voice Chat microphone",
            TOGGLE_MICROPHONE_COMMAND,
        )),
        _ => None,
    }
}

pub(super) async fn execute(
    input: Arc<Mutex<InputDevice>>,
    action: &str,
) -> Result<(), ActionError> {
    if action != START_VOICE_ACTION {
        let capability = capability(action).ok_or_else(|| ActionError::unknown(action))?;
        return Err(ActionError::unavailable(
            "Linux",
            action,
            capability
                .note
                .unwrap_or_else(|| "Codex action is unavailable".to_string()),
        ));
    }

    let paths = ProbePaths::current_host()
        .map_err(|error| ActionError::unavailable("Linux", action, error.detail))?;
    let binding = probe_start_binding(&paths)
        .map_err(|error| ActionError::unavailable("Linux", action, error.detail))?;
    let codes: Vec<&str> = binding.input_codes.iter().map(String::as_str).collect();

    input
        .lock()
        .await
        .chord(&codes)
        .map_err(|error| ActionError::failed("Linux", action, error))
}

fn start_voice_capability() -> CapabilityStatus {
    let paths = match ProbePaths::current_host() {
        Ok(paths) => paths,
        Err(error) => return unavailable_start(error),
    };

    start_voice_capability_for(&paths)
}

fn start_voice_capability_for(paths: &ProbePaths) -> CapabilityStatus {
    match probe_start_binding(paths) {
        Ok(binding) => scoped_capability(
            "supported",
            format!(
                "Dispatches Codex's configured OS-global Voice Chat hotkey ({}). TapPad can verify hotkey dispatch, not that a voice session started.",
                binding.accelerator
            ),
            GLOBAL_SCOPE,
            None,
        ),
        Err(error) => unavailable_start(error),
    }
}

fn unavailable_start(error: ProbeError) -> CapabilityStatus {
    scoped_capability(
        "unavailable",
        error.detail,
        GLOBAL_SCOPE,
        Some(error.reason_code),
    )
}

fn app_only_capability(label: &str, command: &str) -> CapabilityStatus {
    let configured = configured_accelerator(command)
        .map(|accelerator| format!(" It is currently configured as {accelerator}."))
        .unwrap_or_default();
    scoped_capability(
        "unavailable",
        format!(
            "Codex defines {label} as an app-only shortcut.{configured} TapPad will not inject it when Codex may be in the background.",
        ),
        APP_SCOPE,
        Some("codex_app_scope_only"),
    )
}

fn configured_accelerator(command: &str) -> Option<String> {
    let paths = ProbePaths::current_host().ok()?;
    read_keybindings(&paths.keybindings)
        .ok()?
        .into_iter()
        .find(|binding| binding.command == command)
        .map(|binding| binding.key)
}

fn probe_start_binding(paths: &ProbePaths) -> Result<StartBinding, ProbeError> {
    if !paths.executables.iter().any(|path| path.is_file()) {
        return Err(ProbeError {
            reason_code: "codex_not_installed",
            detail: "Codex desktop was not found at a supported Linux installation path."
                .to_string(),
        });
    }

    let bindings = read_keybindings(&paths.keybindings)?;
    let mut matching_bindings = bindings
        .into_iter()
        .filter(|binding| binding.command == START_VOICE_COMMAND);
    let binding = matching_bindings.next().ok_or_else(|| ProbeError {
        reason_code: "codex_global_binding_missing",
        detail: "Codex has no configured OS-global Voice Chat hotkey.".to_string(),
    })?;
    if matching_bindings.next().is_some() {
        return Err(ProbeError {
            reason_code: "codex_global_binding_ambiguous",
            detail: "Codex has more than one configured OS-global Voice Chat hotkey; TapPad will not guess which binding is active."
                .to_string(),
        });
    }
    let input_codes = parse_accelerator(&binding.key)?;

    match codex_is_running(&paths.proc_root) {
        Ok(true) => {}
        Ok(false) => {
            return Err(ProbeError {
                reason_code: "codex_not_running",
                detail: "Codex desktop is installed but not running, so its global Voice Chat hotkey is not registered."
                    .to_string(),
            });
        }
        Err(error) => {
            return Err(ProbeError {
                reason_code: "codex_runtime_unreadable",
                detail: format!("TapPad could not inspect the Codex desktop runtime: {error}"),
            });
        }
    }

    Ok(StartBinding {
        accelerator: binding.key,
        input_codes,
    })
}

fn read_keybindings(path: &Path) -> Result<Vec<Keybinding>, ProbeError> {
    let contents = fs::read_to_string(path).map_err(|error| ProbeError {
        reason_code: "codex_bindings_unreadable",
        detail: format!(
            "TapPad could not read Codex keybindings at {}: {error}",
            path.display()
        ),
    })?;
    serde_json::from_str(&contents).map_err(|error| ProbeError {
        reason_code: "codex_bindings_invalid",
        detail: format!(
            "Codex keybindings at {} are not valid JSON: {error}",
            path.display()
        ),
    })
}

fn parse_accelerator(accelerator: &str) -> Result<Vec<String>, ProbeError> {
    let mut codes = Vec::new();
    let mut primary_key_seen = false;

    for token in accelerator.split('+').map(str::trim) {
        if token.is_empty() {
            return Err(invalid_accelerator(accelerator, "contains an empty key"));
        }

        if let Some(modifier) = modifier_code(token) {
            if primary_key_seen {
                return Err(invalid_accelerator(
                    accelerator,
                    "places a modifier after the primary key",
                ));
            }
            if codes.iter().any(|code| code == modifier) {
                return Err(invalid_accelerator(accelerator, "repeats a modifier"));
            }
            codes.push(modifier.to_string());
            continue;
        }

        if primary_key_seen {
            return Err(invalid_accelerator(
                accelerator,
                "contains more than one primary key",
            ));
        }
        let primary = primary_key_code(token)
            .ok_or_else(|| invalid_accelerator(accelerator, "uses an unsupported key"))?;
        codes.push(primary);
        primary_key_seen = true;
    }

    if !primary_key_seen {
        return Err(invalid_accelerator(
            accelerator,
            "does not contain a primary key",
        ));
    }
    Ok(codes)
}

fn modifier_code(token: &str) -> Option<&'static str> {
    if token.eq_ignore_ascii_case("command")
        || token.eq_ignore_ascii_case("cmd")
        || token.eq_ignore_ascii_case("super")
        || token.eq_ignore_ascii_case("meta")
    {
        Some("MetaLeft")
    } else if token.eq_ignore_ascii_case("commandorcontrol")
        || token.eq_ignore_ascii_case("cmdorctrl")
        || token.eq_ignore_ascii_case("control")
        || token.eq_ignore_ascii_case("ctrl")
    {
        Some("ControlLeft")
    } else if token.eq_ignore_ascii_case("option") || token.eq_ignore_ascii_case("alt") {
        Some("AltLeft")
    } else if token.eq_ignore_ascii_case("shift") {
        Some("ShiftLeft")
    } else {
        None
    }
}

fn primary_key_code(token: &str) -> Option<String> {
    let upper = token.to_ascii_uppercase();
    if let Some(number) = upper
        .strip_prefix('F')
        .and_then(|value| value.parse::<u8>().ok())
        && (1..=12).contains(&number)
    {
        return Some(format!("F{number}"));
    }
    if upper.len() == 1 {
        let ch = upper.chars().next()?;
        if ch.is_ascii_alphabetic() {
            return Some(format!("Key{ch}"));
        }
        if ch.is_ascii_digit() {
            return Some(format!("Digit{ch}"));
        }
    }

    match upper.as_str() {
        "ENTER" | "RETURN" => Some("Enter".to_string()),
        "ESC" | "ESCAPE" => Some("Escape".to_string()),
        "TAB" => Some("Tab".to_string()),
        "SPACE" => Some("Space".to_string()),
        "BACKSPACE" => Some("Backspace".to_string()),
        "DELETE" => Some("Delete".to_string()),
        "HOME" => Some("Home".to_string()),
        "END" => Some("End".to_string()),
        "PAGEUP" => Some("PageUp".to_string()),
        "PAGEDOWN" => Some("PageDown".to_string()),
        "UP" | "ARROWUP" => Some("ArrowUp".to_string()),
        "DOWN" | "ARROWDOWN" => Some("ArrowDown".to_string()),
        "LEFT" | "ARROWLEFT" => Some("ArrowLeft".to_string()),
        "RIGHT" | "ARROWRIGHT" => Some("ArrowRight".to_string()),
        _ => None,
    }
}

fn invalid_accelerator(accelerator: &str, reason: &str) -> ProbeError {
    ProbeError {
        reason_code: "codex_global_binding_unsupported",
        detail: format!(
            "Codex's OS-global Voice Chat hotkey ({accelerator}) cannot be dispatched safely because it {reason}."
        ),
    }
}

fn codex_is_running(proc_root: &Path) -> std::io::Result<bool> {
    for entry in fs::read_dir(proc_root)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry
            .file_name()
            .to_string_lossy()
            .chars()
            .all(|ch| ch.is_ascii_digit())
        {
            continue;
        }
        let comm = match fs::read_to_string(entry.path().join("comm")) {
            Ok(comm) => comm,
            Err(_) => continue,
        };
        if comm.trim().eq_ignore_ascii_case("ChatGPT") {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn fixture(bindings: serde_json::Value, running: bool) -> (TempDir, ProbePaths) {
        let temp = tempfile::tempdir().expect("tempdir");
        let executable = temp.path().join("ChatGPT");
        fs::write(&executable, "fixture").expect("fake executable");
        let keybindings = temp.path().join("keybindings.json");
        fs::write(&keybindings, bindings.to_string()).expect("keybindings");
        let proc_root = temp.path().join("proc");
        fs::create_dir(&proc_root).expect("proc root");
        if running {
            let process = proc_root.join("1234");
            fs::create_dir(&process).expect("process");
            fs::write(process.join("comm"), "ChatGPT\n").expect("comm");
        }
        (
            temp,
            ProbePaths {
                keybindings,
                executables: vec![executable],
                proc_root,
            },
        )
    }

    #[test]
    fn configured_global_start_binding_is_ready_when_codex_is_running() {
        let (_temp, paths) = fixture(
            json!([{"command": START_VOICE_COMMAND, "key": "Command+F2"}]),
            true,
        );

        assert_eq!(
            probe_start_binding(&paths),
            Ok(StartBinding {
                accelerator: "Command+F2".to_string(),
                input_codes: vec!["MetaLeft".to_string(), "F2".to_string()],
            })
        );

        let capability = start_voice_capability_for(&paths);
        assert_eq!(capability.state, "supported");
        assert_eq!(capability.scope, Some(GLOBAL_SCOPE));
        assert_eq!(capability.reason_code, None);
        assert!(capability.note.expect("note").contains("Command+F2"));
    }

    #[test]
    fn installed_but_stopped_codex_is_unavailable() {
        let (_temp, paths) = fixture(
            json!([{"command": START_VOICE_COMMAND, "key": "Command+F2"}]),
            false,
        );

        let error = probe_start_binding(&paths).expect_err("stopped app is unavailable");
        assert_eq!(error.reason_code, "codex_not_running");
    }

    #[test]
    fn missing_global_binding_is_unavailable() {
        let (_temp, paths) = fixture(json!([{"command": END_VOICE_COMMAND, "key": "F4"}]), true);

        let error = probe_start_binding(&paths).expect_err("binding is required");
        assert_eq!(error.reason_code, "codex_global_binding_missing");
    }

    #[test]
    fn unreadable_or_invalid_keybinding_files_are_explicitly_unavailable() {
        let (_temp, mut unreadable_paths) = fixture(
            json!([{"command": START_VOICE_COMMAND, "key": "Command+F2"}]),
            true,
        );
        unreadable_paths.keybindings = unreadable_paths.keybindings.with_file_name("missing.json");
        let unreadable =
            probe_start_binding(&unreadable_paths).expect_err("missing keybindings must fail");
        assert_eq!(unreadable.reason_code, "codex_bindings_unreadable");

        let (_temp, invalid_paths) = fixture(json!([]), true);
        fs::write(&invalid_paths.keybindings, "not-json").expect("invalid keybindings fixture");
        let invalid = probe_start_binding(&invalid_paths).expect_err("invalid JSON must fail");
        assert_eq!(invalid.reason_code, "codex_bindings_invalid");
    }

    #[test]
    fn unsupported_global_binding_is_not_silently_ignored() {
        let (_temp, paths) = fixture(
            json!([{"command": START_VOICE_COMMAND, "key": "Command+VolumeUp"}]),
            true,
        );

        let error = probe_start_binding(&paths).expect_err("unsupported key must fail");
        assert_eq!(error.reason_code, "codex_global_binding_unsupported");
        assert!(error.detail.contains("VolumeUp"));
    }

    #[test]
    fn duplicate_global_bindings_are_not_silently_resolved() {
        let (_temp, paths) = fixture(
            json!([
                {"command": START_VOICE_COMMAND, "key": "Command+F2"},
                {"command": START_VOICE_COMMAND, "key": "Command+F3"}
            ]),
            true,
        );

        let error = probe_start_binding(&paths).expect_err("duplicate bindings are ambiguous");
        assert_eq!(error.reason_code, "codex_global_binding_ambiguous");
    }

    #[test]
    fn missing_codex_installation_is_reported_before_binding_dispatch() {
        let (_temp, mut paths) = fixture(
            json!([{"command": START_VOICE_COMMAND, "key": "Command+F2"}]),
            true,
        );
        paths.executables = vec![paths.keybindings.with_file_name("missing")];

        let error = probe_start_binding(&paths).expect_err("installation is required");
        assert_eq!(error.reason_code, "codex_not_installed");
    }

    #[test]
    fn app_scoped_end_and_mute_are_never_runnable() {
        for action in [END_VOICE_ACTION, TOGGLE_MICROPHONE_ACTION] {
            let capability = capability(action).expect("Codex capability");
            assert_eq!(capability.state, "unavailable");
            assert_eq!(capability.scope, Some(APP_SCOPE));
            assert_eq!(capability.reason_code, Some("codex_app_scope_only"));
        }
    }

    #[test]
    fn accelerator_parser_rejects_ambiguous_or_bare_modifier_bindings() {
        for accelerator in ["Command", "Command+F2+F3", "F2+Command", "Command++F2"] {
            assert!(
                parse_accelerator(accelerator).is_err(),
                "{accelerator} should be rejected"
            );
        }
    }
}
