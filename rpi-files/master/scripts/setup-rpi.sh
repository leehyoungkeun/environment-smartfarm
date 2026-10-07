#!/bin/bash
# ==============================================================================
# 스마트팜 RPi 초기 설정 스크립트
# 라즈베리파이 4에서 최초 1회 실행하여 환경을 구성합니다.
# 사용법: sudo bash setup-rpi.sh
# ==============================================================================

set -e  # 오류 발생 시 즉시 중단

# ── 색상 정의 ──────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 색상 초기화

# ── 실행 권한 확인 ─────────────────────────────
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[오류] 이 스크립트는 root 권한으로 실행해야 합니다.${NC}"
    echo -e "${YELLOW}       sudo bash setup-rpi.sh${NC}"
    exit 1
fi

# 실제 사용자 확인 (sudo로 실행된 경우 원래 사용자)
ACTUAL_USER="${SUDO_USER:-pi}"
ACTUAL_HOME=$(eval echo "~$ACTUAL_USER")

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}   스마트팜 RPi 초기 설정 스크립트${NC}"
echo -e "${BLUE}============================================${NC}"
echo -e "  사용자: ${GREEN}${ACTUAL_USER}${NC}"
echo -e "  홈 디렉토리: ${GREEN}${ACTUAL_HOME}${NC}"
echo ""

# ── 1. 시스템 패키지 업데이트 ──────────────────────
echo -e "${YELLOW}[1/7] 시스템 패키지 업데이트 중...${NC}"

apt-get update -y
apt-get upgrade -y

echo -e "${GREEN}[완료] 시스템 패키지 업데이트 완료${NC}"
echo ""

# ── 2. Node.js 20 LTS 설치 ────────────────────────
echo -e "${YELLOW}[2/7] Node.js 20 LTS 설치 중...${NC}"

# 기존 Node.js 버전 확인
if command -v node &> /dev/null; then
    CURRENT_NODE=$(node -v)
    echo -e "  기존 Node.js 버전: ${YELLOW}${CURRENT_NODE}${NC}"
fi

# NodeSource 저장소 추가 및 Node.js 20 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 설치 확인
NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
echo -e "  Node.js: ${GREEN}${NODE_VERSION}${NC}"
echo -e "  npm: ${GREEN}v${NPM_VERSION}${NC}"

echo -e "${GREEN}[완료] Node.js 20 LTS 설치 완료${NC}"
echo ""

# ── 3. PM2 전역 설치 ──────────────────────────────
echo -e "${YELLOW}[3/7] PM2 전역 설치 중...${NC}"

npm install -g pm2

PM2_VERSION=$(pm2 -v)
echo -e "  PM2: ${GREEN}v${PM2_VERSION}${NC}"

echo -e "${GREEN}[완료] PM2 설치 완료${NC}"
echo ""

# ── 4. Node-RED 전역 설치 ─────────────────────────
echo -e "${YELLOW}[4/7] Node-RED 전역 설치 중...${NC}"

npm install -g --unsafe-perm node-red

# Node-RED 추가 노드 설치 (MQTT, 대시보드 등)
NODERED_DIR="$ACTUAL_HOME/.node-red"
sudo -u "$ACTUAL_USER" mkdir -p "$NODERED_DIR"

# Node-RED 사용자 디렉토리에서 추가 노드 설치
cd "$NODERED_DIR"
sudo -u "$ACTUAL_USER" npm install --save \
    node-red-dashboard \
    node-red-contrib-modbus \
    2>/dev/null || echo -e "${YELLOW}  [알림] 일부 Node-RED 추가 노드 설치 생략 (수동 설치 필요할 수 있음)${NC}"

NODERED_VERSION=$(node-red --version 2>/dev/null || echo "확인 불가")
echo -e "  Node-RED: ${GREEN}${NODERED_VERSION}${NC}"

echo -e "${GREEN}[완료] Node-RED 설치 완료${NC}"
echo ""

# ── 5. 프로젝트 디렉토리 생성 ─────────────────────
echo -e "${YELLOW}[5/7] 프로젝트 디렉토리 생성 중...${NC}"

# 스마트팜 프로젝트 디렉토리
SMARTFARM_DIR="$ACTUAL_HOME/smartfarm"
mkdir -p "$SMARTFARM_DIR"
chown "$ACTUAL_USER:$ACTUAL_USER" "$SMARTFARM_DIR"

# AWS IoT 인증서 디렉토리
CERTS_DIR="$ACTUAL_HOME/certs"
mkdir -p "$CERTS_DIR"
chown "$ACTUAL_USER:$ACTUAL_USER" "$CERTS_DIR"
chmod 700 "$CERTS_DIR"

# 로그 디렉토리
LOG_DIR="$ACTUAL_HOME/smartfarm/logs"
mkdir -p "$LOG_DIR"
chown "$ACTUAL_USER:$ACTUAL_USER" "$LOG_DIR"

# 데이터베이스 디렉토리
DATA_DIR="$ACTUAL_HOME/smartfarm/data"
mkdir -p "$DATA_DIR"
chown "$ACTUAL_USER:$ACTUAL_USER" "$DATA_DIR"

