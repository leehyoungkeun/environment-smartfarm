#!/bin/bash
# ============================================================
# SmartFarm RPi 첫 부팅 스크립트
#
# SD카드 이미지를 복제한 후 첫 부팅 시 자동 실행됩니다.
# - 이전 농장의 machine-specific 데이터 초기화
# - FARM_ID를 기본값(UNSET)으로 리셋
# - SSH 호스트 키 재생성
# - PM2 서비스 시작
# - 설정 페이지(http://RPi-IP/setup) 대기 상태로 전환
#
# systemd에 의해 실행됨 (smartfarm-firstboot.service)
# ============================================================

set -euo pipefail

SMARTFARM_USER="lhk"
SMARTFARM_HOME="/home/${SMARTFARM_USER}"
LOG_FILE="${SMARTFARM_HOME}/smartfarm/logs/first-boot.log"
PENDING_FILE="${SMARTFARM_HOME}/smartfarm/.first-boot-pending"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "=== SmartFarm First Boot: $(date) ==="

# ── 1. SSH 호스트 키 재생성 ──
# 복제된 이미지는 동일한 호스트 키를 가지므로 보안을 위해 재생성
echo "[1/6] SSH 호스트 키 재생성"
rm -f /etc/ssh/ssh_host_*
dpkg-reconfigure openssh-server 2>/dev/null || ssh-keygen -A
systemctl restart sshd 2>/dev/null || true

# ── 2. FARM_ID 초기화 ──
# 이전 농장의 FARM_ID가 남아있으면 안 됨
echo "[2/6] FARM_ID 초기화"

SETTINGS_FILE="${SMARTFARM_HOME}/smartfarm/node-red/settings.js"
if [ -f "$SETTINGS_FILE" ]; then
  sed -i "s/FARM_ID: process\.env\.FARM_ID || '[^']*'/FARM_ID: process.env.FARM_ID || 'UNSET'/" "$SETTINGS_FILE"
  echo "  settings.js FARM_ID → UNSET"
fi

FLOWS_FILE="${SMARTFARM_HOME}/.node-red/flows.json"
if [ -f "$FLOWS_FILE" ]; then
  # flows.json 내 FARM_ID 환경변수를 UNSET으로 변경
  sudo -u "$SMARTFARM_USER" python3 -c "
import json, sys
try:
    with open('${FLOWS_FILE}', 'r') as f:
        flows = json.load(f)
    count = 0
    for node in flows:
        if node.get('type') == 'tab' and isinstance(node.get('env'), list):
            for env in node['env']:
                if env.get('name') == 'FARM_ID':
                    env['value'] = 'UNSET'
                    count += 1
    with open('${FLOWS_FILE}', 'w') as f:
        json.dump(flows, f)
    print(f'  flows.json FARM_ID → UNSET ({count}개 탭)')
except Exception as e:
    print(f'  flows.json 수정 실패: {e}', file=sys.stderr)
"
fi

# ── 2.5. AWS IoT 인증서 초기화 ──
echo "[2.5/6] AWS IoT 인증서 초기화"
rm -f "${SMARTFARM_HOME}/certs/certificate.pem.crt"
rm -f "${SMARTFARM_HOME}/certs/private.pem.key"
echo "  인증서 삭제 완료 (setup 시 서버에서 다운로드)"

# ── 3. SQLite DB 초기화 ──
# 이전 농장의 센서 데이터 삭제
echo "[3/6] 로컬 DB 초기화"

SQLITE_DB="${SMARTFARM_HOME}/.node-red/smartfarm.db"
if [ -f "$SQLITE_DB" ]; then
  sudo -u "$SMARTFARM_USER" sqlite3 "$SQLITE_DB" "DELETE FROM sensor_data;" 2>/dev/null || true
  sudo -u "$SMARTFARM_USER" sqlite3 "$SQLITE_DB" "VACUUM;" 2>/dev/null || true
  echo "  smartfarm.db 센서 데이터 삭제"
fi

# ── 4. Node-RED credential/context 초기화 ──
echo "[4/6] Node-RED context 초기화"

# context 파일 삭제 (global context 포함)
rm -rf "${SMARTFARM_HOME}/.node-red/context/" 2>/dev/null || true
mkdir -p "${SMARTFARM_HOME}/.node-red/context/"
chown "${SMARTFARM_USER}:${SMARTFARM_USER}" "${SMARTFARM_HOME}/.node-red/context/"

# ── 5. machine-id 재생성 ──
echo "[5/6] machine-id 재생성"
rm -f /etc/machine-id /var/lib/dbus/machine-id
systemd-machine-id-setup 2>/dev/null || dbus-uuidgen --ensure

# ── 6. PM2 서비스 시작 ──
echo "[6/6] PM2 서비스 시작"

# Node-RED 시작
sudo -u "$SMARTFARM_USER" bash -c "
  pm2 delete all 2>/dev/null || true
  pm2 start node-red -- -s ~/smartfarm/node-red/settings.js
  pm2 start ~/smartfarm/rpi-server/src/system-server.js --name smartfarm-system
  pm2 save
"

# PM2 startup (재부팅 시 자동 시작)
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$SMARTFARM_USER" --hp "$SMARTFARM_HOME" 2>/dev/null || true

# ── 트리거 파일 삭제 (다음 부팅에서는 실행 안 됨) ──
rm -f "$PENDING_FILE"

echo ""
echo "=== First Boot 완료: $(date) ==="
echo ""
echo "이 RPi는 설정 대기 상태입니다."
echo "브라우저에서 http://$(hostname -I | awk '{print $1}')/setup 접속하여"
echo "장비 코드를 입력하세요."
echo ""
