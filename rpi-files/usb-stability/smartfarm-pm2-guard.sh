#!/bin/bash
# SmartFarm pm2 감시·자동 복구 (2026-10-06)
#
# 왜: 2026-10-06 저녁, pm2 가 통째로 사라진 채 17분간 아무도 모르고 아무도 살리지 않았다.
#     제어기는 사람이 없어도 스스로 일어나야 한다.
#
# 무엇을 하나 (보수적으로 — 사람이 일부러 한 것은 건드리지 않는다):
#   1) pm2-lhk 서비스가 비활성/실패면  → systemctl restart
#   2) dump.pm2 에 있는 앱이 목록에서 **통째로 사라졌으면** → pm2 resurrect
#      (사람이 `pm2 stop X` 한 앱은 목록에 stopped 로 남으므로 건드리지 않는다)
#   3) 복구했으면 백엔드에 알린다 — 조용한 복구는 조용한 고장만큼 나쁘다
#   4) 목록이 멀쩡하고 dump 와 다르면 dump 를 갱신한다 (재부팅 때 빠지는 앱이 없게)
set -u

PM2=/usr/lib/node_modules/pm2/bin/pm2
PM2_HOME=/home/lhk/.pm2
DUMP="$PM2_HOME/dump.pm2"
LOG=/home/lhk/smartfarm/logs/pm2-guard.log
LOCK=/run/smartfarm-pm2-guard.lock
BACKEND="https://api.smartgreen.kr/internal/farm-event"

exec 9>"$LOCK" 2>/dev/null || true
flock -n 9 || exit 0          # 앞선 회차가 아직 돌고 있으면 건너뛴다

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
log() { echo "[$(date -Iseconds)] $*" >> "$LOG" 2>/dev/null || true; }

FARM_ID="$(cat /home/lhk/smartfarm/.farm-id 2>/dev/null || true)"; [ -n "$FARM_ID" ] || FARM_ID=farm_0001
API_KEY="$(grep -E '^SENSOR_API_KEY=' /home/lhk/smartfarm/.env 2>/dev/null | cut -d= -f2- || true)"
[ -n "$API_KEY" ] || API_KEY=smartfarm-sensor-key

notify() {
    curl -s --max-time 5 -o /dev/null -X POST "$BACKEND" \
        -H "Content-Type: application/json" -H "x-api-key: $API_KEY" \
        -d "{\"farmId\":\"$FARM_ID\",\"eventType\":\"$1\",\"severity\":\"$2\",\"message\":\"$3\",\"payload\":{\"host\":\"$(hostname)\"}}" \
        || log "백엔드 알림 실패 (무시)"
}

aspm2() { runuser -u lhk -- env PM2_HOME="$PM2_HOME" "$PM2" "$@"; }

# ── 1) 서비스가 살아 있나
if ! systemctl is-active --quiet pm2-lhk; then
    log "pm2-lhk 비활성($(systemctl is-active pm2-lhk)) → restart"
    systemctl reset-failed pm2-lhk 2>/dev/null || true
    systemctl restart pm2-lhk
    notify "PM2_SERVICE_RECOVERED" "WARNING" "pm2-lhk 비활성 감지 → 자동 재시작"
    exit 0
fi

# ── 2) dump 에 있는 앱이 목록에서 사라졌나
[ -s "$DUMP" ] || exit 0
WANT="$(python3 -c "import json,sys; print(' '.join(sorted(a['name'] for a in json.load(open('$DUMP')))))" 2>/dev/null || true)"
[ -n "$WANT" ] || exit 0

LIST="$(aspm2 jlist 2>/dev/null || true)"
HAVE="$(printf '%s' "$LIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(sorted(x['name'] for x in d)))" 2>/dev/null || true)"

MISSING=""
for n in $WANT; do
    case " $HAVE " in *" $n "*) ;; *) MISSING="$MISSING $n" ;; esac
done

if [ -n "$MISSING" ]; then
    log "목록에서 사라진 앱:$MISSING → resurrect"
    aspm2 resurrect >> "$LOG" 2>&1
    notify "PM2_APPS_RECOVERED" "WARNING" "사라진 프로세스 자동 복구:$MISSING"
    exit 0
fi

# ── 3) 전부 online 인데 dump 와 구성이 다르면 dump 를 맞춰 둔다 (재부팅 누락 방지)
OFFLINE="$(printf '%s' "$LIST" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for x in d if x['pm2_env']['status']!='online'))" 2>/dev/null || echo 1)"
if [ "$OFFLINE" = "0" ] && [ "$HAVE" != "$WANT" ]; then
    log "구성 변경 감지 (dump='$WANT' → 실제='$HAVE') → pm2 save"
    aspm2 save >> "$LOG" 2>&1
fi
exit 0