echo -e "  프로젝트: ${GREEN}${SMARTFARM_DIR}${NC}"
echo -e "  인증서:   ${GREEN}${CERTS_DIR}${NC}"
echo -e "  로그:     ${GREEN}${LOG_DIR}${NC}"
echo -e "  데이터:   ${GREEN}${DATA_DIR}${NC}"

echo -e "${GREEN}[완료] 디렉토리 생성 완료${NC}"
echo ""

# ── 6. 프로젝트 파일 복사 ─────────────────────────
echo -e "${YELLOW}[6/7] 프로젝트 파일 복사 중...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# rpi-server 복사
if [ -d "$SOURCE_DIR/rpi-server" ]; then
    cp -r "$SOURCE_DIR/rpi-server" "$SMARTFARM_DIR/"
    echo -e "  rpi-server: ${GREEN}복사 완료${NC}"
else
    echo -e "  rpi-server: ${YELLOW}소스 디렉토리 없음 (수동 복사 필요)${NC}"
fi

# frontend 복사
if [ -d "$SOURCE_DIR/frontend" ]; then
    cp -r "$SOURCE_DIR/frontend" "$SMARTFARM_DIR/"
    echo -e "  frontend: ${GREEN}복사 완료${NC}"
else
    echo -e "  frontend: ${YELLOW}소스 디렉토리 없음 (수동 복사 필요)${NC}"
fi

# shared 모듈 복사
if [ -d "$SOURCE_DIR/shared" ]; then
    cp -r "$SOURCE_DIR/shared" "$SMARTFARM_DIR/"
    echo -e "  shared: ${GREEN}복사 완료${NC}"
else
    echo -e "  shared: ${YELLOW}소스 디렉토리 없음 (수동 복사 필요)${NC}"
fi

# scripts 복사
if [ -d "$SOURCE_DIR/scripts" ]; then
    cp -r "$SOURCE_DIR/scripts" "$SMARTFARM_DIR/"
    echo -e "  scripts: ${GREEN}복사 완료${NC}"
fi

# node-red 설정 복사
if [ -d "$SOURCE_DIR/node-red" ]; then
    cp -r "$SOURCE_DIR/node-red" "$SMARTFARM_DIR/"
    echo -e "  node-red: ${GREEN}복사 완료${NC}"
fi

# 소유권 설정
chown -R "$ACTUAL_USER:$ACTUAL_USER" "$SMARTFARM_DIR"

echo -e "${GREEN}[완료] 프로젝트 파일 복사 완료${NC}"
echo ""

# ── 7. systemd 서비스 등록 (PM2 대안) ──────────────
echo -e "${YELLOW}[7/7] systemd 서비스 설정 중...${NC}"

# PM2 systemd 서비스 자동 생성
sudo -u "$ACTUAL_USER" pm2 startup systemd -u "$ACTUAL_USER" --hp "$ACTUAL_HOME" 2>/dev/null || {
    # PM2가 출력하는 명령어를 자동 실행
    PM2_STARTUP_CMD=$(sudo -u "$ACTUAL_USER" pm2 startup systemd -u "$ACTUAL_USER" --hp "$ACTUAL_HOME" 2>&1 | grep "sudo" | tail -1)
    if [ -n "$PM2_STARTUP_CMD" ]; then
        eval "$PM2_STARTUP_CMD" 2>/dev/null || true
    fi
}

echo -e "${GREEN}[완료] systemd 서비스 설정 완료${NC}"
echo ""

# ── 네트워크/WiFi 설정 안내 ───────────────────────
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}   초기 설정 완료!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "${YELLOW}[다음 단계]${NC}"
echo ""
echo -e "  1. 환경변수 파일 생성:"
echo -e "     ${GREEN}cp $SMARTFARM_DIR/rpi-server/.env.example $SMARTFARM_DIR/rpi-server/.env${NC}"
echo -e "     ${GREEN}nano $SMARTFARM_DIR/rpi-server/.env${NC}"
echo ""
echo -e "  2. AWS IoT 인증서를 복사:"
echo -e "     ${GREEN}scp certificate.pem.crt pi@<RPi-IP>:~/certs/${NC}"
echo -e "     ${GREEN}scp private.pem.key pi@<RPi-IP>:~/certs/${NC}"
echo -e "     ${GREEN}scp AmazonRootCA1.pem pi@<RPi-IP>:~/certs/${NC}"
echo ""
echo -e "  3. 배포 스크립트 실행:"
echo -e "     ${GREEN}cd $SMARTFARM_DIR && bash scripts/deploy-rpi.sh${NC}"
echo ""
echo -e "${YELLOW}[WiFi 설정 (필요 시)]${NC}"
echo -e "  ${GREEN}sudo nmcli dev wifi connect <SSID> password <PASSWORD>${NC}"
echo -e "  또는"
echo -e "  ${GREEN}sudo raspi-config${NC} → System Options → Wireless LAN"
echo ""
echo -e "${YELLOW}[고정 IP 설정 (필요 시)]${NC}"
echo -e "  ${GREEN}sudo nmcli con mod <연결명> ipv4.addresses <IP>/24 ipv4.gateway <게이트웨이> ipv4.method manual${NC}"
echo ""
