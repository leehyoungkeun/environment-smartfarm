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
FILES=(src/app.js src/routes/devices.routes.js src/routes/sensors.js src/routes/config.routes.js)
for f in "${FILES[@]}"; do mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BK/$f" "$f"; done; }
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

echo "━━ 원복 확인 ━━"
restore
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)" | sed 's/^/  /'
echo "  git status 로 변경 없음을 확인할 것: git status -s src"
