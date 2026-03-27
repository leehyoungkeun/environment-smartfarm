#!/bin/bash
# ============================================================
# SmartFarm RPi 표준 이미지 프로비저닝 스크립트
#
# 사용법:
#   curl -sL https://raw.githubusercontent.com/.../provision.sh | bash
#   또는 로컬에서:
#   chmod +x provision.sh && sudo ./provision.sh
#
# 지원 플랫폼: RPi 3B/3B+ | RPi 4B | RPi 5
# OS: Raspberry Pi OS (Bookworm 64-bit 권장, RPi 3은 32-bit)
# ============================================================

set -euo pipefail

# ── 색상 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $1"; }

# ── root 확인 ──
if [ "$EUID" -ne 0 ]; then
  err "root 권한 필요: sudo ./provision.sh"
fi

SMARTFARM_USER="${SUDO_USER:-lhk}"
SMARTFARM_HOME="/home/${SMARTFARM_USER}"

echo ""
echo "=========================================="
echo "  🌱 SmartFarm RPi 프로비저닝"
echo "=========================================="
echo ""

# ── RPi 모델 감지 ──
detect_model() {
  local model_str
  model_str=$(cat /proc/device-tree/model 2>/dev/null || echo "unknown")

  if echo "$model_str" | grep -qi "raspberry pi 5"; then
    RPI_MODEL="5"
    RPI_ARCH="aarch64"
  elif echo "$model_str" | grep -qi "raspberry pi 4"; then
    RPI_MODEL="4"
    RPI_ARCH="aarch64"
  elif echo "$model_str" | grep -qi "raspberry pi 3"; then
    RPI_MODEL="3"
    # RPi 3는 32-bit OS도 가능
    if [ "$(uname -m)" = "aarch64" ]; then
      RPI_ARCH="aarch64"
    else
      RPI_ARCH="armv7l"
    fi
  else
    warn "RPi 모델 감지 실패: ${model_str}"
    RPI_MODEL="unknown"
    RPI_ARCH=$(uname -m)
  fi

  info "모델: Raspberry Pi ${RPI_MODEL} (${RPI_ARCH})"
  info "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
  info "커널: $(uname -r)"
  info "사용자: ${SMARTFARM_USER}"
}

detect_model

# ── RPi 3 스왑 설정 ──
if [ "$RPI_MODEL" = "3" ]; then
  info "RPi 3 감지: 스왑 512MB 설정"
  if [ -f /etc/dphys-swapfile ]; then
    sed -i 's/CONF_SWAPSIZE=100/CONF_SWAPSIZE=512/' /etc/dphys-swapfile
    systemctl restart dphys-swapfile 2>/dev/null || true
    log "스왑 512MB 설정 완료"
  fi
  # GPU 메모리 축소 (RAM 확보)
  if ! grep -q "gpu_mem=16" /boot/config.txt 2>/dev/null; then
    echo "gpu_mem=16" >> /boot/config.txt
    log "GPU 메모리 16MB로 축소"
  fi
fi

# ── Node.js 버전 결정 ──
# RPi 3 (armv7l): Node.js 20 LTS
# RPi 4/5 (aarch64): Node.js 20 LTS
NODE_MAJOR=20

# ── 1. 시스템 패키지 설치 ──
echo ""
info "=== 1/8: 시스템 패키지 설치 ==="

# DNS 확인 및 설정
if ! ping -c 1 -W 3 google.com &>/dev/null; then
  warn "DNS 실패, 8.8.8.8 설정"
  echo "nameserver 8.8.8.8" > /etc/resolv.conf
fi

apt-get update -qq
apt-get install -y -qq \
  curl wget git \
  nginx \
  sqlite3 \
  build-essential \
  python3 \
  usbutils \
  > /dev/null 2>&1

log "시스템 패키지 설치 완료"

# ── 2. Node.js 설치 ──
info "=== 2/8: Node.js ${NODE_MAJOR}.x 설치 ==="

CURRENT_NODE=$(node -v 2>/dev/null || echo "none")
if echo "$CURRENT_NODE" | grep -q "v${NODE_MAJOR}"; then
  log "Node.js ${CURRENT_NODE} 이미 설치됨"
else
  # NodeSource 공식 설치
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  log "Node.js $(node -v) 설치 완료"
fi

# npm 최신
npm install -g npm@latest > /dev/null 2>&1

# ── 3. Node-RED + PM2 설치 ──
info "=== 3/8: Node-RED + PM2 설치 ==="

# PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 > /dev/null 2>&1
  log "PM2 설치 완료"
else
  log "PM2 이미 설치됨"
fi

# Node-RED
if ! command -v node-red &>/dev/null; then
  npm install -g --unsafe-perm node-red > /dev/null 2>&1
  log "Node-RED 설치 완료"
