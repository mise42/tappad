import { readFileSync } from "node:fs";

const files = {
  frontend: "mobile/index.html",
  desktopActions: "host/src/actions.rs",
  hostContract: "host/src/host_contract.rs",
};

const text = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

const frontendActions = uniqueMatches(text.frontend, /data-cmd="([^"]+)"/g);
const uiActions = rustConstArrayActions(text.desktopActions, "UI_ACTION_IDS");
const desktopActions = rustConstArrayActions(text.hostContract, "ACTION_IDS");
const desktopCodexActions = desktopActions.filter((action) => action.startsWith("codex.voice."));
const desktopWorkspaceActions = desktopActions.filter((action) => action.startsWith("workspace."));
const rustContractVersion = requiredMatch(text.hostContract, /HOST_CONTRACT_VERSION:\s*u16\s*=\s*(\d+)/, "Rust Host Contract version");

assertNoRawShellDesktopAction(frontendActions, "frontend");
assertNoRawShellDesktopAction(desktopActions, "Desktop host actions");

assertSameSet(frontendActions, uiActions, "frontend data-cmd", "Desktop host UI actions");
assertSubset(uiActions, desktopActions, "Desktop host UI actions", "Desktop host actions");
assert(desktopCodexActions.length === 4, "Host Contract must keep the four named Codex voice actions");
assert(desktopWorkspaceActions.length === 8, "Host Contract must keep the eight named Omarchy workspace actions");

console.log(
  `Desktop Action check passed for Host Contract v${rustContractVersion}, ${frontendActions.length} browser actions, and ${desktopActions.length} Omarchy Host actions.`,
);

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

function requiredMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) fail(`${label} not found.`);
  return match[1];
}

function assert(condition, message) {
  if (!condition) fail(message);
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

function assertSubset(subset, superset, subsetLabel, supersetLabel) {
  const missing = difference(subset, superset);
  if (missing.length > 0) {
    fail(`${supersetLabel} missing ${subsetLabel}: ${missing.join(", ")}`);
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
