#!/bin/bash
# 변이 검사 — "테스트가 통과한다" 가 아니라 "테스트가 진짜 잡는다" 를 확인한다.
#
# 오늘(2026-08-29) 실제로 났던 결함을 하나씩 되살려, 테스트가 실패하는지 본다.
# 실패하지 않으면 그 테스트는 아무것도 지키지 못하는 것이다.
#
# 사용: cd backend && bash test/mutation-check.sh
# 안전: 각 회차마다 원본을 임시 폴더에 백업하고 반드시 되돌린다. 끝나고 git status 로 확인할 것.

set -u
cd "$(dirname "$0")/.." || exit 1

BK=$(mktemp -d)
FILES=(src/app.js src/routes/devices.routes.js src/routes/sensors.js src/routes/config.routes.js src/routes/internal.routes.js src/routes/farms.routes.js src/schedulers/sensorThresholdAlert.js src/schedulers/offlineAlert.js src/models/Alert.js src/services/mqttClient.js src/services/diagnosisAgent.js src/routes/kakao.routes.js src/routes/device-positions.routes.js prisma/migration-device-positions.sql ../rpi-files/master/flows.json)
flat() { echo "$1" | tr '/.' '__'; }  # ../ 가 있어도 백업 디렉터리를 벗어나지 않게 평탄화
for f in "${FILES[@]}"; do cp "$f" "$BK/$(flat "$f")"; done
restore() { for f in "${FILES[@]}"; do cp "$BK/$(flat "$f")" "$f"; done; }
trap 'restore; rm -rf "$BK"' EXIT

probe() { # $1=설명 $2=파일 $3=원본 $4=치환
  python - "$2" "$3" "$4" <<'PY'
import io, sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8", newline="").read()
if s.count(a) == 0:
    sys.exit(2)
io.open(p, "w", encoding="utf-8", newline="").write(s.replace(a, b, 1))
PY
  if [ $? -eq 2 ]; then
    echo "  ⚠ $1 — 앵커 없음 (코드가 바뀌었다면 이 검사를 갱신할 것)"
    restore; return
  fi
  local fails
  fails=$(npm test 2>&1 | grep -E "^ℹ fail" | awk '{print $3}')
  if [ "${fails:-0}" -gt 0 ]; then
    echo "  ✅ $1 → 테스트 ${fails}개 실패 (잡음)"
  else
    echo "  ❌ $1 → 못 잡음 — 테스트를 보강할 것"
  fi
  restore
}

echo "━━ 변이 검사: 오늘 난 결함을 되살려 본다 ━━"

probe "N3 relay-status 인증 제거" src/app.js \
  'app.use("/api/relay-status", authenticate, enforceTenant, relayStatusRoutes);' \
  'app.use("/api/relay-status", relayStatusRoutes);'

probe "N3 테넌트 격리만 제거" src/app.js \
  'app.use("/api/device-positions", authenticate, enforceTenant, devicePositionsRoutes);' \
  'app.use("/api/device-positions", authenticate, devicePositionsRoutes);'

probe "B3 /metrics 터널 판정 제거" src/app.js \
  'if (viaTunnel || !METRICS_ALLOWED' \
  'if (!METRICS_ALLOWED'

probe "지표 SQL 컬럼 미한정 (오늘 15분 감시 정지)" src/app.js \
  'SELECT sd.farm_id, sd.house_id,' \
  'SELECT farm_id, house_id,'

probe "N2 setup 키를 항상 반환" src/routes/devices.routes.js \
  'apiKey: firstSetup ? farm.apiKey : undefined' \
  'apiKey: farm.apiKey'

probe "B4 시뮬레이션 경보 스킵 제거" src/routes/sensors.js \
  'if (reportedQuality !== "simulated")' \
  'if (true)'

probe "설정 저장 얕은 병합 회귀" src/routes/config.routes.js \
  '{ ...existingNested, ...req.body.settings }' \
  '{ ...req.body.settings }'

probe "device_positions DDL 손상 (새 서버 설치 불가)" prisma/migration-device-positions.sql \
  "CREATE TABLE IF NOT EXISTS device_positions" \
  "CREATE TABLE IF NOT EXISTS device_positions_broken"

