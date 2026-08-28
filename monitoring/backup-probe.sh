#!/bin/bash
# backup-probe.sh — NAS 에 실제로 있는 최신 백업 파일을 확인해 node_exporter 텍스트파일로 낸다.
#
# 2026-08-28. 그전까지 백업 실패는 /var/log/smartfarm-backup.log 에만 남았고 아무도 안 봤다.
# 스크립트의 "완료" 로그가 아니라 **파이프라인 끝(NAS 의 파일)** 을 본다 — 로그가 거짓말해도 잡힌다.
#
# 실행: afocus cron, 10분마다  (*/10 * * * * /home/afocus/monitoring/backup-probe.sh)
# 출력: /home/afocus/monitoring/textfile/smartfarm_backup.prom  (node-exporter 가 /textfile 로 마운트)
# 규칙: BackupStale(26h) · BackupTooSmall(1MB) · BackupProbeFailed(1h)
NAS_HOST=100.125.93.50
NAS_USER=smartgreen_backups
NAS_PATH=/volume1/smartgreen_backups
SSH_KEY=/home/afocus/.ssh/smartgreen_backups
LOCAL_DIR=/storage/backups/smartfarm
OUT=/home/afocus/monitoring/textfile/smartfarm_backup.prom

now=$(date +%s)
# NAS: 최신 .gz 의 mtime·크기·개수 (한 번의 SSH)
nas=$(ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=no "$NAS_USER@$NAS_HOST" \
  "f=\$(ls -t $NAS_PATH/smartfarm_*.sql.gz 2>/dev/null | head -1); [ -n \"\$f\" ] && stat -c '%Y %s' \"\$f\"; ls $NAS_PATH/smartfarm_*.sql.gz 2>/dev/null | wc -l" 2>/dev/null)
if [ -n "$nas" ]; then
  ok=1
  nas_mtime=$(echo "$nas" | sed -n 1p | cut -d' ' -f1); nas_size=$(echo "$nas" | sed -n 1p | cut -d' ' -f2); nas_count=$(echo "$nas" | sed -n 2p)
  nas_age=$(( now - ${nas_mtime:-0} ))
else
  ok=0; nas_age=""; nas_size=""; nas_count=""
fi
# 로컬 1차 백업
lf=$(ls -t $LOCAL_DIR/smartfarm_*.sql.gz 2>/dev/null | head -1)
if [ -n "$lf" ]; then local_age=$(( now - $(stat -c %Y "$lf") )); local_size=$(stat -c %s "$lf"); else local_age=""; local_size=""; fi

TMP="$OUT.tmp"
{
echo "# HELP smartfarm_backup_probe_ok 1 if the NAS was reachable and listed"
echo "# TYPE smartfarm_backup_probe_ok gauge"
echo "smartfarm_backup_probe_ok $ok"
if [ "$ok" = 1 ]; then
  echo "# HELP smartfarm_backup_nas_latest_age_seconds age of newest backup file on NAS"
  echo "# TYPE smartfarm_backup_nas_latest_age_seconds gauge"
  echo "smartfarm_backup_nas_latest_age_seconds $nas_age"
  echo "# HELP smartfarm_backup_nas_latest_size_bytes size of newest backup file on NAS"
  echo "# TYPE smartfarm_backup_nas_latest_size_bytes gauge"
  echo "smartfarm_backup_nas_latest_size_bytes $nas_size"
  echo "# HELP smartfarm_backup_nas_count number of backup files on NAS"
  echo "# TYPE smartfarm_backup_nas_count gauge"
  echo "smartfarm_backup_nas_count $nas_count"
fi
if [ -n "$local_age" ]; then
  echo "# HELP smartfarm_backup_local_latest_age_seconds age of newest local backup file"
  echo "# TYPE smartfarm_backup_local_latest_age_seconds gauge"
  echo "smartfarm_backup_local_latest_age_seconds $local_age"
  echo "# HELP smartfarm_backup_local_latest_size_bytes size of newest local backup file"
  echo "# TYPE smartfarm_backup_local_latest_size_bytes gauge"
  echo "smartfarm_backup_local_latest_size_bytes $local_size"
fi
echo "# HELP smartfarm_backup_probe_timestamp_seconds when this probe last ran"
echo "# TYPE smartfarm_backup_probe_timestamp_seconds gauge"
echo "smartfarm_backup_probe_timestamp_seconds $now"
} > "$TMP" && mv -f "$TMP" "$OUT"
