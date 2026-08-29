#!/bin/bash
# 테스트 전용 Postgres (TimescaleDB) — 운영 DB 와 완전히 분리된 별개 컨테이너.
#
# 운영: postgres17     127.0.0.1:5432  /db/postgresql/data  (영속)
# 테스트: pg-test      127.0.0.1:5433  tmpfs               (재시작하면 사라짐)
#
# 127.0.0.1 에만 바인딩하므로 LAN·인터넷에서 접근할 수 없다.
# 데이터는 tmpfs(메모리)라 디스크를 쓰지 않고, 컨테이너를 지우면 흔적이 남지 않는다.
#
# 사용:
#   bash server/postgres17/test-db.sh up      # 띄우고 스키마 생성
#   bash server/postgres17/test-db.sh down    # 지우기
#   bash server/postgres17/test-db.sh status
set -u

NAME=pg-test
PORT=5433
PASS=test
DB=smartfarm_test
IMAGE=timescale/timescaledb:latest-pg17

case "${1:-status}" in
  up)
    if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
      docker start "$NAME" >/dev/null 2>&1 || true
      echo "  기존 컨테이너 시작"
    else
      docker run -d --name "$NAME" \
        -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_DB="$DB" \
        -p 127.0.0.1:$PORT:5432 \
        --tmpfs /var/lib/postgresql/data:rw,size=512m \
        --restart unless-stopped \
        "$IMAGE" >/dev/null
      echo "  컨테이너 생성 ($IMAGE, tmpfs 512MB)"
    fi
    for i in $(seq 1 30); do
      docker exec "$NAME" pg_isready -q 2>/dev/null && break
      sleep 2
    done
    docker exec "$NAME" pg_isready -q 2>/dev/null || { echo "  ❌ 기동 실패"; exit 1; }
    # 스키마 적용 — Prisma 스키마 + 손으로 관리하는 마이그레이션.
    # 백엔드 소스가 있는 곳에서만 한다 (없으면 건너뛰고 주소만 알려준다).
    BE=""
    for c in "$(dirname "$0")/../../backend" /home/afocus/smartfarm/backend; do
      [ -f "$c/prisma/schema.prisma" ] && BE="$c" && break
    done
    if [ -n "$BE" ]; then
      URL="postgresql://postgres:$PASS@127.0.0.1:$PORT/$DB"
      (cd "$BE" && DATABASE_URL="$URL" npx prisma db push --skip-generate >/dev/null 2>&1) && echo "  스키마 적용 (prisma db push)" || echo "  ⚠ prisma db push 실패"
      for f in "$BE"/prisma/migration-relay-status.sql "$BE"/prisma/migration-device-positions.sql "$BE"/prisma/migration-kakao-links.sql; do
        [ -f "$f" ] || continue
        docker exec -i "$NAME" psql -U postgres -d "$DB" -q < "$f" >/dev/null 2>&1 && echo "  적용: $(basename "$f")" || echo "  ⚠ 실패: $(basename "$f")"
      done
    else
      echo "  ⚠ backend 소스를 못 찾음 — 스키마는 직접 적용할 것"
    fi
    echo "  준비됨: postgresql://postgres:$PASS@127.0.0.1:$PORT/$DB"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "  삭제됨" || echo "  없음"
    ;;
  status)
    if docker ps --format '{{.Names}} {{.Status}}' | grep "^$NAME "; then
      docker exec "$NAME" psql -U postgres -d "$DB" -tAc \
        "select '  테이블 ' || count(*) from information_schema.tables where table_schema='public'" 2>/dev/null
    else
      echo "  꺼져 있음 (up 으로 시작)"
    fi
    ;;
  *)
    echo "사용: $0 {up|down|status}"; exit 1;;
esac
