# SmartFarm RPi 표준 이미지 제작 가이드

## 개요

RPi 3/4/5 각 플랫폼별 표준 SD카드 이미지를 제작하는 절차입니다.
한번 만들면 새 농장마다 이미지만 구워서 장비 코드만 입력하면 됩니다.

```
[표준 이미지 제작 (1회)]          [농장 배포 (N회)]

RPi OS 설치                      이미지 → SD카드 굽기
  ↓                                ↓
provision.sh 실행                 RPi 부팅 (first-boot 자동 실행)
  ↓                                ↓
1호에서 플로우/설정 복사           브라우저에서 /setup 접속
  ↓                                ↓
PM2 등록 + 테스트                 장비 코드 입력
  ↓                                ↓
clone-image.sh 실행               설치 완료!
  ↓
SD카드 → .img 파일 저장
```

---

## 1. 플랫폼별 RPi OS 선택

| 플랫폼 | RPi OS 버전 | 아키텍처 | 비고 |
|--------|------------|---------|------|
| RPi 5 | Bookworm 64-bit | aarch64 | 개발용 |
| RPi 4 | Bookworm 64-bit | aarch64 | 양산 메인 (4GB/8GB) |
| RPi 3B+ | Bookworm 32-bit | armv7l | 저가형 (1GB RAM) |

### RPi 3 주의사항
- **메모리 1GB** → Node-RED + PM2 + nginx 동시 실행 시 스왑 필요
- **32-bit OS 사용** → 64-bit도 가능하나 메모리 효율이 떨어짐
- Node.js 20.x는 armv7l 지원 (문제 없음)

### 스왑 설정 (RPi 3 전용)
```bash
# /etc/dphys-swapfile 수정
sudo sed -i 's/CONF_SWAPSIZE=100/CONF_SWAPSIZE=512/' /etc/dphys-swapfile
sudo systemctl restart dphys-swapfile
```

---

## 2. RPi OS 설치

