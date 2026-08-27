#!/bin/bash
# 백업 복구 테스트 — 최신 덤프를 같은 컨테이너의 **별도 DB** 로 복원해 대조하고 지운다.
# 운영 DB(smartfarm_db) 는 읽기만 한다. 2026-08-27 첫 실행: 4초 복원, 오류 0.
#
# 백업이 "있다" 와 "복구된다" 는 다른 문제다. 분기마다 한 번은 돌릴 것.
# 실행: bash server/postgres17/restore-test.sh   (서버, afocus)
set -u
T0=$(date +%s); el(){ printf '[+%3ds] ' $(( $(date +%s)-T0 )); }
F=$(ls -t /storage/backups/smartfarm/smartfarm_*.sql.gz | head -1)
TEST=smartfarm_restore_test
P="docker exec -i postgres17 psql -U smartfarm -q"

echo "=== 대상: $F ($(du -h "$F" | cut -f1)) ==="
$(el); echo "gzip 무결성: $(gzip -t "$F" && echo OK || echo FAIL)"
$P -d postgres -c "DROP DATABASE IF EXISTS $TEST" >/dev/null 2>&1
$P -d postgres -c "CREATE DATABASE $TEST" >/dev/null 2>&1
$(el); echo "복원 시작"
zcat "$F" | $P -d $TEST > /tmp/restore.log 2>&1
$(el); echo "복원 끝 — 오류 $(grep -c ERROR /tmp/restore.log)건"
grep ERROR /tmp/restore.log | cut -c1-110 | sort | uniq -c | sort -rn | head -5 | sed 's/^/  /'

echo; echo "=== 덤프 시점 vs 복원본 최신 데이터 (일치해야 정상) ==="
echo "  덤프 파일 시각(UTC): $(basename "$F" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}')"
$P -d $TEST -tAF' | ' -c "
  select '센서 최신(KST)',   to_char(max(timestamp)  at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI'), count(*) from sensor_data
  union all select '제어이력 최신(KST)', to_char(max(created_at) at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI'), count(*) from control_logs
  union all select '농장',  null, count(*) from farms
  union all select '하이퍼테이블', null, count(*) from timescaledb_information.hypertables" | sed 's/^/  /'

echo; echo "=== 테이블 수 (운영 vs 복원 — 새 청크 1~2개 차이는 정상) ==="
Q="select count(*) from pg_stat_user_tables"
echo "  운영 $($P -d smartfarm_db -tAc "$Q") / 복원 $($P -d $TEST -tAc "$Q")"

$P -d postgres -c "DROP DATABASE $TEST" >/dev/null 2>&1
$(el); echo "정리 — 테스트 DB 잔존: $($P -d postgres -tAc "select count(*) from pg_database where datname='$TEST'") (0 이어야 함)"
rm -f /tmp/restore.log
