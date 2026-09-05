//! Codex shortcut metadata discovery.

use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

use serde::Deserialize;

const MAX_ASAR_HEADER_BYTES: u64 = 32 * 1024 * 1024;
const MAX_COMMAND_BUNDLE_BYTES: u64 = 32 * 1024 * 1024;

static COMMAND_BINDING_CACHE: OnceLock<Mutex<HashMap<(PathBuf, String), CachedBinding>>> =
    OnceLock::new();

#[derive(Clone, PartialEq, Eq)]
struct ArchiveFingerprint {
    len: u64,
    modified: Option<SystemTime>,
}

#[derive(Clone)]
struct CachedBinding {
    fingerprint: ArchiveFingerprint,
    result: Result<String, MetadataError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum MetadataError {
    Unreadable(String),
    Invalid(String),
    CommandMissing,
    CommandAmbiguous,
    ScopeMismatch,
    DefaultBindingMissing,
    DefaultBindingAmbiguous,
}

#[derive(Debug, Deserialize)]
struct AsarDirectory {
    files: BTreeMap<String, AsarEntry>,
}

#[derive(Debug, Deserialize)]
struct AsarEntry {
    #[serde(default)]
    files: BTreeMap<String, AsarEntry>,
    size: Option<u64>,
    offset: Option<String>,
    #[serde(default)]
    unpacked: bool,
}

pub(super) fn read_app_default_binding(
    archive: &Path,
    command: &str,
) -> Result<String, MetadataError> {
    let archive_metadata = fs::metadata(archive).map_err(|error| {
        MetadataError::Unreadable(format!("could not inspect {}: {error}", archive.display()))
    })?;
    let fingerprint = ArchiveFingerprint {
        len: archive_metadata.len(),
        modified: archive_metadata.modified().ok(),
    };
    let key = (archive.to_path_buf(), command.to_string());
    let cache = COMMAND_BINDING_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(cached) = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&key)
        .filter(|cached| cached.fingerprint == fingerprint)
    {
        return cached.result.clone();
    }

    let result = read_app_default_binding_uncached(archive, command);
    cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(
            key,
            CachedBinding {
                fingerprint,
                result: result.clone(),
            },
        );
    result
}

fn read_app_default_binding_uncached(
    archive: &Path,
    command: &str,
) -> Result<String, MetadataError> {
    let mut file = File::open(archive).map_err(|error| {
        MetadataError::Unreadable(format!("could not open {}: {error}", archive.display()))
    })?;
    let archive_len = file
        .metadata()
        .map_err(|error| MetadataError::Unreadable(error.to_string()))?
        .len();
    let (header, data_start) = read_header(&mut file, archive_len)?;
    let command_bundle = find_command_bundle(&header)?;
    let size = command_bundle.size.ok_or_else(|| {
        MetadataError::Invalid("the Codex command bundle has no size".to_string())
    })?;
    if size > MAX_COMMAND_BUNDLE_BYTES {
        return Err(MetadataError::Invalid(
            "the Codex command bundle exceeds the safe read limit".to_string(),
        ));
    }
    let relative_offset = command_bundle
        .offset
        .as_deref()
        .ok_or_else(|| {
            MetadataError::Invalid("the Codex command bundle has no offset".to_string())
        })?
        .parse::<u64>()
        .map_err(|error| {
            MetadataError::Invalid(format!(
                "the Codex command bundle offset is invalid: {error}"
            ))
        })?;
    let content_start = data_start
        .checked_add(relative_offset)
        .ok_or_else(|| MetadataError::Invalid("the Codex bundle offset overflowed".to_string()))?;
    let content_end = content_start
        .checked_add(size)
        .ok_or_else(|| MetadataError::Invalid("the Codex bundle size overflowed".to_string()))?;
    if content_end > archive_len {
        return Err(MetadataError::Invalid(
            "the Codex command bundle extends beyond the archive".to_string(),
        ));
    }

    let mut source = vec![
        0;
        usize::try_from(size).map_err(|error| {
            MetadataError::Invalid(format!("the Codex command bundle is too large: {error}"))
        })?
    ];
    file.seek(SeekFrom::Start(content_start))
        .and_then(|_| file.read_exact(&mut source))
        .map_err(|error| MetadataError::Unreadable(error.to_string()))?;
    let source = String::from_utf8(source).map_err(|error| {
        MetadataError::Invalid(format!("the Codex command bundle is not UTF-8: {error}"))
    })?;
    extract_app_default_binding(&source, command)
}

