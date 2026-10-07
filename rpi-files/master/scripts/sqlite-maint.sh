#!/bin/bash
# SmartFarm SQLite 정기 유지보수
#  - auto_vacuum=INCREMENTAL 로 모인 free page 를 OS 에 반환
#  - WAL 파일 절단
# NR 이 매분 :47 에 INSERT 하므로 :50~:56 안전 창에서 실행한다.
DB=/home/lhk/.node-red/smartfarm.db
LOG=/home/lhk/smartfarm/logs/sqlite-maint.log

[ -f "$DB" ] || { echo "$(date -Is) DB 없음: $DB" >> "$LOG"; exit 1; }

# 안전 창 대기 (최대 70초)
for _ in $(seq 1 70); do
  s=$(date +%S)
  [ "$s" -ge 50 ] && [ "$s" -le 56 ] && break
  sleep 1
done

BEFORE=$(stat -c%s "$DB")
FREE=$(sqlite3 "$DB" "PRAGMA freelist_count;" 2>/dev/null)

sqlite3 "$DB" >/dev/null 2>&1 <<SQL
PRAGMA busy_timeout = 10000;
PRAGMA incremental_vacuum;
PRAGMA wal_checkpoint(TRUNCATE);
SQL
RC=$?

AFTER=$(stat -c%s "$DB")
INTEG=$(sqlite3 "$DB" "PRAGMA integrity_check;" 2>/dev/null)
printf "%s rc=%s freelist=%s %.1fMB -> %.1fMB (%.1fMB 회수) integrity=%s\n" \
  "$(date -Is)" "$RC" "$FREE" \
  "$(echo "$BEFORE" | awk "{print \$1/1048576}")" \
  "$(echo "$AFTER" | awk "{print \$1/1048576}")" \
  "$(echo "$BEFORE $AFTER" | awk "{print (\$1-\$2)/1048576}")" \
  "$INTEG" >> "$LOG"
