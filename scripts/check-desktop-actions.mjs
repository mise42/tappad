import { readFileSync } from "node:fs";

const files = {
  frontend: "mobile/index.html",
  desktopActions: "desktop/src-tauri/src/actions.rs",
};

const text = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

const frontendActions = uniqueMatches(text.frontend, /data-cmd="([^"]+)"/g);
const desktopActions = rustConstArrayActions(text.desktopActions, "ACTION_IDS");

assertNoRawShellDesktopAction(frontendActions, "frontend");
assertNoRawShellDesktopAction(desktopActions, "Desktop host actions");

assertSameSet(frontendActions, desktopActions, "frontend data-cmd", "Desktop host actions");

console.log(`Desktop Action check passed for ${frontendActions.length} frontend actions.`);

function uniqueMatches(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

function rustConstArrayActions(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}:\\s*&\\[&str\\]\\s*=\\s*&\\[([\\s\\S]*?)\\];`));
  if (!match) {
    fail(`Rust const array ${name} not found.`);
  }
  return uniqueMatches(match[1], /"([^"]+)"/g);
}

function assertNoRawShellDesktopAction(actions, label) {
  if (actions.includes("raw-shell")) {
    fail(`${label} includes raw shell-command action, which is outside Desktop Actions.`);
  }
}

function assertSameSet(left, right, leftLabel, rightLabel) {
  const missingRight = difference(left, right);
  const missingLeft = difference(right, left);
  if (missingRight.length > 0 || missingLeft.length > 0) {
    const details = [
      missingRight.length ? `${rightLabel} missing ${leftLabel}: ${missingRight.join(", ")}` : "",
      missingLeft.length ? `${leftLabel} missing ${rightLabel}: ${missingLeft.join(", ")}` : "",
    ].filter(Boolean);
    fail(details.join("\n"));
  }
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