fn read_header(file: &mut File, archive_len: u64) -> Result<(AsarDirectory, u64), MetadataError> {
    let mut prefix = [0_u8; 16];
    file.read_exact(&mut prefix)
        .map_err(|error| MetadataError::Unreadable(error.to_string()))?;
    let size_pickle_payload = u32::from_le_bytes(prefix[0..4].try_into().unwrap()) as u64;
    let header_size = u32::from_le_bytes(prefix[4..8].try_into().unwrap()) as u64;
    let header_pickle_payload = u32::from_le_bytes(prefix[8..12].try_into().unwrap()) as u64;
    let json_size = u32::from_le_bytes(prefix[12..16].try_into().unwrap()) as u64;
    if size_pickle_payload != 4
        || !(8..=MAX_ASAR_HEADER_BYTES).contains(&header_size)
        || header_pickle_payload.checked_add(4) != Some(header_size)
        || json_size > header_pickle_payload.saturating_sub(4)
    {
        return Err(MetadataError::Invalid(
            "the Codex ASAR header has an unsupported shape".to_string(),
        ));
    }
    let data_start = 8_u64
        .checked_add(header_size)
        .ok_or_else(|| MetadataError::Invalid("the Codex ASAR header overflowed".to_string()))?;
    let json_end = 16_u64
        .checked_add(json_size)
        .ok_or_else(|| MetadataError::Invalid("the Codex ASAR JSON overflowed".to_string()))?;
    if json_end > data_start || data_start > archive_len {
        return Err(MetadataError::Invalid(
            "the Codex ASAR header extends beyond the archive".to_string(),
        ));
    }

    let mut json = vec![
        0;
        usize::try_from(json_size).map_err(|error| {
            MetadataError::Invalid(format!("the Codex ASAR header is too large: {error}"))
        })?
    ];
    file.seek(SeekFrom::Start(16))
        .and_then(|_| file.read_exact(&mut json))
        .map_err(|error| MetadataError::Unreadable(error.to_string()))?;
    let header = serde_json::from_slice(&json).map_err(|error| {
        MetadataError::Invalid(format!("the Codex ASAR header is invalid JSON: {error}"))
    })?;
    Ok((header, data_start))
}

fn find_command_bundle(header: &AsarDirectory) -> Result<&AsarEntry, MetadataError> {
    let assets = header
        .files
        .get("webview")
        .and_then(|entry| entry.files.get("assets"))
        .ok_or_else(|| {
            MetadataError::Invalid("the Codex webview assets directory is missing".to_string())
        })?;
    let mut bundles = assets.files.iter().filter_map(|(name, entry)| {
        (name.starts_with("app-initial-") && name.ends_with(".js") && !entry.unpacked)
            .then_some(entry)
    });
    let bundle = bundles
        .next()
        .ok_or_else(|| MetadataError::Invalid("the Codex command bundle is missing".to_string()))?;
    if bundles.next().is_some() {
        return Err(MetadataError::Invalid(
            "more than one Codex command bundle was found".to_string(),
        ));
    }
    Ok(bundle)
}

