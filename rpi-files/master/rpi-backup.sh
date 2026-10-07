#!/bin/bash
# RPi 설정·데이터 백업 — NAS 전송 (양산 표준 image 대응)
#   설치: /usr/local/bin/rpi-backup.sh (root), /etc/cron.d/rpi-backup → 매일 04:01
#   리포 사본: rpi-files/master/rpi-backup.sh
#
# 2026-10-07 보강 — "데이터를 제외하고 다 백업되고 있지?" 에 "아니오" 였던 것들:
#   ① 표준노드 1분 저장 snapshots.db(146MB, 검정 30일 창)가 어디에도 없었다 → 매일 sqlite 온라인 복사 → gzip(≈4배) → NAS 7일.
#   ② 설정 glob 누락 — *.service.d(pm2-lhk oneshot 드롭인)·*.timer(가드)·udev·nginx·/usr/local/bin/smartfarm-*·
#      ecosystem·go2rtc.yaml(카메라 계정)·promtail·scripts/·lhk crontab(헬스체크 cron)·kiosk.sh·전광판 config.
#      리포로 복구되는 것도 있지만 "NAS 하나로 복원" 이 되게 전부 담는다.
#   설정 tgz 와 데이터 gz 는 파일을 나눈다 — 설정은 30일, 데이터는 7일 보관.
set -e

# ★ FARM_ID 동적 추출 — 양산 시 농장별 자동
FARM_ID=$(grep AWS_IOT_CLIENT_ID /home/lhk/smartfarm/rpi-server/.env | sed 's/.*=MyFarmPi_//')
DATE=$(date +%Y-%m-%d)
NAS="smartgreen_backups@100.125.93.50"
NAS_DIR="/volume1/smartgreen_backups/rpi-backups/${FARM_ID}"
LOCAL="/tmp/${FARM_ID}-${DATE}.tgz"
LOG="/var/log/rpi-backup.log"
KEY=/home/lhk/.ssh/smartgreen_backups
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15"
SCP="scp -O -i $KEY -o StrictHostKeyChecking=no"

# 표준노드 로컬 1분 저장 (검정 30일 창). 없는 농장(ks3267d 미설치)은 건너뛴다.
SNAP_DB=/home/lhk/smartfarm/ks3267/ks3267d/state/snapshots.db
SNAP_LOCAL="/tmp/${FARM_ID}-snapshots-${DATE}.db.gz"

fail() { echo "[$(date)] $FARM_ID: $*" >> $LOG; rm -f "$LOCAL" "$SNAP_LOCAL" /tmp/crontab-lhk; exit 1; }

# PM2 process list 최신화 + dump.pm2 갱신
sudo -u lhk pm2 save --force > /dev/null 2>&1 || true

# lhk crontab — 매분 Modbus 헬스체크·주간 sqlite-maint 가 여기 산다. /etc/cron.d 에 없어서 빠져 있었다.
crontab -l -u lhk > /tmp/crontab-lhk 2>/dev/null || true

# ── 설정 tgz ───────────────────────────────────────────────────────────────
tar czf $LOCAL --ignore-failed-read \
  /home/lhk/.node-red/flows.json \
  /home/lhk/.node-red/flows_cred.json \
  /home/lhk/smartfarm/node-red/settings.js \
  /home/lhk/.node-red/package.json \
  /home/lhk/.node-red/context \
  /home/lhk/smartfarm/rpi-server/.env \
  /home/lhk/smartfarm/.farm-id \
  /home/lhk/smartfarm/ecosystem.config.js \
  /home/lhk/smartfarm/go2rtc.yaml \
  /home/lhk/smartfarm/promtail.yml \
  /home/lhk/smartfarm/scripts \
  /home/lhk/smartfarm/d16-display/config.json \
  /home/lhk/smartfarm/ks3267/ks3267d/state/comm.json \
  /home/lhk/smartfarm/ks3267/ks3267d/state/collect.json \
  /home/lhk/kiosk.sh \
  /home/lhk/.config/autostart \
  /home/lhk/certs \
  /home/lhk/.pm2/dump.pm2 \
  /tmp/crontab-lhk \
  /etc/systemd/system/*.service \
  /etc/systemd/system/*.timer \
  /etc/systemd/system/*.service.d \
  /etc/udev/rules.d/99-smartfarm-485.rules \
  /etc/nginx/sites-available/smartfarm \
  /etc/cron.d \
  /usr/local/bin/smartfarm-* \
  /usr/local/bin/rpi-backup.sh \
  /usr/local/sbin/smartfarm-* \
  2>/dev/null

# NAS 폴더 자동 생성 + 전송 (-O legacy SCP)
$SSH $NAS "mkdir -p $NAS_DIR" 2>/dev/null || fail "NAS 접속 실패"
$SCP $LOCAL ${NAS}:${NAS_DIR}/ 2>/dev/null || fail "설정 tgz 전송 실패"

# 무결성 검증
LOCAL_SIZE=$(stat -c%s $LOCAL)
REMOTE_SIZE=$($SSH $NAS "stat -c%s ${NAS_DIR}/$(basename $LOCAL)" 2>/dev/null)
[ "$LOCAL_SIZE" = "$REMOTE_SIZE" ] || fail "설정 tgz 크기 불일치 (local=$LOCAL_SIZE NAS=$REMOTE_SIZE)"

# ── 데이터: snapshots.db (sqlite 온라인 복사 → gzip) ──────────────────────────
SNAP_NOTE="snapshots 없음"
if [ -f "$SNAP_DB" ]; then
  # .backup 은 쓰기 중인 DB 도 일관된 사본을 만든다. 파일 복사(cp)는 쓰는 도중이면 깨진다.
  sqlite3 "$SNAP_DB" ".backup '/tmp/snapshots-copy.db'" || fail "snapshots.db 복사 실패"
  gzip -c /tmp/snapshots-copy.db > "$SNAP_LOCAL"; rm -f /tmp/snapshots-copy.db
  $SCP "$SNAP_LOCAL" ${NAS}:${NAS_DIR}/ 2>/dev/null || fail "snapshots 전송 실패"
  S_LOCAL=$(stat -c%s "$SNAP_LOCAL")
  S_REMOTE=$($SSH $NAS "stat -c%s ${NAS_DIR}/$(basename $SNAP_LOCAL)" 2>/dev/null)
  [ "$S_LOCAL" = "$S_REMOTE" ] || fail "snapshots 크기 불일치 (local=$S_LOCAL NAS=$S_REMOTE)"
  SNAP_NOTE="snapshots ${S_LOCAL} bytes"
fi

# NAS 보관: 설정 30일, 데이터 7일
$SSH $NAS "find $NAS_DIR -name '*.tgz' -mtime +30 -delete; find $NAS_DIR -name '*-snapshots-*.db.gz' -mtime +7 -delete" 2>/dev/null

rm -f $LOCAL "$SNAP_LOCAL" /tmp/crontab-lhk
echo "[$(date)] $FARM_ID 백업 완료 (설정 ${LOCAL_SIZE} bytes, ${SNAP_NOTE})" >> $LOG