probe "코드가 스키마에 없는 테이블을 쓴다" src/routes/farms.routes.js \
  "FROM sensor_data" \
  "FROM sensor_data_archive sd"

echo "━━ NR 자동화 엔진 변이 검사 (flows.json 실제 코드) ━━"

probe "② 같은 분 dedup 제거 (릴레이 중복 명령)" ../rpi-files/master/flows.json   'cleaned[minuteKey] = true;'   ';'

probe "② 시간 전용 규칙 스킵 제거 (④ 와 이중 실행)" ../rpi-files/master/flows.json   'if (timeConds.length > 0 && sensorConds.length === 0) {'   'if (false) {'

probe "④ RS-485 stagger 제거 (동시 발화 충돌)" ../rpi-files/master/flows.json   'var actualDelay = delay + staggerMs;'   'var actualDelay = delay;'

probe "④ 30초 실행 dedup 제거 (Deploy 후 중복 실행)" ../rpi-files/master/flows.json   'if (Date.now() - lastExec < 30000) return;'   'if (false) return;'

probe "⑤ stepped 완료 시 명시적 stop 제거 (6/3 coil stuck 재현)" ../rpi-files/master/flows.json   'node.send([stopMsg, null, null, null, null]);'   ';'

probe "⑤ 하우스 한정 탐색 제거 (다른 하우스 릴레이 오작동)" ../rpi-files/master/flows.json   'if (houses[i].houseId !== HOUSE_ID) continue;'   ';'

echo "━━ NR 수동 제어 경로 변이 검사 ━━"

probe "schedule-off 취소가 타이머를 안 지운다 (자다가 꺼짐)" ../rpi-files/master/flows.json   "clearTimeout(sched[key].timerId);"   ";"

probe "schedule-off delay 범위 검증 제거" ../rpi-files/master/flows.json   "if (delaySec <= 0 || delaySec > 86400) {"   "if (false) {"

probe "자동 정지 write 의 mutex 제거 (write-read race)" ../rpi-files/master/flows.json   "global.set('_modbusLastWriteAt', Date.now());   // ★ MUTEX (자동정지)"   ";"

probe "unitId 하드코딩 재현 (전체 OFF stale 사고 패턴)" ../rpi-files/master/flows.json   "const unitId = modbus.unitId || 2;"   "const unitId = 2;"

probe "bidir open 코일 조합 오류 (양쪽 코일 동시 ON)" ../rpi-files/master/flows.json   "value: [true, false] };"   "value: [true, true] };"

probe "houseId 정규화 제거 (수동·자동화 평행 세계 회귀)" ../rpi-files/master/flows.json   "if (hm) houseId = "   "if (false) houseId = "

probe "동기화 성공 마킹 소실 (synced=1 이 안 나감)" ../rpi-files/master/flows.json   "const ids = msg._ctrlIds || [];"   "const ids = [];"

probe "동기화 id 정수 필터 제거" ../rpi-files/master/flows.json   "const safeIds = ids.filter"   "const safeIds = ids; void ids.filter"

probe "동기화 기본값을 자동 시작으로 (자동 모드 전환 금지 위반)" ../rpi-files/master/flows.json   "const paused = flow.get('ctrlSyncPaused');"   "const paused = false;"

probe "배치 크기 서버 상한 초과 (413 전멸)" ../rpi-files/master/flows.json   "FROM control_logs\nWHERE synced IS NULL OR synced = 0\nORDER BY timestamp ASC\nLIMIT 200"   "FROM control_logs\nWHERE synced IS NULL OR synced = 0\nORDER BY timestamp ASC\nLIMIT 900"

probe "로컬 제어 명령 허용목록 제거" ../rpi-files/master/flows.json   "if (!ALLOWED_COMMANDS.includes(command)) {"   "if (false) {"

echo "━━ MQTT 수신 계층 변이 검사 ━━"

probe "normHouseId 정규화 무력화 (house1/house_0001 분열 재발)" src/routes/device-positions.routes.js   "const m = v.match(/^house_?0*(\d+)$/);"   "const m = null;"

echo "━━ L1 자동 진단 변이 검사 ━━"

