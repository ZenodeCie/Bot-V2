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

HOST_STOPPED=0
UPDATE_OK=0

cleanup() {
  local status=$?
  rm -f "$LOCK_FILE"
  # Si la mise à jour échoue après l'arrêt du host (git pull, build…), on le relance avec le code actuel
  # pour ne pas laisser la VM sans agent.
  if [[ "$HOST_STOPPED" == "1" && "$UPDATE_OK" != "1" ]]; then
    echo "[vm-update] $(date -Iseconds) failed:exit=$status — restarting host agent"
    (cd "$REPO_ROOT" && pm2 start ecosystem.config.cjs) || echo "[vm-update] $(date -Iseconds) failed:pm2_restart"
  fi
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
  HOST_STOPPED=1
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
UPDATE_OK=1

notify "success"
