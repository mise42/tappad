import { readFileSync } from "node:fs";

const files = {
  frontend: "mobile/index.html",
  desktopActions: "host/src/actions.rs",
  hostContract: "host/src/host_contract.rs",
  nativeCodexVoice: "mobile-app/src/codexVoice.ts",
  mobileProtocol: "mobile-app/src/protocol.ts",
};

const text = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

const frontendActions = uniqueMatches(text.frontend, /data-cmd="([^"]+)"/g);
const uiActions = rustConstArrayActions(text.desktopActions, "UI_ACTION_IDS");
const desktopActions = rustConstArrayActions(text.hostContract, "ACTION_IDS");
const nativeCodexActions = uniqueMatches(text.nativeCodexVoice, /'(codex\.voice\.[^']+)'/g);
const desktopCodexActions = desktopActions.filter((action) => action.startsWith("codex.voice."));
const nativeWorkspaceActions = uniqueMatches(text.mobileProtocol, /action:\s*'(workspace\.[^']+)'/g);
const desktopWorkspaceActions = desktopActions.filter((action) => action.startsWith("workspace."));
const rustContractVersion = requiredMatch(text.hostContract, /HOST_CONTRACT_VERSION:\s*u16\s*=\s*(\d+)/, "Rust Host Contract version");
const mobileContractVersion = requiredMatch(text.mobileProtocol, /HOST_CONTRACT_VERSION\s*=\s*(\d+)/, "mobile Host Contract version");

assertNoRawShellDesktopAction(frontendActions, "frontend");
assertNoRawShellDesktopAction(desktopActions, "Desktop host actions");
assertNoRawShellDesktopAction(nativeCodexActions, "Native Codex actions");

assertSameSet(frontendActions, uiActions, "frontend data-cmd", "Desktop host UI actions");
assertSubset(uiActions, desktopActions, "Desktop host UI actions", "Desktop host actions");
assertSubset(nativeCodexActions, desktopActions, "Native Codex actions", "Desktop host actions");
assertSameSet(nativeCodexActions, desktopCodexActions, "Native Codex actions", "Desktop Codex actions");
assertSubset(nativeWorkspaceActions, desktopWorkspaceActions, "Native workspace actions", "Host Contract workspace actions");
if (rustContractVersion !== mobileContractVersion) {
  fail(`Host Contract version mismatch: Rust=${rustContractVersion}, mobile=${mobileContractVersion}`);
}

console.log(
  `Desktop Action check passed for Host Contract v${rustContractVersion}, ${frontendActions.length} frontend actions, ${nativeCodexActions.length} native Codex actions, and ${desktopActions.length} host actions.`,
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
