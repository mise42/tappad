import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const landingRoot = path.join(repoRoot, "landing");
const html = readFileSync(path.join(landingRoot, "index.html"), "utf8");
const script = readFileSync(path.join(landingRoot, "script.js"), "utf8");
const wrangler = readFileSync(path.join(landingRoot, "wrangler.toml"), "utf8");
const failures = [];

const linuxMatches = html.match(/data-platform=["']linux["']/g) || [];
if (linuxMatches.length !== 1) {
  failures.push(`expected one Omarchy download trigger, found ${linuxMatches.length}`);
}

for (const unsupported of ["macos", "windows"]) {
  if (new RegExp(`data-platform=["']${unsupported}["']`).test(html)) {
    failures.push(`landing still exposes the unsupported ${unsupported} download`);
  }
}

if (!script.includes('fetch("/api/downloads"')) {
  failures.push("landing script does not load the public /api/downloads endpoint");
}

if (!existsSync(path.join(landingRoot, "functions", "api", "downloads.js"))) {
  failures.push("public downloads function is missing");
}

if (existsSync(path.join(landingRoot, "functions", "api", "beta-access.js"))) {
  failures.push("legacy beta-access function still exists");
}

for (const [name, content] of [
  ["landing HTML", html],
  ["landing script", script],
  ["Wrangler configuration", wrangler],
]) {
  if (/beta-access|TAPPAD_LEADS_BUCKET|name=["']email["']/i.test(content)) {
    failures.push(`${name} still contains mandatory beta-access or lead-capture code`);
  }
}

if (failures.length > 0) {
  console.error("Landing download validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Landing downloads are public and ungated.");
