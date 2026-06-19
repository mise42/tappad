import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const landingPath = path.join(repoRoot, "landing", "index.html");
const html = readFileSync(landingPath, "utf8");
const anchorPattern = /<a\b[^>]*>/g;
const failures = [];

for (const match of html.matchAll(anchorPattern)) {
  const anchor = match[0];

  if (!/(?:\s|<)download(?:\s|>|=)/.test(anchor)) {
    continue;
  }

  const hrefMatch = anchor.match(/\bhref="([^"]+)"/);
  if (!hrefMatch) {
    failures.push(`download anchor is missing href: ${anchor}`);
    continue;
  }

  const href = hrefMatch[1];

  if (/^(https?:)?\/\//.test(href) || href.startsWith("mailto:")) {
    continue;
  }

  const resolvedPath = path.resolve(path.dirname(landingPath), href);

  if (!resolvedPath.startsWith(repoRoot + path.sep)) {
    failures.push(`download href escapes repo root: ${href}`);
    continue;
  }

  if (!existsSync(resolvedPath)) {
    failures.push(`download href points to a missing file: ${href}`);
    continue;
  }

  const ignored = spawnSync("git", ["check-ignore", "-q", path.relative(repoRoot, resolvedPath)], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (ignored.status === 0) {
    failures.push(`download href points to an ignored file: ${href}`);
  } else if (ignored.status !== 1) {
    throw new Error(`git check-ignore failed for ${href}`);
  }

  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", path.relative(repoRoot, resolvedPath)], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (tracked.status === 1) {
    failures.push(`download href points to an untracked file: ${href}`);
    continue;
  }
  if (tracked.status !== 0) {
    throw new Error(`git ls-files failed for ${href}`);
  }
}

if (failures.length > 0) {
  console.error("Landing download link validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Landing download links are valid.");
