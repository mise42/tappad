#!/usr/bin/env bash
set -euo pipefail

service_path="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/tappad-host.service"

omarchy plugin remove io.miselabs.tappad --yes || true
systemctl --user disable --now tappad-host.service || true
rm -f "$service_path" "$HOME/.local/bin/tappad-host"
systemctl --user daemon-reload

printf '%s\n' "TapPad removed. Local pairing settings remain in ${XDG_CONFIG_HOME:-$HOME/.config}/tappad."
