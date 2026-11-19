#!/usr/bin/env bash
# Runs the collector once a day on this host, also while the dashboard stays closed, so Claude Code's
# transcripts (deleted after 30 days) are read before they expire.
#
#   scripts/schedule-collect.sh install [HH:MM]   set up the daily run (default 12:00, local time); rerun to change it
#   scripts/schedule-collect.sh remove            take it out again
#   scripts/schedule-collect.sh status            is it set up, how did the last runs go
#   scripts/schedule-collect.sh print [HH:MM]     show the files install would write; changes nothing
#
# macOS: a LaunchAgent (~/Library/LaunchAgents/local.fleet.collect.plist). It runs at the set time,
# after waking if the Mac slept through it, and at every login.
# Linux: a systemd user timer (~/.config/systemd/user/fleet-collect.{service,timer}). Persistent,
# so a run missed while the server was down follows at boot.
#
# Both run `node dashboard/collect/index.ts` in this folder with the node and PATH of the shell that
# installed them (the collector calls git, gh and amp). Rerun install after switching Node versions.
# Output goes to .cache/collect.log. A run while the dashboard collects stops at once (lock) and is fine.
# The job writes stats/<host>/ only; committing and pushing the stats stays with you.
set -euo pipefail

FLEET_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
COLLECTOR="$FLEET_DIR/dashboard/collect/index.ts"
LOG="$FLEET_DIR/.cache/collect.log"
LABEL="local.fleet.collect"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT="fleet-collect"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '5,8p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# --- What to run ----------------------------------------------------------------

# The node this shell uses, resolved past shims and per-shell links (nvm, fnm, mise), so the job
# finds it without a login shell. Needs type stripping (22.18+).
find_node() {
  local node
  node="$(command -v node)" || die "node not found in PATH"
  node="$(cd -P "$(dirname "$node")" && pwd -P)/$(basename "$node")"
  "$node" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' \
    || die "node $("$node" -v) is too old; the collector needs 22.18 or newer"
  printf '%s' "$node"
}

# HH:MM → "H M", checked.
parse_time() {
  local at="${1:-12:00}"
  [[ "$at" =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]] || die "time must be HH:MM (24 h), got '$at'"
  printf '%d %d' "$((10#${BASH_REMATCH[1]}))" "$((10#${BASH_REMATCH[2]}))"
}

# --- macOS: launchd ---------------------------------------------------------------

xml() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }

plist() {
  local node="$1" hour="$2" minute="$3"
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by fleet/scripts/schedule-collect.sh; remove with: scripts/schedule-collect.sh remove -->
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$node")</string>
    <string>$(xml "$COLLECTOR")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$FLEET_DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$(dirname "$node"):$PATH")</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$hour</integer>
    <key>Minute</key><integer>$minute</integer>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
}

mac_install() {
  local node="$1" hour="$2" minute="$3" domain
  domain="gui/$(id -u)"
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  plist "$node" "$hour" "$minute" >"$PLIST"
  plutil -lint -s "$PLIST" || die "the written plist is invalid: $PLIST"
  launchctl bootout "$domain/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$domain" "$PLIST"
  say "Installed: collects every day at $(printf '%02d:%02d' "$hour" "$minute"), after waking if the Mac slept, and at login."
  say "It runs once right now; check in a minute with: scripts/schedule-collect.sh status"
  say "macOS may show \"Background Items Added\" for node; that is this job."
}

mac_remove() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  if [ -f "$PLIST" ]; then rm "$PLIST" && say "Removed $PLIST"; else say "Not installed."; fi
}

mac_status() {
  [ -f "$PLIST" ] || { say "Not installed. Set up with: scripts/schedule-collect.sh install"; return; }
  say "Installed: $PLIST"
  launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E '^[[:space:]]*(state|runs|last exit code) =' | sed 's/^[[:space:]]*/  /' \
    || say "  not loaded; run install again"
}

# --- Linux: systemd user timer ------------------------------------------------------

# systemd expands % in unit files; paths keep theirs as %%. Values with spaces go in quotes.
unit_escape() { local s="${1//\%/%%}"; printf '%s' "$s"; }

service_unit() {
  local node="$1"
  cat <<EOF
# Written by fleet/scripts/schedule-collect.sh; remove with: scripts/schedule-collect.sh remove
[Unit]
Description=fleet: collect agent usage into stats/

[Service]
Type=oneshot
WorkingDirectory=$(unit_escape "$FLEET_DIR")
Environment="PATH=$(unit_escape "$(dirname "$node"):$PATH")"
ExecStart="$(unit_escape "$node")" "$(unit_escape "$COLLECTOR")"
StandardOutput=append:$(unit_escape "$LOG")
StandardError=append:$(unit_escape "$LOG")
Nice=10
EOF
}

