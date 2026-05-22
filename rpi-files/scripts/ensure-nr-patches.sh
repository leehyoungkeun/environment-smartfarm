#!/bin/bash
# ============================================================
# SmartFarm — NR 패치 idempotent 재적용
#
# NR npm/apt 업그레이드 시 /usr/lib/.../10-mqtt.js 가 덮어쓰여 패치가
# 손실될 수 있음. 부팅 시 systemd oneshot 으로 자동 재적용.
#
# 호출:
#   - smartfarm-nr-patches.service (Before=pm2-lhk.service)
#   - 또는 수동: sudo bash ensure-nr-patches.sh
#
# 적용 패치:
#   1. 10-mqtt.js chunked SUBSCRIBE (AWS IoT 8-topic-per-packet 한도)
# ============================================================

set -euo pipefail

LOG_PREFIX="[ensure-nr-patches]"
PATCH_DIR="/home/lhk/smartfarm/scripts/nr-patches"
LOG_FILE="/home/lhk/smartfarm/logs/nr-patches.log"

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
echo ""
echo "=== $LOG_PREFIX $(date) ==="

# ── 패치 1: 10-mqtt.js chunked SUBSCRIBE ──
CHUNK_PATCH="${PATCH_DIR}/patch_nr_mqtt_chunked_subscribe.py"
if [ -f "$CHUNK_PATCH" ]; then
    echo "$LOG_PREFIX applying chunked SUBSCRIBE patch..."
    python3 "$CHUNK_PATCH" || {
        rc=$?
        if [ "$rc" -eq 0 ]; then
            echo "$LOG_PREFIX chunked SUBSCRIBE: already applied"
        else
            echo "$LOG_PREFIX WARN chunked SUBSCRIBE patch failed (rc=$rc)"
        fi
    }
else
    echo "$LOG_PREFIX SKIP: $CHUNK_PATCH not found"
fi

echo "$LOG_PREFIX done"
