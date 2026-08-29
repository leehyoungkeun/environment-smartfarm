#!/bin/bash
# /usr/local/bin/smartfarm-modbus-healthcheck.sh
# crontab: */1 * * * * lhk /usr/local/bin/smartfarm-modbus-healthcheck.sh
#
# Node-RED Modbus 헬스체크. 3회 연속 실패 시 PM2 restart.
# Node-RED hang 상태(프로세스는 살아있는데 응답 없음) 자동 복구.

set -u

PING_URL="http://localhost:1880/api/local/modbus/ping"
STATE_FILE="/tmp/smartfarm-modbus-fail-count"
LOG="/home/lhk/smartfarm/logs/modbus-healthcheck.log"
FARM_ID_FILE="/home/lhk/smartfarm/.farm-id"
FARM_ID="$(cat "$FARM_ID_FILE" 2>/dev/null || echo farm_0001)"
BACKEND="https://api.smartgreen.kr/api/internal/farm-event"
API_KEY="$(cat /home/lhk/smartfarm/.sensor-api-key 2>/dev/null || grep -E '^SENSOR_API_KEY=' /home/lhk/smartfarm/.env 2>/dev/null | cut -d= -f2-)"
THRESHOLD=3

mkdir -p "$(dirname "$LOG")"

log() {
    echo "[$(date -Iseconds)] $*" >> "$LOG"
}

# 헬스체크 (3초 timeout)
# 이 스크립트의 목적: "Node-RED 프로세스 hang/down 감지" — Modbus 자체 장애가 아님.
# 200 = healthy, 503 = unhealthy(워치독이 모듈 장애 감지) 둘 다 Node-RED 응답이므로 정상.
# 000(connection refused), 5xx 게이트웨이 류만 hang 으로 카운트.
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$PING_URL" || echo 000)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "503" ]; then
    # Node-RED 응답 있음 (200=healthy, 503=unhealthy but alive) — 카운터 리셋
    if [ -f "$STATE_FILE" ]; then
        prev=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
        if [ "$prev" -gt 0 ]; then
            log "헬스체크 회복 (이전 $prev 회 hang)"
        fi
        rm -f "$STATE_FILE"
    fi
    exit 0
fi

# Node-RED hang/down — 카운터 증가
COUNT=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$STATE_FILE"
log "Node-RED hang ($COUNT/$THRESHOLD) — HTTP $HTTP_CODE"

if [ "$COUNT" -ge "$THRESHOLD" ]; then
    log "임계치 도달 → Node-RED PM2 restart"
    /usr/bin/pm2 restart node-red >> "$LOG" 2>&1

    # 백엔드 알림 (비동기)
    (
        curl -s --max-time 5 -X POST "$BACKEND" \
            -H "Content-Type: application/json" \
            -H "x-api-key: $API_KEY" \
            -d "{\"farmId\":\"$FARM_ID\",\"eventType\":\"NODERED_HANG\",\"severity\":\"CRITICAL\",\"message\":\"Modbus 헬스체크 ${COUNT}회 실패 — Node-RED 자동 재시작\",\"payload\":{\"failCount\":$COUNT,\"httpCode\":$HTTP_CODE}}" \
            >> "$LOG" 2>&1
        echo "" >> "$LOG"
    ) &

    # 카운터 리셋 (재시작 후 새로 카운트)
    rm -f "$STATE_FILE"
fi

exit 0