timer_unit() {
  local hour="$1" minute="$2"
  cat <<EOF
# Written by fleet/scripts/schedule-collect.sh; remove with: scripts/schedule-collect.sh remove
[Unit]
Description=fleet: collect once a day

[Timer]
OnCalendar=*-*-* $(printf '%02d:%02d' "$hour" "$minute"):00
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
EOF
}

linux_check() {
  local node="$1" hour="$2" minute="$3"
  command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1 \
    || die "no systemd user session here. Use cron instead (crontab -e), one line:
  $minute $hour * * * cd '$FLEET_DIR' && PATH='$(dirname "$node"):\$PATH' '$node' dashboard/collect/index.ts >> '$LOG' 2>&1"
}

linux_install() {
  local node="$1" hour="$2" minute="$3"
  linux_check "$node" "$hour" "$minute"
  mkdir -p "$UNIT_DIR" "$(dirname "$LOG")"
  service_unit "$node" >"$UNIT_DIR/$UNIT.service"
  timer_unit "$hour" "$minute" >"$UNIT_DIR/$UNIT.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT.timer"
  say "Installed: collects every day at $(printf '%02d:%02d' "$hour" "$minute") (up to 5 min later), and at boot if a run was missed."
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || echo no)" != yes ]; then
    say "Lingering is off, so the timer runs only while you are logged in. Turn it on once:"
    say "  sudo loginctl enable-linger \"\$(id -un)\""
  fi
  say "Run it once now to check: systemctl --user start $UNIT.service && scripts/schedule-collect.sh status"
}

linux_remove() {
  if [ -f "$UNIT_DIR/$UNIT.timer" ] || [ -f "$UNIT_DIR/$UNIT.service" ]; then
    systemctl --user disable --now "$UNIT.timer" 2>/dev/null || true
    rm -f "$UNIT_DIR/$UNIT.timer" "$UNIT_DIR/$UNIT.service"
    systemctl --user daemon-reload 2>/dev/null || true
    say "Removed $UNIT.timer and $UNIT.service"
  else
    say "Not installed."
  fi
}

linux_status() {
  [ -f "$UNIT_DIR/$UNIT.timer" ] || { say "Not installed. Set up with: scripts/schedule-collect.sh install"; return; }
  say "Installed: $UNIT_DIR/$UNIT.timer"
  systemctl --user list-timers "$UNIT.timer" --no-pager 2>/dev/null | sed 's/^/  /' || true
  systemctl --user show "$UNIT.service" -p Result -p ExecMainStatus 2>/dev/null | sed 's/^/  /' || true
}

# --- Both -----------------------------------------------------------------------------

last_runs() {
  local last="$FLEET_DIR/.cache/last-collect.json"
  if [ -f "$last" ]; then
    say "Last collect (any trigger):"
    node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("  "+l.at+(l.ok?" ok":" failed: "+l.error))' "$last" 2>/dev/null \
      || sed 's/^/  /' "$last"
  fi
  if [ -f "$LOG" ]; then
    say "Last lines of $LOG:"
    tail -n 8 "$LOG" | sed 's/^/  /'
  fi
}

case "$(uname -s)" in
  Darwin) os=mac ;;
  Linux) os=linux ;;
  *) die "only macOS (launchd) and Linux (systemd) are supported" ;;
esac

cmd="${1:-}"
case "$cmd" in
  install)
    hm="$(parse_time "${2:-}")"; read -r hour minute <<<"$hm"
    node="$(find_node)"
    "${os}_install" "$node" "$hour" "$minute"
    ;;
  remove) "${os}_remove" ;;
  status) "${os}_status"; last_runs ;;
  print)
    hm="$(parse_time "${2:-}")"; read -r hour minute <<<"$hm"
    node="$(find_node)"
    if [ "$os" = mac ]; then
      say "# $PLIST"; plist "$node" "$hour" "$minute"
    else
      say "# $UNIT_DIR/$UNIT.service"; service_unit "$node"
      say; say "# $UNIT_DIR/$UNIT.timer"; timer_unit "$hour" "$minute"
    fi
    ;;
  -h | --help | help) usage ;;
  *) usage 1 ;;
esac
