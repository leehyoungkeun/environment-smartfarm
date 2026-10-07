#!/bin/bash
# ==============================================================================
# 스마트팜 RPi 배포 스크립트
# 라즈베리파이에서 rpi-server + Node-RED 를 배포합니다.
# 사용법: bash deploy-rpi.sh
# ==============================================================================

set -e  # 오류 발생 시 즉시 중단

# ── 색상 정의 ──────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 색상 초기화

# ── 프로젝트 경로 설정 ────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RPI_SERVER_DIR="$PROJECT_DIR/rpi-server"
FRONTEND_DIR="$PROJECT_DIR/frontend"
SHARED_DIR="$PROJECT_DIR/shared"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}   스마트팜 RPi 배포 스크립트${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# ── 1. 필수 도구 확인 ──────────────────────────────
echo -e "${YELLOW}[1/7] 필수 도구 확인 중...${NC}"

# Node.js 확인
if ! command -v node &> /dev/null; then
    echo -e "${RED}[오류] Node.js가 설치되어 있지 않습니다.${NC}"
    echo -e "${RED}       먼저 setup-rpi.sh 를 실행하세요.${NC}"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "  Node.js: ${GREEN}${NODE_VERSION}${NC}"

# npm 확인
if ! command -v npm &> /dev/null; then
    echo -e "${RED}[오류] npm이 설치되어 있지 않습니다.${NC}"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo -e "  npm: ${GREEN}v${NPM_VERSION}${NC}"

# PM2 확인
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}[오류] PM2가 설치되어 있지 않습니다.${NC}"
    echo -e "${YELLOW}       설치 중: npm install -g pm2${NC}"
    sudo npm install -g pm2
fi
PM2_VERSION=$(pm2 -v)
echo -e "  PM2: ${GREEN}v${PM2_VERSION}${NC}"

echo -e "${GREEN}[완료] 필수 도구 확인 완료${NC}"
echo ""

# ── 2. RPi 서버 의존성 설치 ────────────────────────
echo -e "${YELLOW}[2/7] RPi 서버 의존성 설치 중...${NC}"

cd "$RPI_SERVER_DIR"
npm ci --production
echo -e "${GREEN}[완료] RPi 서버 의존성 설치 완료${NC}"
echo ""

# ── 3. 프론트엔드 빌드 ────────────────────────────
echo -e "${YELLOW}[3/7] 프론트엔드 빌드 중...${NC}"

cd "$FRONTEND_DIR"
npm install
npm run build

# 빌드 결과물 확인
if [ ! -d "$FRONTEND_DIR/dist" ]; then
    echo -e "${RED}[오류] 프론트엔드 빌드 실패: dist 디렉토리가 생성되지 않았습니다.${NC}"
    exit 1
fi
echo -e "${GREEN}[완료] 프론트엔드 빌드 완료${NC}"
echo ""

# ── 4. 프론트엔드 빌드 결과물을 rpi-server/public으로 복사 ──
echo -e "${YELLOW}[4/7] 프론트엔드 파일을 rpi-server/public으로 복사 중...${NC}"

# 기존 public 디렉토리 제거 후 복사
rm -rf "$RPI_SERVER_DIR/public"
cp -r "$FRONTEND_DIR/dist" "$RPI_SERVER_DIR/public"

FILE_COUNT=$(find "$RPI_SERVER_DIR/public" -type f | wc -l)
echo -e "  복사된 파일 수: ${GREEN}${FILE_COUNT}개${NC}"
echo -e "${GREEN}[완료] 프론트엔드 파일 복사 완료${NC}"
echo ""

# ── 5. SQLite 데이터베이스 초기화 ──────────────────
echo -e "${YELLOW}[5/7] SQLite 데이터베이스 초기화 중...${NC}"

# 데이터 디렉토리 생성
mkdir -p "$RPI_SERVER_DIR/data"

# 데이터베이스 초기화 스크립트 실행
cd "$RPI_SERVER_DIR"
node database/init.js

echo -e "${GREEN}[완료] SQLite 데이터베이스 초기화 완료${NC}"
echo ""

# ── 6. PM2 프로세스 설정 및 시작 ────────────────────
echo -e "${YELLOW}[6/7] PM2 프로세스 설정 중...${NC}"

# 기존 프로세스 중지 (오류 무시)
pm2 delete smartfarm-rpi 2>/dev/null || true
pm2 delete node-red 2>/dev/null || true

# ecosystem 설정 파일로 시작
cd "$SCRIPT_DIR"
pm2 start ecosystem.config.js

echo -e "${GREEN}[완료] PM2 프로세스 시작 완료${NC}"
echo ""

# ── 7. PM2 부팅 시 자동 시작 설정 ──────────────────
echo -e "${YELLOW}[7/7] PM2 부팅 시 자동 시작 설정 중...${NC}"

# 현재 프로세스 목록 저장
pm2 save

# 부팅 시 자동 시작 설정 (systemd)
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || {
    echo -e "${YELLOW}  [알림] PM2 startup 명령 실행이 필요할 수 있습니다.${NC}"
    echo -e "${YELLOW}  아래 명령을 수동으로 실행하세요:${NC}"
    pm2 startup
}

echo -e "${GREEN}[완료] PM2 자동 시작 설정 완료${NC}"
echo ""

# ── 배포 결과 출력 ────────────────────────────────
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}   배포 완료!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "  RPi 서버:   ${GREEN}http://localhost:3001${NC}"
echo -e "  Node-RED:   ${GREEN}http://localhost:1880/node-red${NC}"
echo ""

# PM2 상태 출력
echo -e "${YELLOW}[PM2 프로세스 상태]${NC}"
pm2 status

echo ""
echo -e "${YELLOW}유용한 명령어:${NC}"
echo -e "  pm2 logs             - 전체 로그 확인"
echo -e "  pm2 logs smartfarm-rpi - RPi 서버 로그"
echo -e "  pm2 logs node-red    - Node-RED 로그"
echo -e "  pm2 restart all      - 전체 재시작"
echo -e "  pm2 monit            - 실시간 모니터링"
echo ""
