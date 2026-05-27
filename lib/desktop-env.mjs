import fs from "node:fs";
import path from "node:path";

export function buildDesktopEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  env.XDG_RUNTIME_DIR ||= `/run/user/${typeof process.getuid === "function" ? process.getuid() : 1000}`;

  if (!env.WAYLAND_DISPLAY) {
    try {
      const sockets = fs.readdirSync(env.XDG_RUNTIME_DIR).filter((entry) => /^wayland-\d+$/.test(entry));
      env.WAYLAND_DISPLAY = sockets.includes("wayland-1") ? "wayland-1" : sockets[0];
    } catch {
      // Keep the environment unchanged; wl-copy will report the concrete failure.
    }
  }

  if (!env.HYPRLAND_INSTANCE_SIGNATURE) {
    try {
      const hyprDir = path.join(env.XDG_RUNTIME_DIR, "hypr");
      const sessions = fs
        .readdirSync(hyprDir)
        .filter((entry) => fs.existsSync(path.join(hyprDir, entry, ".socket.sock")))
        .map((entry) => ({
          entry,
          mtimeMs: fs.statSync(path.join(hyprDir, entry, ".socket.sock")).mtimeMs
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      env.HYPRLAND_INSTANCE_SIGNATURE = sessions[0]?.entry;
    } catch {
      // hyprctl is a best-effort paste path; uinput helper is the fallback.
    }
  }

  return env;
}
