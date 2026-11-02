#!/usr/bin/env bash
# Keep the CV-scan host worker running on a macOS machine with the Claude Code CLI logged in.
# Installs a per-user launchd agent that starts at login and restarts the worker if it exits.
#
#   apps/api/scripts/worker-service.sh install    # install + start
#   apps/api/scripts/worker-service.sh status     # is it running? last log lines
#   apps/api/scripts/worker-service.sh uninstall  # stop + remove
#
# The worker reads DATABASE_URL from the repo-root .env.local (UJC_ENV=development). It needs only
# outbound access to Postgres: no port is opened.
set -euo pipefail

LABEL="dev.job-seeking.worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/job-seeking"
UV="$(command -v uv || true)"
CLAUDE="$(command -v claude || true)"

case "${1:-}" in
  install)
    [[ "$(uname)" == "Darwin" ]] || { echo "macOS only; on Linux use a systemd user service running: uv run python -m ujc_api.worker" >&2; exit 1; }
    [[ -n "$UV" ]] || { echo "uv not found on PATH" >&2; exit 1; }
    [[ -n "$CLAUDE" ]] || { echo "claude CLI not found on PATH (install Claude Code and log in first)" >&2; exit 1; }
    [[ -f "$API_DIR/../../.env.local" ]] || { echo "repo-root .env.local with DATABASE_URL is missing" >&2; exit 1; }
    mkdir -p "$LOG_DIR" "$(dirname "$PLIST")"
    (cd "$API_DIR" && "$UV" sync -q)
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$API_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string><string>-u</string><string>DATABASE_URL</string>
    <string>$UV</string><string>run</string><string>python</string><string>-m</string><string>ujc_api.worker</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>UJC_ENV</key><string>development</string>
    <key>PATH</key><string>$(dirname "$CLAUDE"):$(dirname "$UV"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/worker.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/worker.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed and started: $LABEL (logs: $LOG_DIR/worker.log)"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state =|pid =" || echo "not installed"
    tail -n 5 "$LOG_DIR/worker.log" 2>/dev/null || true
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
