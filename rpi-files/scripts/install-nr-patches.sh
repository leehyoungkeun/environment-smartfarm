#!/bin/bash
# ============================================================
# SmartFarm — NR 패치 systemd 서비스 설치 (1회만 실행)
#
# 1. 패치 스크립트들을 /home/lhk/smartfarm/scripts/nr-patches/ 로 복사
# 2. ensure-nr-patches.sh 실행 권한 부여
# 3. systemd 서비스 등록 + 활성화
# 4. 즉시 1회 실행 (확인)
#
# 사용:
#   sudo bash install-nr-patches.sh
# ============================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: run as root (sudo bash install-nr-patches.sh)" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARGET_DIR="/home/lhk/smartfarm/scripts/nr-patches"

echo "[install] 패치 스크립트 복사 → $TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp "$REPO_ROOT/docs/patch_nr_mqtt_chunked_subscribe.py" "$TARGET_DIR/"
cp "$SCRIPT_DIR/ensure-nr-patches.sh" "$TARGET_DIR/"
chown -R lhk:lhk "$TARGET_DIR"
chmod +x "$TARGET_DIR/ensure-nr-patches.sh"

echo "[install] systemd 서비스 등록"
cp "$SCRIPT_DIR/smartfarm-nr-patches.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable smartfarm-nr-patches.service

echo "[install] 즉시 1회 실행 (검증)"
systemctl start smartfarm-nr-patches.service
systemctl --no-pager status smartfarm-nr-patches.service | head -15

echo ""
echo "[install] 완료. 다음 부팅부터 자동 실행 (Before=pm2-lhk.service)"
echo "[install] 로그: /home/lhk/smartfarm/logs/nr-patches.log"
