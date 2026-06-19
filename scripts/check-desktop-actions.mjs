import { readFileSync } from "node:fs";

const files = {
  frontend: "static/index.html",
  linuxCommands: "src/commands.rs",
  macCommands: "macos/TapPad/Sources/TapPad/Commands/CommandRegistry.swift",
  macServer: "macos/TapPad/Sources/TapPad/Server/HttpWebSocketServer.swift",
  windowsHostSurface: "windows/TapPad/src-tauri/src/host_surface.rs",
  windowsServer: "windows/TapPad/src-tauri/src/server.rs",
};

const text = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

const frontendActions = uniqueMatches(text.frontend, /data-cmd="([^"]+)"/g);
const linuxActions = uniqueMatches(text.linuxCommands, /commands\.insert\(\s*"([^"]+)"/g);
const macCommandActions = uniqueMatches(text.macCommands, /"([^"]+)": \[/g);
const macCapabilityActions = uniqueMatches(text.macServer, /"([^"]+)": \[\s*"state":/g);
const windowsCapabilityActions = uniqueMatches(text.windowsHostSurface, /\("([^"]+)", capability\("/g);
const windowsHandledActions = rustMatchArmActions(text.windowsServer);
const windowsHiddenActions = capabilityActionsWithState(text.windowsHostSurface, "hidden");
const macHiddenActions = swiftCapabilityActionsWithState(text.macServer, "hidden");

assertNoExecDesktopAction(frontendActions, "frontend");
assertNoExecDesktopAction(linuxActions, "Linux registry");
assertNoExecDesktopAction(macCommandActions, "macOS registry");
assertNoExecDesktopAction(macCapabilityActions, "macOS capabilities");
assertNoExecDesktopAction(windowsCapabilityActions, "Windows capabilities");

assertSubset(frontendActions, linuxActions, "frontend data-cmd", "Linux CommandRegistry");
assertSameSet(frontendActions, windowsCapabilityActions, "frontend data-cmd", "Windows action capabilities");
assertSameSet(frontendActions, macCapabilityActions, "frontend data-cmd", "macOS action capabilities");
assertSubset(macCommandActions, macCapabilityActions, "macOS CommandRegistry", "macOS action capabilities");

const macVisibleActions = difference(macCapabilityActions, macHiddenActions);
assertSubset(macVisibleActions, macCommandActions, "visible macOS action capabilities", "macOS CommandRegistry");

const windowsVisibleActions = difference(windowsCapabilityActions, windowsHiddenActions);
assertSubset(windowsVisibleActions, windowsHandledActions, "visible Windows action capabilities", "Windows run_named_action");

console.log(`Desktop Action check passed for ${frontendActions.length} frontend actions.`);

function uniqueMatches(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

function capabilityActionsWithState(source, state) {
  return uniqueMatches(source, new RegExp(`\\("([^"]+)", capability\\("${state}"`, "g"));
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

function rustMatchArmActions(source) {
  const actions = [];
  for (const match of source.matchAll(/((?:"[^"]+"\s*(?:\|\s*)?)+)=>/g)) {
    actions.push(...[...match[1].matchAll(/"([^"]+)"/g)].map((action) => action[1]));
  }
  return [...new Set(actions)].sort();
}

function assertNoExecDesktopAction(actions, label) {
  if (actions.includes("exec")) {
    fail(`${label} includes exec, but exec is a raw escape hatch outside Desktop Actions.`);
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
