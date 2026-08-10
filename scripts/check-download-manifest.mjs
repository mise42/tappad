import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const fixtureDir = mkdtempSync(path.join(tmpdir(), "tappad-download-manifest-"));
const outputPath = path.join(fixtureDir, "downloads.json");

try {
  writeFileSync(path.join(fixtureDir, "TapPad-mac.zip"), "legacy native app");
  writeFileSync(path.join(fixtureDir, "TapPad-setup.exe"), "windows app");

  let downloads = buildManifest();
  assert(!downloads.some(({ platform }) => platform === "macos"), "legacy macOS ZIP must not be published");

  writeFileSync(path.join(fixtureDir, "TapPad.dmg"), "tauri macOS app");
  downloads = buildManifest();

  const macosDownload = downloads.find(({ platform }) => platform === "macos");
  assert(macosDownload?.file === "TapPad.dmg", "Tauri DMG must be the macOS download");
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log("Download manifest rejects legacy native macOS ZIP artifacts.");

function buildManifest() {
  const result = spawnSync(
    process.execPath,
    ["scripts/build-download-manifest.mjs", fixtureDir, outputPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        TAPPAD_DOWNLOAD_BASE_URL: "https://downloads.example.test",
        TAPPAD_RELEASE_TAG: "test-release",
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Download manifest command failed.");
  }

  return JSON.parse(readFileSync(outputPath, "utf8")).downloads;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
