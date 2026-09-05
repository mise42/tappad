//! Omarchy-only TapPad Host command-line entry point.

mod actions;
mod authorization;
mod backend;
mod diagnostics;
mod discovery;
mod host_contract;
mod host_surface;
mod input;
mod input_chord;
mod protocol;
mod protocol_router;
mod settings;

use std::{
    env,
    error::Error,
    io,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::PathBuf,
    process::ExitCode,
    time::Duration,
};

#[cfg(target_os = "linux")]
use std::process::Command;

use backend::BackendRuntime;
use host_surface::host_surface_state;
use settings::{RuntimeSettings, persist_settings};

#[tokio::main]
async fn main() -> ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .filter_module("tungstenite", log::LevelFilter::Off)
        .filter_module("tokio_tungstenite", log::LevelFilter::Off)
        .format(|buffer, record| {
            use std::io::Write;
            // Even a more specific RUST_LOG directive must not expose WS frames.
            if !["tungstenite", "tokio_tungstenite"].iter().any(|prefix| {
                record.target() == *prefix || record.target().starts_with(&format!("{prefix}::"))
            }) {
                writeln!(buffer, "{}: {}", record.level(), record.args())?;
            }
            Ok(())
        })
        .init();

    match execute(env::args().skip(1).collect()).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("tappad-host: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn execute(args: Vec<String>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let command = args.first().map(String::as_str).unwrap_or("run");
    let data_dir = data_dir()?;

    match command {
        "run" => run(data_dir).await,
        "status" => print_state(&data_dir, false),
        "pairing" => print_state(&data_dir, true),
        "reset-pairing" => reset_pairing(&data_dir),
        "start" | "stop" | "restart" => control_service(command),
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        unknown => Err(format!("unknown command: {unknown}").into()),
    }
}

async fn run(data_dir: PathBuf) -> Result<(), Box<dyn Error + Send + Sync>> {
    let settings = RuntimeSettings::from_store(&data_dir, true)?;
    let listener = backend::bind(&settings).await?;
    let runtime = BackendRuntime::new(settings)?;
    let running = backend::spawn(listener, runtime)?;

    tokio::signal::ctrl_c().await?;
    running.shutdown.cancel();
    running.task.await?;
    Ok(())
}

fn print_state(
    data_dir: &std::path::Path,
    include_pairing: bool,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let settings = RuntimeSettings::from_store(data_dir, true)?;
    let running = host_is_running(settings.port);
    let (input_ready, input_error) = diagnostics::input_device_probe();
    let state = host_surface_state(
        &settings,
        running,
        (!running).then(|| "TapPad Host is not accepting local connections".to_string()),
        include_pairing,
        input_ready,
        input_error,
    );
    println!("{}", serde_json::to_string(&state)?);
    Ok(())
}

fn reset_pairing(data_dir: &std::path::Path) -> Result<(), Box<dyn Error + Send + Sync>> {
    let settings = RuntimeSettings::from_store(data_dir, true)?.with_new_token();
    persist_settings(data_dir, &settings)?;
    println!(r#"{{"reset":true,"restartRequired":true}}"#);
    Ok(())
}

fn control_service(action: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = action;
        return Err("service control is available only on Omarchy/Linux".into());
    }

    #[cfg(target_os = "linux")]
    {
        let status = Command::new("systemctl")
            .args(["--user", action, "tappad-host.service"])
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("systemctl --user {action} failed with {status}").into())
        }
    }
}

fn host_is_running(port: u16) -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn data_dir() -> io::Result<PathBuf> {
    if let Some(path) = env::var_os("XDG_CONFIG_HOME") {
        return Ok(PathBuf::from(path).join("tappad"));
    }

    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join(".config/tappad"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "HOME is not set"))
}

fn print_help() {
    println!(
        "TapPad Host\n\nUsage: tappad-host [run|status|pairing|reset-pairing|start|stop|restart]"
    );
}
