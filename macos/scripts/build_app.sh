#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PACKAGE_DIR/.." && pwd)"
DIST_DIR="$PACKAGE_DIR/.dist"
APP_DIR="$DIST_DIR/TapPad.app"
ZIP_PATH="$DIST_DIR/TapPad-mac-beta.zip"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_EXECUTABLE="$MACOS_DIR/TapPad"

if pgrep -f "$APP_EXECUTABLE" >/dev/null; then
  echo "TapPad.app is running. Quit it before rebuilding: $APP_EXECUTABLE" >&2
  exit 1
fi

cd "$PACKAGE_DIR"
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$PACKAGE_DIR/Resources/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$BIN_DIR/TapPad" "$MACOS_DIR/TapPad"
chmod +x "$MACOS_DIR/TapPad"
cp -R "$REPO_ROOT/mobile" "$RESOURCES_DIR/mobile"

codesign --force --deep --sign - "$APP_DIR" >/dev/null
xattr -dr com.apple.quarantine "$APP_DIR" 2>/dev/null || true
xattr -dr com.apple.provenance "$APP_DIR" 2>/dev/null || true
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_DIR" "$ZIP_PATH"

echo "$APP_DIR"
echo "$ZIP_PATH"