probe "진단 쿨다운 제거 (알림 폭주 → 진단 폭주)" src/services/diagnosisAgent.js   "if (now - last < COOLDOWN_MS) return false;"   "if (false) return false;"

probe "진단 테스트 가드 제거 (테스트가 실 Discord/RPi 를 두드림)" src/services/diagnosisAgent.js   'if (process.env.NODE_ENV === "test") return;'   ";"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DB 가 필요한 검사 — 테스트 전용 Postgres 가 있을 때만 돈다
#   서버에서: bash server/postgres17/test-db.sh up
#   여기서:   DATABASE_URL=postgresql://postgres:test@127.0.0.1:5433/smartfarm_test bash test/mutation-check.sh
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
case "${DATABASE_URL:-}" in
  postgres*://*@127.0.0.1:5433/*|postgres*://*@localhost:5433/*)
    echo "━━ DB 변이 검사 (실제 SQL 을 돌려 확인) ━━"

    probe "소급 중복판정에서 rpi_backfill 제외 삭제 (1,474건 유실)" src/routes/internal.routes.js \
      "AND (operator IS DISTINCT FROM 'rpi_backfill')" \
      ""

    probe "센서 지표에서 시뮬레이션 제외 삭제 (B4)" src/app.js \
      "AND (sd.metadata->>'quality') IS DISTINCT FROM 'simulated'" \
      ""

    probe "릴레이 지표에서 점검중 농장 제외 삭제" src/app.js \
      "JOIN farms f ON f.farm_id = rs.farm_id AND f.status = 'active'" \
      ""


    echo "  -- 경보 판정 (feedback_alert_system_traps 4가지) --"

    probe "브레이커 24시간 창 제거 → 영구 래치 (AWS 3주 단절의 원인)" src/schedulers/sensorThresholdAlert.js       "new Date(a.createdAt).getTime() >= unackSince"       "true"

    probe "임계 스케줄러의 시뮬레이션 제외 삭제" src/schedulers/sensorThresholdAlert.js       "AND (metadata->>'quality') IS DISTINCT FROM 'simulated'"       ""

    probe "점검중 농장에도 오프라인 알림" src/schedulers/offlineAlert.js       'if (farm.status !== "active") continue;'       ";"

    probe "Alert.find 의 soft-delete 필터 제거" src/models/Alert.js       "if (!includeDeleted) {"       "if (false) {"

    probe "농장단위 알림의 하우스 화면 표시 제거" src/models/Alert.js       'const FARM_LEVEL_HOUSE_IDS = ["FARM", "-"];'       'const FARM_LEVEL_HOUSE_IDS = ["NONE"];'

    probe "인라인 CRITICAL 판정(x1.2) 무력화" src/routes/sensors.js       'severity = value > sensor.max * 1.2 ? "CRITICAL" : "WARNING";'       'severity = "WARNING";'

    # 가드 제거는 스키마(NOT NULL)가 막아 관측 불가 — UPSERT 갱신 파괴로 교체 (2026-08-29)
    probe "relay_status UPSERT 갱신 파괴 (stale 상태 박제)" src/services/mqttClient.js       "ON CONFLICT (farm_id, unit_id) DO UPDATE"       "ON CONFLICT (farm_id, unit_id) DO NOTHING --"

    probe "device_positions 입력 가드 제거" src/services/mqttClient.js       "if (!deviceId || position === undefined) return;"       ";"

    probe "등록 코드 무차별 대입 방어 제거 (남의 농장 상태 유출)" src/routes/kakao.routes.js       "return t.n <= 5;"       "return true;"

    probe "중지 농장 코드 연동 허용" src/routes/kakao.routes.js       "AND status = 'active'"       ""

    probe "인라인 10분 쿨다운 기록 제거 (알림 폭주)" src/routes/sensors.js       "alertCooldowns.set(cooldownKey, Date.now());"       ";"
    ;;
  *)
    echo "━━ DB 변이 검사 건너뜀 — 테스트 DB 미지정 (server/postgres17/test-db.sh up) ━━"
    ;;
esac

echo "━━ 원복 확인 ━━"
restore
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" | sed 's/^/  /'
echo "  git status 로 변경 없음을 확인할 것: git status -s src"
