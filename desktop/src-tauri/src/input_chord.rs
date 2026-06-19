use std::io;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn chord_sequence<F>(code_names: &[&str], mut send_key: F) -> io::Result<()>
where
    F: FnMut(&str, bool) -> io::Result<()>,
{
    let mut pressed = Vec::new();
    let mut result = Ok(());

    for code_name in code_names {
        if let Err(error) = send_key(code_name, true) {
            result = Err(error);
            break;
        }
        pressed.push(*code_name);
    }

    for code_name in pressed.into_iter().rev() {
        if let Err(error) = send_key(code_name, false) {
            if result.is_ok() {
                result = Err(error);
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chord_releases_pressed_keys_when_later_press_fails() {
        let mut events = Vec::new();
        let result = chord_sequence(&["AltLeft", "F4"], |code, down| {
            events.push((code.to_string(), down));
            if code == "F4" && down {
                return Err(io::Error::other("press failed"));
            }
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(
            events,
            vec![
                ("AltLeft".to_string(), true),
                ("F4".to_string(), true),
                ("AltLeft".to_string(), false),
            ]
        );
    }

    #[test]
    fn chord_reports_release_error_after_releasing_other_pressed_keys() {
        let mut events = Vec::new();
        let result = chord_sequence(&["MetaLeft", "PrintScreen"], |code, down| {
            events.push((code.to_string(), down));
            if code == "MetaLeft" && !down {
                return Err(io::Error::other("release failed"));
            }
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(
            events,
            vec![
                ("MetaLeft".to_string(), true),
                ("PrintScreen".to_string(), true),
                ("PrintScreen".to_string(), false),
                ("MetaLeft".to_string(), false),
            ]
        );
    }
}
