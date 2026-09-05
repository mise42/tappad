import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const fixtureDir = mkdtempSync(path.join(tmpdir(), "tappad-download-manifest-"));
const outputPath = path.join(fixtureDir, "downloads.json");

try {
  writeFileSync(path.join(fixtureDir, "TapPad.dmg"), "legacy macOS app");
  writeFileSync(path.join(fixtureDir, "TapPad-setup.exe"), "legacy Windows app");
  writeFileSync(path.join(fixtureDir, "TapPad-Omarchy-x86_64.tar.gz"), "Omarchy package");

  const downloads = buildManifest();
  assert(downloads.length === 1, "only one maintained download must be published");
  assert(downloads[0]?.platform === "linux", "the maintained download must target Omarchy");
  assert(downloads[0]?.label === "Omarchy", "the download label must name Omarchy");
  assert(downloads[0]?.file === "TapPad-Omarchy-x86_64.tar.gz", "the Omarchy package must be selected");
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

console.log("Download manifest publishes only the Omarchy artifact.");

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