else
  log "Node-RED 이미 설치됨 ($(node-red --version 2>/dev/null || echo '?'))"
fi

# ── 4. 디렉토리 구조 생성 ──
info "=== 4/8: 디렉토리 구조 생성 ==="

sudo -u "$SMARTFARM_USER" bash -c "
  mkdir -p ~/smartfarm/node-red
  mkdir -p ~/smartfarm/rpi-server/src
  mkdir -p ~/smartfarm/rpi-server/database
  mkdir -p ~/smartfarm/shared
  mkdir -p ~/smartfarm/logs
  mkdir -p ~/smartfarm-frontend
  mkdir -p ~/.node-red/node_modules
  mkdir -p ~/.config/autostart
"

log "디렉토리 구조 생성 완료"

# ── 5. Node-RED Modbus 모듈 설치 ──
info "=== 5/8: Node-RED 모듈 설치 ==="

sudo -u "$SMARTFARM_USER" bash -c "
  cd ~/.node-red
  npm install --save \
    node-red-contrib-modbus \
    node-red-node-sqlite \
    > /dev/null 2>&1
"

log "Node-RED 모듈 (modbus, sqlite) 설치 완료"

# ── 6. nginx 설정 ──
info "=== 6/8: nginx 설정 ==="

cat > /etc/nginx/sites-available/smartfarm << 'NGINX_CONF'
server {
    listen 80 default_server;
    server_name _;

    # 프론트엔드 (터치패널 키오스크)
    root /home/lhk/smartfarm-frontend;
    index index.html;

    # SPA 라우팅
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Node-RED API 프록시
    location /api/ {
        proxy_pass http://localhost:1880/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 초기 설정 페이지 프록시
    location /setup {
        proxy_pass http://localhost:3100/setup;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 시스템 API 프록시
    location /api/system/ {
        proxy_pass http://localhost:3100/api/system/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
NGINX_CONF

# 기본 사이트 제거, smartfarm 활성화
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/smartfarm /etc/nginx/sites-enabled/smartfarm

# nginx 권한 (중요!)
chmod 755 "${SMARTFARM_HOME}"

nginx -t > /dev/null 2>&1 && systemctl restart nginx
log "nginx 설정 완료"

# ── 6.5. AWS IoT 루트 CA 인증서 ──
info "AWS IoT 루트 CA 인증서 다운로드"
mkdir -p "${SMARTFARM_HOME}/certs"
curl -s https://www.amazontrust.com/repository/AmazonRootCA1.pem -o "${SMARTFARM_HOME}/certs/AmazonRootCA1.pem"
chown -R "${SMARTFARM_USER}:${SMARTFARM_USER}" "${SMARTFARM_HOME}/certs"
log "AmazonRootCA1.pem 저장 완료"

# ── 7. system-api + setup 서버 통합 ──
info "=== 7/8: SmartFarm 시스템 서비스 설정 ==="

# rpi-server/src 에 설치 기사용 setup.js, system-api.js 복사
# (이 파일들은 provision 전에 rpi-files/ 에서 복사해둬야 함)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/setup.js" ]; then
  cp "${SCRIPT_DIR}/setup.js" "${SMARTFARM_HOME}/smartfarm/rpi-server/src/setup.js"
  log "setup.js 복사 완료"
fi

if [ -f "${SCRIPT_DIR}/system-api.js" ]; then
  cp "${SCRIPT_DIR}/system-api.js" "${SMARTFARM_HOME}/smartfarm/rpi-server/src/system-api.js"
  log "system-api.js 복사 완료"
fi

# smartfarm-system 통합 서버 (setup + system-api)
cat > "${SMARTFARM_HOME}/smartfarm/rpi-server/src/system-server.js" << 'SYSTEM_SERVER'
/**
 * SmartFarm 시스템 서버 (포트 3100)
 * - /setup — 초기 설정 페이지 (장비 코드 입력)
 * - /api/system/* — PM2 프로세스 관리
 */
const express = require('express');
const app = express();
const PORT = 3100;

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 초기 설정 라우트
const setupRouter = require('./setup');
app.use('/setup', setupRouter);

// 시스템 관리 API
const { exec } = require('child_process');

function getPm2Status(name) {
  return new Promise(resolve => {
    exec('pm2 jlist', (err, stdout) => {
      if (err) return resolve(null);
      try {
        const list = JSON.parse(stdout);
        const proc = list.find(p => p.name === name);
        if (proc) {
          resolve({
            name: proc.name,
            status: proc.pm2_env.status,
            uptime: proc.pm2_env.pm_uptime,
            restarts: proc.pm2_env.restart_time,
            memory: proc.monit ? proc.monit.memory : 0,
            cpu: proc.monit ? proc.monit.cpu : 0
          });
        } else resolve(null);
      } catch { resolve(null); }
    });
  });
}

function restartPm2(name) {
  return new Promise(resolve => {
    exec('pm2 restart ' + name, (err, stdout) => {
      resolve(err ? { success: false, error: err.message } : { success: true, output: stdout.trim() });
    });
  });
}

app.get('/api/system/status', async (req, res) => {
  const [nodeRed, rpiExpress] = await Promise.all([
    getPm2Status('node-red'),
    getPm2Status('smartfarm-rpi')
  ]);
  res.json({ nodeRed, rpiExpress, timestamp: new Date().toISOString() });
});

app.post('/api/system/restart-nodered', async (req, res) => {
  const result = await restartPm2('node-red');
  res.status(result.success ? 200 : 500).json(result);
});

app.post('/api/system/restart-express', async (req, res) => {
  const result = await restartPm2('smartfarm-rpi');
  res.status(result.success ? 200 : 500).json(result);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[smartfarm-system] listening on port ${PORT}`);
});
SYSTEM_SERVER

# rpi-server package.json (없으면 생성)
if [ ! -f "${SMARTFARM_HOME}/smartfarm/rpi-server/package.json" ]; then
  cat > "${SMARTFARM_HOME}/smartfarm/rpi-server/package.json" << 'PKG_JSON'
{
  "name": "smartfarm-rpi-server",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "express": "^4.18.2",
    "node-fetch": "^2.7.0"
  }
}
PKG_JSON
fi

# npm install
sudo -u "$SMARTFARM_USER" bash -c "
  cd ~/smartfarm/rpi-server && npm install > /dev/null 2>&1
"

log "시스템 서비스 설정 완료"

# ── 8. first-boot 서비스 등록 ──
info "=== 8/8: first-boot 서비스 등록 ==="

if [ -f "${SCRIPT_DIR}/first-boot.sh" ]; then
  cp "${SCRIPT_DIR}/first-boot.sh" "${SMARTFARM_HOME}/smartfarm/first-boot.sh"
  chmod +x "${SMARTFARM_HOME}/smartfarm/first-boot.sh"

  cat > /etc/systemd/system/smartfarm-firstboot.service << SYSTEMD_UNIT
[Unit]
Description=SmartFarm First Boot Setup
After=network-online.target
Wants=network-online.target
ConditionPathExists=${SMARTFARM_HOME}/smartfarm/.first-boot-pending

[Service]
Type=oneshot
ExecStart=${SMARTFARM_HOME}/smartfarm/first-boot.sh
User=root
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SYSTEMD_UNIT

  systemctl daemon-reload
  systemctl enable smartfarm-firstboot.service

  # first-boot 트리거 파일 생성
  touch "${SMARTFARM_HOME}/smartfarm/.first-boot-pending"

  log "first-boot 서비스 등록 완료"
else
  warn "first-boot.sh 없음, first-boot 서비스 스킵"
fi

# ── 파일 소유권 복구 ──
chown -R "${SMARTFARM_USER}:${SMARTFARM_USER}" "${SMARTFARM_HOME}/smartfarm"
chown -R "${SMARTFARM_USER}:${SMARTFARM_USER}" "${SMARTFARM_HOME}/.node-red"
chown -R "${SMARTFARM_USER}:${SMARTFARM_USER}" "${SMARTFARM_HOME}/smartfarm-frontend"

# ── 완료 리포트 ──
echo ""
echo "=========================================="
echo "  🎉 프로비저닝 완료!"
echo "=========================================="
echo ""
echo "  RPi 모델:    ${RPI_MODEL} (${RPI_ARCH})"
echo "  Node.js:     $(node -v)"
echo "  Node-RED:    $(node-red --version 2>/dev/null || echo 'installed')"
echo "  PM2:         $(pm2 -v 2>/dev/null || echo 'installed')"
echo "  nginx:       $(nginx -v 2>&1 | cut -d'/' -f2)"
echo ""
echo "  다음 단계:"
echo "  1. 1호 RPi에서 flows.json, settings.js 복사"
echo "  2. 프론트엔드 빌드 파일 복사"
echo "  3. first-boot.sh 확인"
echo "  4. PM2 서비스 등록 (아래 명령 실행)"
echo ""
echo "  # PM2로 서비스 시작:"
echo "  sudo -u ${SMARTFARM_USER} pm2 start node-red -- -s ~/smartfarm/node-red/settings.js"
echo "  sudo -u ${SMARTFARM_USER} pm2 start ~/smartfarm/rpi-server/src/system-server.js --name smartfarm-system"
echo "  sudo -u ${SMARTFARM_USER} pm2 save"
echo "  sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ${SMARTFARM_USER} --hp ${SMARTFARM_HOME}"
echo ""
echo "  5. SD카드 이미지 생성 (이미지 가이드 참조)"
echo "=========================================="
