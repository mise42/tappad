mod protocol;
mod server;

#[cfg(target_os = "windows")]
mod windows_input;

#[cfg(not(target_os = "windows"))]
mod unsupported_input;

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            tauri::async_runtime::spawn(async {
                if let Err(error) = server::run().await {
                    eprintln!("TapPad Windows backend failed: {error}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run TapPad Windows backend");
}
