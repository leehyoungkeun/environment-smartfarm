#!/bin/bash
# /usr/local/bin/smartfarm-usb-event.sh
# udev에서 USB-485 add/remove 이벤트 발생 시 호출
#
# add 인자:    재연결 시 → 3초 대기 후 pm2 restart node-red + 백엔드 INFO 알림
# remove 인자: 분리 시   → 백엔드 WARNING 알림
#
# 비동기 실행 (udev RUN 블로킹 방지)

set -u

ACTION="${1:-unknown}"
KERNEL="${2:-}"
LOG="/home/lhk/smartfarm/logs/usb-events.log"
FARM_ID_FILE="/home/lhk/smartfarm/.farm-id"
FARM_ID="$(cat "$FARM_ID_FILE" 2>/dev/null || echo farm_0001)"
BACKEND="https://api.smartgreen.kr/api/internal/farm-event"
API_KEY="$(grep -E '^SENSOR_API_KEY=' /home/lhk/smartfarm/.env 2>/dev/null | cut -d= -f2- || echo smartfarm-sensor-key)"

mkdir -p "$(dirname "$LOG")"

log() {
    echo "[$(date -Iseconds)] [$ACTION] $KERNEL — $*" >> "$LOG"
}

post_event() {
    local event_type="$1"
    local severity="$2"
    local message="$3"
    # 비동기 — 네트워크 timeout으로 udev 블로킹 안 되게
    (
        curl -s --max-time 5 -X POST "$BACKEND" \
            -H "Content-Type: application/json" \
            -H "x-api-key: $API_KEY" \
            -d "{\"farmId\":\"$FARM_ID\",\"eventType\":\"$event_type\",\"severity\":\"$severity\",\"message\":\"$message\",\"payload\":{\"kernel\":\"$KERNEL\",\"host\":\"$(hostname)\"}}" \
            >> "$LOG" 2>&1
        echo "" >> "$LOG"
    ) &
}

restart_nodered() {
    # PM2 환경 보장
    export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
    export HOME="/home/lhk"
    # lhk 사용자로 pm2 restart 실행
    (
        sleep 3   # udev 처리 직후 USB가 안정화될 시간
        log "Node-RED 재시작 시작"
        sudo -u lhk -i /usr/bin/pm2 restart node-red >> "$LOG" 2>&1
        log "Node-RED 재시작 완료"
        post_event "NODERED_RESTARTED" "INFO" "USB 재연결 후 Node-RED 자동 재시작"
    ) &
}

case "$ACTION" in
    add)
        log "USB add → 자동 복구 시작"
        post_event "USB_RECONNECTED" "INFO" "USB-485 어댑터 재연결 ($KERNEL)"
        restart_nodered
        ;;
    remove)
        log "USB remove → 백엔드 알림"
        post_event "USB_DISCONNECT" "WARNING" "USB-485 어댑터 분리 감지 ($KERNEL)"
        ;;
    *)
        log "알 수 없는 액션"
        ;;
esac

exit 0
