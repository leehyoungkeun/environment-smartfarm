#!/bin/bash
# /usr/local/bin/smartfarm-restart-nodered.sh
# 워치독에서 호출 (Node-RED 자체 child_process.exec 으로)
# 비동기 — 호출자에게 빠른 반환

set -u

REASON="${1:-unknown}"
LOG="/home/lhk/smartfarm/logs/nodered-restart.log"

mkdir -p "$(dirname "$LOG")"
echo "[$(date -Iseconds)] 재시작 요청: $REASON" >> "$LOG"

# 백그라운드 실행 (호출자 즉시 반환)
(
    sleep 1
    /usr/bin/pm2 restart node-red >> "$LOG" 2>&1
    echo "[$(date -Iseconds)] 재시작 완료 ($REASON)" >> "$LOG"
) &

exit 0
