#!/bin/bash
# ============================================================
# SmartFarm SD카드 이미지 생성 스크립트
#
# 프로비저닝 완료된 RPi에서 실행하여 SD카드 이미지를 생성합니다.
# 이미지 생성 전 machine-specific 데이터를 정리합니다.
#
# 사용법:
#   sudo ./clone-image.sh
#
# 이 스크립트 실행 후 RPi를 종료하고 SD카드를 빼서
# Win32DiskImager 또는 dd로 이미지를 읽어냅니다.
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

if [ "$EUID" -ne 0 ]; then
  err "root 권한 필요: sudo ./clone-image.sh"
fi

SMARTFARM_USER="lhk"
SMARTFARM_HOME="/home/${SMARTFARM_USER}"

echo ""
echo "=========================================="
echo "  📀 SmartFarm SD카드 이미지 준비"
echo "=========================================="
echo ""

MODEL=$(cat /proc/device-tree/model 2>/dev/null || echo "unknown")
echo "  모델: ${MODEL}"
echo ""

read -p "이미지 생성을 위해 데이터를 초기화합니다. 계속할까요? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "취소됨"
  exit 0
fi

# ── 1. PM2 프로세스 중지 ──
echo ""
log "PM2 프로세스 중지"
sudo -u "$SMARTFARM_USER" pm2 stop all 2>/dev/null || true
sudo -u "$SMARTFARM_USER" pm2 delete all 2>/dev/null || true

# ── 2. FARM_ID 초기화 ──
log "FARM_ID 초기화 → UNSET"

SETTINGS_FILE="${SMARTFARM_HOME}/smartfarm/node-red/settings.js"
if [ -f "$SETTINGS_FILE" ]; then
  sed -i "s/FARM_ID: process\.env\.FARM_ID || '[^']*'/FARM_ID: process.env.FARM_ID || 'UNSET'/" "$SETTINGS_FILE"
fi

FLOWS_FILE="${SMARTFARM_HOME}/.node-red/flows.json"
if [ -f "$FLOWS_FILE" ]; then
  python3 -c "
import json
with open('${FLOWS_FILE}', 'r') as f:
    flows = json.load(f)
for node in flows:
    if node.get('type') == 'tab' and isinstance(node.get('env'), list):
        for env in node['env']:
            if env.get('name') == 'FARM_ID':
                env['value'] = 'UNSET'
with open('${FLOWS_FILE}', 'w') as f:
    json.dump(flows, f)
" 2>/dev/null
fi

# ── 3. AWS IoT 인증서 삭제 ──
log "AWS IoT 인증서 삭제"
rm -f "${SMARTFARM_HOME}/certs/certificate.pem.crt"
rm -f "${SMARTFARM_HOME}/certs/private.pem.key"

# ── 4. 로컬 데이터 삭제 ──
log "로컬 데이터 삭제"

# SQLite DB (센서 데이터)
rm -f "${SMARTFARM_HOME}/.node-red/smartfarm.db"

# Node-RED context (global variables)
rm -rf "${SMARTFARM_HOME}/.node-red/context/"

# 로그 파일
rm -rf "${SMARTFARM_HOME}/smartfarm/logs/*"

# bash history
rm -f "${SMARTFARM_HOME}/.bash_history"

# ── 4. 네트워크 설정 초기화 ──
log "네트워크 설정 초기화 (DHCP)"

# 고정 IP 해제 → DHCP로 복원
# nmcli 연결이 있으면 초기화
for conn in $(nmcli -t -f NAME con show 2>/dev/null | grep -i wlan); do
  nmcli con modify "$conn" ipv4.method auto 2>/dev/null || true
  nmcli con modify "$conn" ipv4.addresses "" 2>/dev/null || true
  nmcli con modify "$conn" ipv4.gateway "" 2>/dev/null || true
done

# WiFi SSID 초기화 (선택사항 - 설치 시 새로 설정)
# wpa_supplicant.conf가 있으면 네트워크 블록 제거
WPA_CONF="/etc/wpa_supplicant/wpa_supplicant.conf"
if [ -f "$WPA_CONF" ]; then
  cat > "$WPA_CONF" << 'WPA'
country=KR
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
WPA
fi

# ── 5. SSH 호스트 키 삭제 ──
log "SSH 호스트 키 삭제 (first-boot에서 재생성)"
rm -f /etc/ssh/ssh_host_*

# ── 6. machine-id 삭제 ──
log "machine-id 삭제 (first-boot에서 재생성)"
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id

# ── 7. first-boot 트리거 설정 ──
log "first-boot 트리거 설정"
touch "${SMARTFARM_HOME}/smartfarm/.first-boot-pending"

# ── 8. apt 캐시 정리 (이미지 크기 축소) ──
log "캐시 정리 (이미지 크기 축소)"
apt-get clean
rm -rf /var/cache/apt/archives/*
rm -rf /tmp/*
rm -rf /var/tmp/*

# journalctl 로그 정리
journalctl --vacuum-time=1s 2>/dev/null || true

# ── 완료 ──
echo ""
echo "=========================================="
echo "  ✅ 이미지 준비 완료!"
echo "=========================================="
echo ""
echo "  다음 단계:"
echo "  1. RPi 종료:  sudo shutdown -h now"
echo "  2. SD카드를 PC에 연결"
echo "  3. 이미지 읽기:"
echo ""
echo "     Windows (Win32DiskImager):"
echo "       Read → smartfarm-rpi{3|4|5}-$(date +%Y%m%d).img"
echo ""
echo "     Linux/Mac (dd):"
echo "       sudo dd if=/dev/sdX of=smartfarm-rpi{3|4|5}-$(date +%Y%m%d).img bs=4M status=progress"
echo ""
echo "  4. (선택) PiShrink로 이미지 축소:"
echo "       pishrink.sh smartfarm-rpi*.img"
echo ""
echo "=========================================="
