#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$REPO_ROOT/logs/vm-update.log"
LOCK_FILE="/tmp/vm-update.lock"
HOST_AGENT="zenode-vm-host"
MAX_LOG_BYTES=1048576

# Re-exec under a new session so we survive pm2 stop/delete of the host agent.
if [[ "${VM_UPDATE_DETACHED:-}" != "1" ]]; then
  export VM_UPDATE_DETACHED=1
  mkdir -p "$(dirname "$LOG_FILE")"
  if command -v setsid >/dev/null 2>&1; then
    exec setsid env VM_UPDATE_DETACHED=1 bash "$0"
  fi
  nohup env VM_UPDATE_DETACHED=1 bash "$0" >>"$LOG_FILE" 2>&1 &
  exit 0
fi

cleanup() {
  rm -f "$LOCK_FILE"
}

trap cleanup EXIT

cd "$REPO_ROOT"
mkdir -p "$(dirname "$LOG_FILE")"

rotate_log() {
  if [[ -f "$LOG_FILE" ]]; then
    local size
    size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [[ "$size" -gt "$MAX_LOG_BYTES" ]]; then
      mv -f "$LOG_FILE" "${LOG_FILE}.1"
    fi
  fi
}

rotate_log
exec >>"$LOG_FILE" 2>&1

notify() {
  echo "[vm-update] $(date -Iseconds) $1"
}

notify "running:started repo=$REPO_ROOT pid=$$"

notify "running:pm2_stop_host"
if pm2 describe "$HOST_AGENT" >/dev/null 2>&1; then
  pm2 stop "$HOST_AGENT" || true
  sleep 2
  pm2 delete "$HOST_AGENT" || true
else
  notify "skip:host_not_in_pm2"
fi

notify "running:git_pull"
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

notify "running:npm_build"
npm run build

notify "running:pm2_start"
pm2 start ecosystem.config.cjs

notify "success"
