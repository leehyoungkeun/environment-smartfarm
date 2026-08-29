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

log "nginx 중지 (이미지 중 파일 변경 방지)"
systemctl stop nginx 2>/dev/null || true

# ── 1-1. Tailscale 등록 해제 (마스터 이미지 트랩 #2) ──
# /var/lib/tailscale/ 에 등록 상태가 남으면 새 RPi 가 farm-0001 로 등록된다.
# logout 만으로는 상태파일이 남을 수 있어 파일까지 지운다.
log "Tailscale 등록 해제"
tailscale logout 2>/dev/null || true
systemctl stop tailscaled 2>/dev/null || true
rm -f /var/lib/tailscale/registered
rm -f /var/lib/tailscale/tailscaled.state

# ── 2. FARM_ID 초기화 ──
log "FARM_ID 초기화 → UNSET"

# 마스터 이미지 트랩 #1: /home/lhk/.env 에 FARM_ID 가 박혀 있으면
# .farm-id 파일보다 우선 적용되어 새 농장이 farm_0001 로 잘못 등록된다.
rm -f "${SMARTFARM_HOME}/.env"

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

# PM2 ecosystem.config.js 의 FARM_ID env 도 초기화
# (PM2 env 가 settings.js fallback 보다 우선이므로 반드시 함께 수정)
for ECOSYSTEM in \
  "${SMARTFARM_HOME}/smartfarm/ecosystem.config.js" \
  "${SMARTFARM_HOME}/smartfarm/scripts/ecosystem.config.js"; do
  if [ -f "$ECOSYSTEM" ]; then
    sed -i "s/FARM_ID: *'[^']*'/FARM_ID: process.env.FARM_ID || 'UNSET'/" "$ECOSYSTEM"
    sed -i "s/FARM_ID: *process\.env\.FARM_ID *|| *'[^']*'/FARM_ID: process.env.FARM_ID || 'UNSET'/" "$ECOSYSTEM"
  fi
done

