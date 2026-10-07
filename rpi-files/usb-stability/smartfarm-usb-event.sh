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

# pm2 가 준비됐나.
#
# ⚠ pm2 CLI 는 데몬이 없으면 **자기가 데몬을 띄운다** (`pm2 jlist` 도 예외가 아니다).
#   2026-10-07 11:31 부팅: udev 콜드플러그로 이 유닛이 pm2-lhk 보다 1초 먼저 떴고,
#   여기서 부른 `pm2 jlist` 의 데몬과 pm2-lhk 의 `pm2 resurrect` 데몬이 같은 ~/.pm2 소켓을
#   두고 충돌 → 둘 다 영원히 대기 → 전체 기동 5분 공백. (11:12 부팅도 같은 경주, 운 좋게 통과)
#   → pm2 CLI 를 부르기 전에 반드시 systemd 에게 먼저 묻는다. 데몬은 pm2-lhk 만 띄운다.
pm2_ready() {
    systemctl is-active --quiet pm2-lhk || return 1
    /usr/bin/pm2 jlist 2>/dev/null | grep -q '"name":"node-red"'
}
wait_for_pm2() {
    local tries=0
    while [ $tries -lt 36 ]; do          # 5초 × 36 = 3분
        pm2_ready && return 0
        tries=$((tries + 1))
        sleep 5
    done
    return 1
}

# node-red 가 뜬 지 몇 초 됐나 (모르면 큰 값).
nodered_age_sec() {
    /usr/bin/pm2 jlist 2>/dev/null | python3 -c '
import json, sys, time
for p in json.load(sys.stdin):
    if p["name"] == "node-red":
        print(int(time.time() - p["pm2_env"].get("pm_uptime", 0) / 1000)); break
else:
    print(999999)' 2>/dev/null || echo 999999
}

# USB 가 다시 인식되면 Node-RED 가 쥐고 있던 죽은 시리얼 핸들을 버리게 한다.
# 재시작하지 않으면 Modbus 노드가 영원히 응답을 기다리며 멈춘다(hang) — 실측 확인됨.
restart_nodered() {
    if ! wait_for_pm2; then
        log "pm2 가 아직 없다 — 부팅 중으로 보고 재시작을 건너뛴다 (pm2 가 node-red 를 띄운다)"
        return 0
    fi
    # 부팅 때는 유닛이 pm2-lhk 뒤에 서므로(After=) 여기 오면 node-red 가 방금 떴다.
    # 방금 뜬 node-red 는 죽은 핸들을 쥐고 있을 수 없다 — 재시작하면 부팅마다 두 번 뜬다.
    local age; age="$(nodered_age_sec)"
    if [ "$age" -lt 120 ] 2>/dev/null; then
        log "node-red 가 ${age}초 전에 떴다 — 새 핸들이므로 재시작을 건너뛴다"
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
