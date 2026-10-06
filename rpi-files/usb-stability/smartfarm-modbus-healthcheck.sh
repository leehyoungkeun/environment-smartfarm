#!/bin/bash
# SmartFarm Modbus 헬스체크 (2026-10-06 전면 개정) — lhk crontab, 매분
#
# 예전 결함: HTTP 응답 여부만 봤다. 2026-10-06 에 Node-RED 는 200 을 돌려주면서
#   Modbus 루프만 얼어붙어 **4시간 30분** 멈춰 있었고(워치독 정지 14,518초),
#   이 스크립트는 "정상"으로 판정했다. 지표는 있는데 아무도 행동하지 않았다.
#
# 이제 보는 것:
#   1) HTTP 가 안 되면            → hang 후보 (예전과 같음)
#   2) HTTP 200 인데 lastCheck 가 STALE_SEC 보다 낡았으면 → hang 후보  ★새로
#      (= 응답은 하는데 안쪽 점검 루프가 멈춘 상태)
#
# 일부러 구분한 것:
#   버스가 물리적으로 끊긴 경우(선 빠짐·장치 없음)는 healthy:false 지만 lastCheck 는
#   계속 갱신된다 → hang 이 아니다 → 재시작하지 않는다. 재시작해도 안 고쳐지는 것을
#   반복해서 흔들지 않기 위해서다.
set -u

PING_URL="http://127.0.0.1:1880/api/local/modbus/ping"   # localhost 금지(::1 로 풀린다)
STATE_FILE="/tmp/smartfarm-modbus-fail-count"
LAST_RESTART="/tmp/smartfarm-modbus-last-restart"
LOG="/home/lhk/smartfarm/logs/modbus-healthcheck.log"
BACKEND="https://api.smartgreen.kr/internal/farm-event"   # /api/internal 은 404 (루트 마운트)
THRESHOLD=3            # 연속 3분
STALE_SEC=300          # 점검이 5분 넘게 안 돌면 얼어붙은 것으로 본다
COOLDOWN_SEC=900       # 재시작은 15분에 한 번까지

FARM_ID="$(cat /home/lhk/smartfarm/.farm-id 2>/dev/null || true)"; [ -n "$FARM_ID" ] || FARM_ID=farm_0001
API_KEY="$(cat /home/lhk/smartfarm/.sensor-api-key 2>/dev/null || true)"
[ -n "$API_KEY" ] || API_KEY="$(grep -E '^SENSOR_API_KEY=' /home/lhk/smartfarm/.env 2>/dev/null | cut -d= -f2- || true)"
[ -n "$API_KEY" ] || API_KEY="smartfarm-sensor-key"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { echo "[$(date -Iseconds)] $*" >> "$LOG" 2>/dev/null || true; }

notify() {   # 배경(&) 없이 — 자식을 남기지 않는다
    curl -s --max-time 5 -o /dev/null -X POST "$BACKEND" \
        -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
        -d "{\"farmId\":\"$FARM_ID\",\"eventType\":\"$1\",\"severity\":\"$2\",\"message\":\"$3\",\"payload\":{\"host\":\"$(hostname)\"}}" \
        || log "백엔드 알림 실패 (무시)"
}

BODY="$(curl -s --max-time 8 -w '\n%{http_code}' "$PING_URL" 2>/dev/null || true)"
HTTP_CODE="$(printf '%s' "$BODY" | tail -1)"
JSON="$(printf '%s' "$BODY" | sed '$d')"
[ -n "$HTTP_CODE" ] || HTTP_CODE=000

REASON=""
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "503" ]; then
    REASON="HTTP $HTTP_CODE"
else
    AGE="$(printf '%s' "$JSON" | python3 -c "
import sys, json, time, datetime
try:
    d = json.load(sys.stdin)
    t = d.get('lastCheck')
    if not t: print(-1); raise SystemExit
    ts = datetime.datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp()
    print(int(time.time() - ts))
except Exception:
    print(-1)
" 2>/dev/null || echo -1)"
    if [ "$AGE" -gt "$STALE_SEC" ] 2>/dev/null; then
        REASON="점검 루프 정지 ${AGE}초"
    fi
fi

if [ -z "$REASON" ]; then
    prev="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
    [ "$prev" -gt 0 ] 2>/dev/null && log "회복 (이전 $prev 회 hang)"
    rm -f "$STATE_FILE"
    exit 0
fi

COUNT="$(cat "$STATE_FILE" 2>/dev/null || echo 0)"
COUNT=$((COUNT + 1))
echo "$COUNT" > "$STATE_FILE"
log "hang 의심 ($COUNT/$THRESHOLD) — $REASON"
[ "$COUNT" -ge "$THRESHOLD" ] || exit 0

NOW="$(date +%s)"
LAST="$(cat "$LAST_RESTART" 2>/dev/null || echo 0)"
if [ $((NOW - LAST)) -lt "$COOLDOWN_SEC" ]; then
    log "쿨다운 중 ($(( (COOLDOWN_SEC - (NOW - LAST)) / 60 ))분 남음) — 재시작 보류"
    exit 0
fi

log "임계치 도달 → Node-RED 재시작 ($REASON)"
echo "$NOW" > "$LAST_RESTART"
if timeout 120 /usr/bin/pm2 restart node-red >> "$LOG" 2>&1; then
    log "재시작 완료"
    notify "NODERED_HANG" "CRITICAL" "Modbus 점검 ${COUNT}회 실패($REASON) — Node-RED 자동 재시작"
else
    log "재시작 실패 — pm2 가드에 맡긴다"
    notify "NODERED_HANG" "CRITICAL" "Modbus hang($REASON) 재시작 실패 — pm2 응답 없음"
fi
rm -f "$STATE_FILE"
exit 0