fn extract_app_default_binding(source: &str, command: &str) -> Result<String, MetadataError> {
    let matches = ['`', '\'', '"']
        .into_iter()
        .flat_map(|quote| {
            let needle = format!("id:{quote}{command}{quote}");
            source
                .match_indices(&needle)
                .map(|(position, _)| position)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return Err(MetadataError::CommandMissing);
    }
    if matches.len() != 1 {
        return Err(MetadataError::CommandAmbiguous);
    }

    let command_position = matches[0];
    let record_start = command_position
        .checked_sub(1)
        .filter(|position| source[*position..].starts_with("{id:"))
        .ok_or_else(|| {
            MetadataError::Invalid("the Codex command record has no start".to_string())
        })?;
    let after_start = &source[record_start..];
    let record_end = after_start.find("},{id:").ok_or_else(|| {
        MetadataError::Invalid("the Codex command record has no safe boundary".to_string())
    })?;
    let record = &after_start[..record_end + 1];

    if quoted_field(record, "shortcutScope:").as_deref() != Some("app") {
        return Err(MetadataError::ScopeMismatch);
    }
    let electron = object_field(record, "electron:").ok_or(MetadataError::DefaultBindingMissing)?;
    let binding_list = object_field(electron, "platformDefaultKeybindings:")
        .and_then(|platform| array_field(platform, "default:"))
        .or_else(|| array_field(electron, "defaultKeybindings:"))
        .ok_or(MetadataError::DefaultBindingMissing)?;
    let bindings = quoted_fields(binding_list, "key:");
    match bindings.as_slice() {
        [] => Err(MetadataError::DefaultBindingMissing),
        [binding] => Ok(binding.clone()),
        _ => Err(MetadataError::DefaultBindingAmbiguous),
    }
}

fn quoted_field(source: &str, marker: &str) -> Option<String> {
    let value = source.get(source.find(marker)? + marker.len()..)?;
    let quote = value.chars().next()?;
    if !matches!(quote, '`' | '\'' | '"') {
        return None;
    }
    let remainder = value.get(quote.len_utf8()..)?;
    let end = remainder.find(quote)?;
    Some(remainder[..end].to_string())
}

fn quoted_fields(source: &str, marker: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut remainder = source;
    while let Some(position) = remainder.find(marker) {
        remainder = &remainder[position + marker.len()..];
        let Some(quote) = remainder.chars().next() else {
            break;
        };
        if !matches!(quote, '`' | '\'' | '"') {
            continue;
        }
        remainder = &remainder[quote.len_utf8()..];
        let Some(end) = remainder.find(quote) else {
            break;
        };
        values.push(remainder[..end].to_string());
        remainder = &remainder[end + quote.len_utf8()..];
    }
    values
}

fn object_field<'a>(source: &'a str, marker: &str) -> Option<&'a str> {
    balanced_field(source, marker, '{', '}')
}

fn array_field<'a>(source: &'a str, marker: &str) -> Option<&'a str> {
    balanced_field(source, marker, '[', ']')
}

