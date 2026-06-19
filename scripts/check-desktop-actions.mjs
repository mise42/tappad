import { readFileSync } from "node:fs";

const files = {
  frontend: "mobile/index.html",
  desktopActions: "desktop/src-tauri/src/actions.rs",
  macCommands: "macos/Sources/TapPad/Commands/CommandRegistry.swift",
  macServer: "macos/Sources/TapPad/Server/HttpWebSocketServer.swift",
};

const text = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

const frontendActions = uniqueMatches(text.frontend, /data-cmd="([^"]+)"/g);
const desktopActions = rustConstArrayActions(text.desktopActions, "ACTION_IDS");
const macCommandActions = uniqueMatches(text.macCommands, /"([^"]+)": \[/g);
const macCapabilityActions = uniqueMatches(text.macServer, /"([^"]+)": \[\s*"state":/g);
const macHiddenActions = swiftCapabilityActionsWithState(text.macServer, "hidden");

assertNoRawShellDesktopAction(frontendActions, "frontend");
assertNoRawShellDesktopAction(desktopActions, "Desktop host actions");
assertNoRawShellDesktopAction(macCommandActions, "macOS registry");
assertNoRawShellDesktopAction(macCapabilityActions, "macOS capabilities");

assertSameSet(frontendActions, desktopActions, "frontend data-cmd", "Desktop host actions");
assertSameSet(frontendActions, macCapabilityActions, "frontend data-cmd", "macOS action capabilities");
assertSubset(macCommandActions, macCapabilityActions, "macOS CommandRegistry", "macOS action capabilities");

const macVisibleActions = difference(macCapabilityActions, macHiddenActions);
assertSubset(macVisibleActions, macCommandActions, "visible macOS action capabilities", "macOS CommandRegistry");

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

function swiftCapabilityActionsWithState(source, state) {
  const lines = source.split("\n");
  const actions = [];
  let currentAction = null;

  for (const line of lines) {
    const action = line.match(/^\s*"([^"]+)": \[/);
    if (action) {
      currentAction = action[1];
      continue;
    }
    const stateLine = line.match(/^\s*"state": "([^"]+)"/);
    if (currentAction && stateLine) {
      if (stateLine[1] === state) {
        actions.push(currentAction);
      }
      currentAction = null;
    }
  }

  return [...new Set(actions)].sort();
}

function assertNoRawShellDesktopAction(actions, label) {
  if (actions.includes("raw-shell")) {
    fail(`${label} includes raw shell-command action, which is outside Desktop Actions.`);
  }
}

function assertSubset(subset, superset, subsetLabel, supersetLabel) {
  const missing = difference(subset, superset);
  if (missing.length > 0) {
    fail(`${supersetLabel} is missing ${subsetLabel}: ${missing.join(", ")}`);
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