### Raspberry Pi Imager 사용
1. [Raspberry Pi Imager](https://www.raspberrypi.com/software/) 다운로드
2. OS 선택: Raspberry Pi OS (해당 아키텍처)
3. **설정 (톱니바퀴)** 에서:
   - 호스트명: `smartfarm`
   - SSH 활성화: 비밀번호 인증
   - 사용자: `lhk` / 비밀번호 설정
   - WiFi: 사무실 WiFi (임시, 현장에서 변경)
   - 로케일: Asia/Seoul, kr
4. SD카드에 굽기

### 첫 부팅
```bash
# SSH 접속
ssh lhk@<RPi-IP>

# 기본 확인
uname -m          # aarch64 또는 armv7l
cat /proc/device-tree/model   # RPi 모델 확인
free -h           # 메모리 확인
```

---

## 3. 프로비저닝 (provision.sh)

### 스크립트 전송 및 실행
```bash
# PC에서 RPi로 스크립트 전송
scp rpi-files/provision.sh lhk@<RPi-IP>:~/provision.sh
scp rpi-files/first-boot.sh lhk@<RPi-IP>:~/first-boot.sh
scp rpi-files/clone-image.sh lhk@<RPi-IP>:~/clone-image.sh
scp rpi-files/setup.js lhk@<RPi-IP>:~/setup.js
scp rpi-files/system-api.js lhk@<RPi-IP>:~/system-api.js

# RPi에서 실행
ssh lhk@<RPi-IP>
sudo ./provision.sh
```

### provision.sh가 하는 일
1. RPi 모델 자동 감지 (3/4/5)
2. 시스템 패키지 설치 (nginx, sqlite3, build-essential)
3. Node.js 20.x 설치
4. Node-RED + PM2 전역 설치
5. Node-RED 모듈 설치 (modbus, sqlite)
6. nginx 설정 (프론트엔드 + API 프록시)
7. 시스템 서버 설정 (setup + system-api)
8. first-boot 서비스 등록

### 소요 시간
| 플랫폼 | 예상 시간 | 병목 |
|--------|----------|------|
| RPi 5 | 5~8분 | npm install |
| RPi 4 | 8~12분 | npm install |
| RPi 3 | 15~25분 | npm install (CPU/RAM 제한) |

---

## 4. 1호에서 플로우/설정 복사

프로비저닝 후, 1호 RPi(192.168.137.30)에서 검증된 파일을 복사합니다.

### 4.1 Node-RED 플로우 + 설정

```bash
# 1호 → PC 임시 폴더
scp lhk@192.168.137.30:~/.node-red/flows.json /tmp/flows.json
scp lhk@192.168.137.30:~/smartfarm/node-red/settings.js /tmp/settings.js

# PC → 새 RPi
scp /tmp/flows.json lhk@<NEW-IP>:~/.node-red/flows.json
scp /tmp/settings.js lhk@<NEW-IP>:~/smartfarm/node-red/settings.js
```

### 4.2 프론트엔드 빌드

```bash
# PC에서 RPi용 빌드 생성
cd frontend
npx vite build --mode rpi

# 빌드 결과물 전송
scp -r dist/* lhk@<NEW-IP>:~/smartfarm-frontend/
```

### 4.3 rpi-server 소스

```bash
# 1호에서 가져오기
scp -r lhk@192.168.137.30:~/smartfarm/rpi-server/src/ /tmp/rpi-src/
scp -r lhk@192.168.137.30:~/smartfarm/rpi-server/database/ /tmp/rpi-database/
scp lhk@192.168.137.30:~/smartfarm/rpi-server/package.json /tmp/rpi-package.json
scp -r lhk@192.168.137.30:~/smartfarm/shared/ /tmp/smartfarm-shared/

# 새 RPi로 보내기
scp -r /tmp/rpi-src/* lhk@<NEW-IP>:~/smartfarm/rpi-server/src/
scp -r /tmp/rpi-database/* lhk@<NEW-IP>:~/smartfarm/rpi-server/database/
scp /tmp/rpi-package.json lhk@<NEW-IP>:~/smartfarm/rpi-server/package.json
scp -r /tmp/smartfarm-shared/* lhk@<NEW-IP>:~/smartfarm/shared/

# 새 RPi에서 npm install
ssh lhk@<NEW-IP> "cd ~/smartfarm/rpi-server && npm install"
```

### 4.4 키오스크 (터치패널용)

```bash
scp lhk@192.168.137.30:~/kiosk.sh /tmp/kiosk.sh
scp lhk@192.168.137.30:~/.config/autostart/kiosk.desktop /tmp/kiosk.desktop

scp /tmp/kiosk.sh lhk@<NEW-IP>:~/kiosk.sh
scp /tmp/kiosk.desktop lhk@<NEW-IP>:~/.config/autostart/kiosk.desktop
ssh lhk@<NEW-IP> "chmod +x ~/kiosk.sh"
```

---

## 5. PM2 서비스 등록 + 테스트

```bash
ssh lhk@<NEW-IP>

# PM2 서비스 시작
pm2 start node-red -- -s ~/smartfarm/node-red/settings.js
pm2 start ~/smartfarm/rpi-server/src/system-server.js --name smartfarm-system
pm2 save

# PM2 자동 시작 등록
pm2 startup
# 출력되는 sudo env PATH=... 명령을 복사해서 실행!

# 테스트
curl -s http://localhost:1880/node-red/ | head -3       # Node-RED
curl -s http://localhost:3100/api/system/status          # 시스템 API
curl -s http://localhost/setup                           # 설정 페이지 (nginx 경유)
curl -s http://localhost/ | head -3                      # 프론트엔드
```

---

## 6. 이미지 생성 (clone-image.sh)

모든 테스트 통과 후, 이미지 생성 전 정리 스크립트를 실행합니다.

```bash
ssh lhk@<NEW-IP>
sudo ./clone-image.sh
```

### clone-image.sh가 하는 일
1. PM2 프로세스 중지
2. FARM_ID → UNSET 초기화
3. 센서 데이터, context, 로그 삭제
4. 네트워크 설정 초기화 (DHCP)
5. SSH 호스트 키 삭제
6. machine-id 삭제
7. first-boot 트리거 설정
8. apt 캐시 정리

### SD카드 이미지 읽기

```bash
# RPi 종료
sudo shutdown -h now
```

SD카드를 PC에 연결:

**Windows (Win32DiskImager)**:
1. Win32DiskImager 실행
2. 드라이브 선택 (SD카드)
3. 파일명: `smartfarm-rpi4-20260327.img`
4. [Read] 클릭

**Linux/Mac (dd)**:
```bash
sudo dd if=/dev/sdX of=smartfarm-rpi4-20260327.img bs=4M status=progress
```

### 이미지 축소 (권장)
32GB SD카드 이미지를 실제 사용량까지 축소합니다.

```bash
# PiShrink 설치 (Linux PC에서)
wget https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh
chmod +x pishrink.sh

# 이미지 축소
sudo ./pishrink.sh smartfarm-rpi4-20260327.img
# 32GB → 약 4~6GB로 축소됨
```

---

## 7. 이미지 배포 (새 농장)

### 이미지 굽기
```
balenaEtcher 또는 Raspberry Pi Imager
  → smartfarm-rpi4-20260327.img 선택
  → 새 SD카드에 굽기 (3~5분)
```

### 현장 설치 흐름
```
SD카드 삽입 → RPi 전원 ON
  ↓
first-boot.sh 자동 실행 (30초)
  - SSH 키 재생성
  - machine-id 재생성
  - PM2 서비스 시작
  ↓
WiFi/이더넷 연결
  ↓
브라우저에서 http://<RPi-IP>/setup 접속
  ↓
장비 코드 입력 (QR 스캔 또는 직접 입력)
  ↓
자동 설정 (30초)
  - 서버에서 농장 정보 수신
  - FARM_ID 설정
  - Node-RED 재시작
  ↓
설치 완료! 센서 수집 시작
```

---

## 8. 이미지 파일 관리

### 명명 규칙
```
smartfarm-rpi{모델}-{날짜}.img

예:
  smartfarm-rpi5-20260327.img   ← 개발용
  smartfarm-rpi4-20260327.img   ← 양산 메인
  smartfarm-rpi3-20260327.img   ← 저가형
```

### 보관 위치
- NAS 또는 클라우드 스토리지
- 버전별 보관 (최소 2개 버전 유지)
- 변경 이력 기록

### 이미지 업데이트 시
1. 기존 이미지로 RPi 부팅
2. 변경 사항 적용 (Node-RED 플로우, 프론트엔드 빌드 등)
3. clone-image.sh 실행
4. 새 이미지 생성
5. 날짜 변경한 파일명으로 저장

---

## 9. 플랫폼별 차이점

| 항목 | RPi 5 | RPi 4 | RPi 3B+ |
|------|-------|-------|---------|
| CPU | BCM2712 Quad 2.4GHz | BCM2711 Quad 1.8GHz | BCM2837B0 Quad 1.4GHz |
| RAM | 4/8GB | 2/4/8GB | 1GB |
| USB | USB 3.0 | USB 3.0 + 2.0 | USB 2.0 |
| OS | 64-bit | 64-bit | 32-bit 권장 |
| Node-RED 응답 | ~0.5초 | ~1초 | ~2초 |
| 스왑 필요 | 아니오 | 아니오 (2GB는 권장) | 예 (512MB) |
| 동시 Modbus | 여유 | 여유 | 간헐적 지연 가능 |

### RPi 3 추가 설정
```bash
# 스왑 확대 (provision.sh에서 자동 감지)
sudo sed -i 's/CONF_SWAPSIZE=100/CONF_SWAPSIZE=512/' /etc/dphys-swapfile
sudo systemctl restart dphys-swapfile

# GPU 메모리 축소 (터치패널 미사용 시)
echo "gpu_mem=16" | sudo tee -a /boot/config.txt
```

---

## 10. 문서 이력

| 날짜 | 버전 | 변경 내용 |
|------|------|---------|
| 2026-03-27 | 1.0 | 최초 작성 |