# ── 3. AWS IoT 인증서 삭제 ──
log "AWS IoT 인증서 삭제"
# AmazonRootCA1.pem 은 전 농장 공통이므로 보존한다 (.crt/.key/.pem.private 만 삭제)
# 농장 고유 비밀·모드 파일 (2026-08-29): 새 농장은 setup 이 키를 받고, ecosystem 이 credentialSecret 을 새로 만든다
rm -f "${SMARTFARM_HOME}/smartfarm/.sensor-api-key"
rm -f "${SMARTFARM_HOME}/smartfarm/.sim-mode"
rm -f "${SMARTFARM_HOME}/smartfarm/.nr-credential-secret"
rm -f "${SMARTFARM_HOME}/.node-red/flows_cred.json" "${SMARTFARM_HOME}/.node-red/.config.runtime.json"
truncate -s0 /etc/smartfarm/cameras.conf 2>/dev/null || true
rm -f "${SMARTFARM_HOME}/certs"/*.crt
rm -f "${SMARTFARM_HOME}/certs"/*.key
rm -f "${SMARTFARM_HOME}/certs"/*.pem.private

# ── 3-1. flows.json placeholder 복원 (100농장 표준 이미지 필수) ──
# NR 시작 시 wrapper.sh 가 flows.json 의 ${FARM_ID} 를 .farm-id 값으로 sed 치환한다.
# 이 치환은 편도라, 1호에서 이미 farm_0001 로 치환된 상태로 이미지를 뜨면
# 모든 신규 농장이 farm_0001 의 MQTT 토픽을 구독하게 된다 (제어 오작동).
# → placeholder 원본을 되돌려 넣어 각 농장 첫 부팅 시 자기 ID 로 치환되게 한다.
PLACEHOLDER_FLOWS="${SMARTFARM_HOME}/smartfarm/master-template/flows.json.placeholder"
TARGET_FLOWS="${SMARTFARM_HOME}/.node-red/flows.json"
log "flows.json placeholder 복원"
if [ -r "$PLACEHOLDER_FLOWS" ]; then
    # 신선도 검사: 원본이 현재 flows.json 보다 오래됐으면 에디터 수정이 반영 안 된 것이다.
    # 이 상태로 복원하면 최신 플로우 수정이 이미지에서 사라진다.
    if [ "$TARGET_FLOWS" -nt "$PLACEHOLDER_FLOWS" ]; then
        log "  ❌ placeholder 원본이 flows.json 보다 오래됐다 (낡은 원본)"
        log "     원본 : $(date -r "$PLACEHOLDER_FLOWS" '+%F %T')"
        log "     flows: $(date -r "$TARGET_FLOWS" '+%F %T')"
        log "  → 1호에서 먼저 실행할 것:"
        log "     /home/lhk/smartfarm/scripts/regen-flows-placeholder.sh"
        exit 1
    fi
    cp "$PLACEHOLDER_FLOWS" "$TARGET_FLOWS"
    n=$(grep -o '\${FARM_ID}' "$TARGET_FLOWS" | wc -l)
    log "  → placeholder ${n} 개 복원 완료"
    if [ "$n" -eq 0 ]; then
        log "  ⚠️ 경고: 복원했으나 placeholder 가 0 개다. 원본을 확인할 것."
    fi
else
    log "  ⚠️ 경고: ${PLACEHOLDER_FLOWS} 없음 — placeholder 복원 건너뜀!"
    log "  ⚠️ 이 상태로 이미지를 뜨면 신규 농장이 farm_0001 토픽을 구독한다."
    if grep -q 'farm_0001' "$TARGET_FLOWS" 2>/dev/null; then
        log "  ⚠️ flows.json 에 farm_0001 이 남아 있다. 계속하기 전에 반드시 확인할 것."
    fi
fi

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
rm -f /root/.bash_history

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

# ── 9. 자체 검증 (하나라도 실패하면 이미지를 뜨지 않는다) ──
# ⚠️ set -euo pipefail 이 걸려 있으므로 검사식은 반드시 || 로 감싼다.
#    맨몸 [ ... ] 는 실패 시 스크립트가 즉시 종료되어 나머지 검사를 못 본다.
echo ""
echo "=========================================="
echo "  🔍 Sanitize 검증"
echo "=========================================="
FAIL=0
chk() {  # chk "<설명>" <종료코드>
  if [ "$2" -eq 0 ]; then
    echo -e "  ${GREEN}✅${NC} $1"
  else
    echo -e "  ${RED}❌${NC} $1"
    FAIL=$((FAIL+1))
  fi
}

FLOWS="${SMARTFARM_HOME}/.node-red/flows.json"

# 농장 고유 식별자
rc=0; [ "$(cat "${SMARTFARM_HOME}/smartfarm/.farm-id" 2>/dev/null | tr -d '[:space:]')" = "UNSET" ] || rc=1
chk ".farm-id = UNSET" $rc

rc=0; [ ! -f "${SMARTFARM_HOME}/.env" ] || rc=1
chk ".env 삭제됨 (FARM_ID 트랩)" $rc

# Tailscale
rc=0; { [ ! -f /var/lib/tailscale/tailscaled.state ] && [ ! -f /var/lib/tailscale/registered ]; } || rc=1
chk "Tailscale 등록 상태 삭제됨" $rc

# AWS IoT 인증서 (공통 CA 는 남아야 한다)
rc=0; [ -z "$(ls "${SMARTFARM_HOME}/certs"/*.crt "${SMARTFARM_HOME}/certs"/*.key 2>/dev/null || true)" ] || rc=1
chk "농장 인증서 삭제됨" $rc

rc=0; [ -f "${SMARTFARM_HOME}/certs/AmazonRootCA1.pem" ] || rc=1
chk "AmazonRootCA1.pem 보존됨 (전 농장 공통)" $rc

# flows.json placeholder
PH=$(grep -o '\${FARM_ID}' "$FLOWS" 2>/dev/null | wc -l || true)
rc=0; [ "$PH" -gt 0 ] || rc=1
chk "flows.json placeholder ${PH} 개 (0 이면 실패)" $rc

LEFT=$(grep -o 'smartfarm/farm_[0-9]\{4\}' "$FLOWS" 2>/dev/null | wc -l || true)
rc=0; [ "$LEFT" -eq 0 ] || rc=1
chk "MQTT 토픽에 농장ID 잔존 ${LEFT} 건 (0 이어야 함)" $rc

# 운영 데이터
rc=0; [ ! -f "${SMARTFARM_HOME}/.node-red/smartfarm.db" ] || rc=1
chk "SQLite DB 삭제됨" $rc

rc=0; [ ! -d "${SMARTFARM_HOME}/.node-red/context" ] || rc=1
chk "NR context 삭제됨" $rc

# 기기 고유 식별자
rc=0; [ -z "$(ls /etc/ssh/ssh_host_* 2>/dev/null || true)" ] || rc=1
chk "SSH host key 삭제됨" $rc

rc=0; [ ! -s /var/lib/dbus/machine-id ] || rc=1
chk "machine-id 삭제됨" $rc

# first-boot 트리거
rc=0; [ -f "${SMARTFARM_HOME}/smartfarm/.first-boot-pending" ] || rc=1
chk "first-boot 트리거 설정됨" $rc

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}==========================================${NC}"
  echo -e "${RED}  ❌ 검증 실패 ${FAIL} 건 — 이미지를 뜨지 말 것${NC}"
  echo -e "${RED}==========================================${NC}"
  echo "  위 ❌ 항목을 해결한 뒤 이 스크립트를 다시 실행하십시오."
  exit 1
fi

# ── 완료 ──
echo ""
echo "=========================================="
echo "  ✅ 이미지 준비 완료! (검증 통과)"
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
