#!/usr/bin/env bash
set -euo pipefail

package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
plugin_dir="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy/plugins/io.miselabs.tappad"
service_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

install -Dm755 "$package_dir/tappad-host" "$HOME/.local/bin/tappad-host"
install -Dm644 "$package_dir/tappad-host.service" "$service_dir/tappad-host.service"
install -d "$plugin_dir"
cp -R "$package_dir/omarchy-plugin/." "$plugin_dir/"

systemctl --user daemon-reload
systemctl --user enable --now tappad-host.service
omarchy-shell shell rescanPlugins
omarchy plugin enable io.miselabs.tappad

printf '%s\n' "TapPad installed. Add the TapPad widget to your Omarchy bar if it is not already visible."