fn balanced_field<'a>(source: &'a str, marker: &str, open: char, close: char) -> Option<&'a str> {
    let marker_end = source.find(marker)? + marker.len();
    let value = source.get(marker_end..)?;
    if value.chars().next()? != open {
        return None;
    }
    let mut depth = 0_u32;
    let mut quote = None;
    let mut escaped = false;
    for (position, ch) in value.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '`' | '\'' | '"') {
            quote = Some(ch);
        } else if ch == open {
            depth += 1;
        } else if ch == close {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return value.get(..=position);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};
    use tempfile::TempDir;

    fn command_source(record: &str) -> String {
        format!("let commands=[{{id:`before`}},{record},{{id:`after`}}];")
    }

    fn write_asar(temp: &TempDir, source: &str) -> std::path::PathBuf {
        let archive = temp.path().join("app.asar");
        let header = serde_json::json!({
            "files": {
                "webview": {"files": {
                    "assets": {"files": {
                        "app-initial-fixture.js": {
                            "size": source.len(),
                            "offset": "0"
                        }
                    }}
                }}
            }
        })
        .to_string();
        let padding = (4 - ((4 + header.len()) % 4)) % 4;
        let header_pickle_payload = 4 + header.len() + padding;
        let header_size = 4 + header_pickle_payload;
        let mut file = File::create(&archive).expect("archive");
        file.write_all(&4_u32.to_le_bytes()).expect("size payload");
        file.write_all(&(header_size as u32).to_le_bytes())
            .expect("header size");
        file.write_all(&(header_pickle_payload as u32).to_le_bytes())
            .expect("header payload");
        file.write_all(&(header.len() as u32).to_le_bytes())
            .expect("json size");
        file.write_all(header.as_bytes()).expect("header");
        file.write_all(&vec![0; padding]).expect("padding");
        file.write_all(source.as_bytes()).expect("source");
        archive
    }

    #[test]
    fn reads_unique_app_scoped_linux_default_from_asar() {
        let temp = tempfile::tempdir().expect("tempdir");
        let archive = write_asar(
            &temp,
            &command_source(
                "{id:`composer.startVoiceMode`,shortcutScope:`app`,electron:{defaultKeybindings:[{key:`Ctrl+Shift+V`}]}}",
            ),
        );
        assert_eq!(
            read_app_default_binding(&archive, "composer.startVoiceMode"),
            Ok("Ctrl+Shift+V".to_string())
        );
    }

    #[test]
    fn linux_platform_default_takes_precedence_over_generic_default() {
        let source = command_source(
            "{id:`composer.startVoiceMode`,shortcutScope:`app`,electron:{platformDefaultKeybindings:{macOS:[{key:`Command+V`}],default:[{key:`Ctrl+V`}]},defaultKeybindings:[{key:`Alt+V`}]}}",
        );
        assert_eq!(
            extract_app_default_binding(&source, "composer.startVoiceMode"),
            Ok("Ctrl+V".to_string())
        );
    }

    #[test]
    fn rejects_wrong_scope_missing_command_and_multiple_defaults() {
        assert_eq!(
            extract_app_default_binding(
                &command_source(
                    "{id:`composer.startVoiceMode`,shortcutScope:`os-global`,electron:{defaultKeybindings:[{key:`Ctrl+V`}]}}",
                ),
                "composer.startVoiceMode",
            ),
            Err(MetadataError::ScopeMismatch)
        );
        assert_eq!(
            extract_app_default_binding(&command_source("{id:`other`}"), "composer.startVoiceMode"),
            Err(MetadataError::CommandMissing)
        );
        assert_eq!(
            extract_app_default_binding(
                &command_source(
                    "{id:`composer.startVoiceMode`,shortcutScope:`app`,electron:{defaultKeybindings:[{key:`Ctrl+V`},{key:`Alt+V`}]}}",
                ),
                "composer.startVoiceMode",
            ),
            Err(MetadataError::DefaultBindingAmbiguous)
        );
    }

    #[test]
    fn rejects_malformed_or_out_of_bounds_archives() {
        let temp = tempfile::tempdir().expect("tempdir");
        let archive = temp.path().join("bad.asar");
        fs::write(&archive, [0_u8; 16]).expect("bad archive");
        assert!(matches!(
            read_app_default_binding(&archive, "composer.startVoiceMode"),
            Err(MetadataError::Invalid(_))
        ));
    }

    #[test]
    fn cache_invalidates_when_the_installed_archive_changes() {
        let temp = tempfile::tempdir().expect("tempdir");
        let archive = write_asar(
            &temp,
            &command_source(
                "{id:`composer.startVoiceMode`,shortcutScope:`app`,electron:{defaultKeybindings:[{key:`Ctrl+V`}]}}",
            ),
        );
        assert_eq!(
            read_app_default_binding(&archive, "composer.startVoiceMode"),
            Ok("Ctrl+V".to_string())
        );
        write_asar(
            &temp,
            &command_source(
                "{id:`composer.startVoiceMode`,shortcutScope:`app`,electron:{defaultKeybindings:[{key:`Alt+Shift+V`}]}}",
            ),
        );
        assert_eq!(
            read_app_default_binding(&archive, "composer.startVoiceMode"),
            Ok("Alt+Shift+V".to_string())
        );
    }
}
