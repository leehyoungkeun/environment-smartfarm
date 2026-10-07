#!/bin/bash
# SmartFarm USB-485 이벤트 처리 (2026-10-06 전면 수정)
#
# 호출 경로:
#   add    → udev 가 smartfarm-usb-recover@<kernel>.service 를 기동 → 이 스크립트 (lhk 권한)
#   remove → udev RUN+= 가 직접 (root 권한). 짧은 알림 한 번만.
#
# 왜 바뀌었나:
#   예전에는 add 에서 `( sleep 3; sudo -u lhk -i pm2 restart node-red ) &` 를 띄웠다.
#   udev 의 RUN+= 는 systemd-udevd 의 cgroup 안에서 돌고, 이벤트가 끝나면 udev 가 그
#   cgroup 을 정리한다. 배경으로 띄운 pm2 가 거기 묶여 **pm2 데몬째로** 죽었고,
#   node-red 뿐 아니라 7개 프로세스가 전부 사라졌다 (2026-10-06 저녁 4회 발생).
#   → 복구는 systemd 유닛이 맡고, 이 스크립트는 **배경 실행을 하지 않는다**.
#
# 원칙: 자식 프로세스를 남기지 않는다. 모든 외부 호출에 타임아웃을 건다.
set -u

ACTION="${1:-unknown}"
KERNEL="${2:-}"
LOG="/home/lhk/smartfarm/logs/usb-events.log"
FARM_ID_FILE="/home/lhk/smartfarm/.farm-id"
BACKEND="https://api.smartgreen.kr/internal/farm-event"

FARM_ID="$(cat "$FARM_ID_FILE" 2>/dev/null || true)"
[ -n "$FARM_ID" ] || FARM_ID="farm_0001"

# grep 이 못 찾아도 cut 이 성공해 파이프라인은 0 을 돌려준다 — `grep|cut || echo` 폴백은
# 발동하지 않는다. 값이 비었는지로 판단한다 (지난 사고와 같은 함정).
API_KEY="$(grep -E '^SENSOR_API_KEY=' /home/lhk/smartfarm/.env 2>/dev/null | cut -d= -f2- || true)"
[ -n "$API_KEY" ] || API_KEY="smartfarm-sensor-key"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

log() {
    echo "[$(date -Iseconds)] [$ACTION] $KERNEL — $*" >> "$LOG" 2>/dev/null || true
}

# 배경(&) 없이, 짧은 타임아웃으로. udev 에서 불려도 자식을 남기지 않는다.
post_event() {
    curl -s --max-time 5 -o /dev/null -X POST "$BACKEND" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $API_KEY" \
        -d "{\"farmId\":\"$FARM_ID\",\"eventType\":\"$1\",\"severity\":\"$2\",\"message\":\"$3\",\"payload\":{\"kernel\":\"$KERNEL\",\"host\":\"$(hostname)\"}}" \
        || log "백엔드 알림 실패 (무시하고 계속)"
}

# pm2 가 준비됐나 — 부팅 중에는 pm2-lhk 가 resurrect 중이라 아직 없다 (2026-10-07 실측 3분 9초).
# 그때 재시작을 시도하면 실패하고 「NODERED_RESTART_FAILED · 경고」가 뜬다.
# 정상 기동 과정인데 경보가 뜨면 진짜 경보가 묻힌다 — 기다렸다가, 그래도 없으면 **건너뛴다**
# (pm2 가 어차피 node-red 를 띄우므로 우리가 할 일이 없다).
wait_for_pm2() {
    local tries=0
    while [ $tries -lt 36 ]; do          # 5초 × 36 = 3분
        if /usr/bin/pm2 jlist 2>/dev/null | grep -q '"name":"node-red"'; then return 0; fi
        tries=$((tries + 1))
        sleep 5
    done
    return 1
}

# USB 가 다시 인식되면 Node-RED 가 쥐고 있던 죽은 시리얼 핸들을 버리게 한다.
# 재시작하지 않으면 Modbus 노드가 영원히 응답을 기다리며 멈춘다(hang) — 실측 확인됨.
restart_nodered() {
    if ! wait_for_pm2; then
        log "pm2 가 아직 없다 — 부팅 중으로 보고 재시작을 건너뛴다 (pm2 가 node-red 를 띄운다)"
        return 0
    fi
    log "Node-RED 재시작 시작"
    if timeout 90 /usr/bin/pm2 restart node-red >> "$LOG" 2>&1; then
        log "Node-RED 재시작 완료"
        post_event "NODERED_RESTARTED" "INFO" "USB 재연결 후 Node-RED 자동 재시작"
    else
        log "Node-RED 재시작 실패 (pm2 응답 없음)"
        post_event "NODERED_RESTART_FAILED" "WARNING" "USB 재연결 후 Node-RED 재시작 실패"
    fi
}

case "$ACTION" in
    add)
        log "USB add → 자동 복구 시작 (uid=$(id -u))"
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
