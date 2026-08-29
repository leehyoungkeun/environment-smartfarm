# SmartFarm RPi 표준 이미지 빌드/배포 체크리스트

> "원본만 완벽하게" — 1호 RPi(192.168.137.30, farm_0001)를 마스터로 모든 농장에 동일한 이미지로 배포하기 위한 절차.

---

## 흐름 선택

### A) 1호 SD → dd → .img (기존 절차, 빠름)
1호의 모든 상태를 그대로 복사. **장점**: 검증된 운영 환경 그대로. **단점**: 1호 고유 정보(farm_0001, Tailscale 등록, SSH host key, 로그) 청소 필요 ↓ Sanitize 절차 필수.

### B) 빈 OS + provision.sh 자동 빌드 (재현 가능)
빈 RPi OS에 `provision.sh`를 돌려 동일한 환경 구축 + `master/flows.json` 자동 복원. **장점**: 청소 작업 거의 불필요(애초에 깨끗). **단점**: 30분 빌드 시간.

권장: 기본 A, 검증/디버깅 용도로 B.

---

## A 흐름: 1호 SD → 표준 이미지

### A-1. 1호에서 Sanitize (이미지 굽기 직전, 1호 SSH)

```bash
# (1) Tailscale 등록 해제 — 새 RPi가 farm-0001로 잘못 등록되는 것 방지
sudo tailscale logout
sudo rm -f /var/lib/tailscale/registered
sudo rm -f /var/lib/tailscale/tailscaled.state

# (2) FARM_ID 정보 비우기 — setup 페이지에서 다시 입력하도록
echo "UNSET" > /home/lhk/smartfarm/.farm-id
rm -f /home/lhk/.env  # FARM_ID 환경변수 트랩 회피 (cbeefac 참조)

# (3) AWS IoT 인증서 제거 — 새 농장이 1호 인증서를 쓰지 않도록
rm -f /home/lhk/certs/*.crt /home/lhk/certs/*.key /home/lhk/certs/*.pem.private
# AmazonRootCA1.pem 은 모든 농장 공통이므로 유지

# (4) Node-RED context 의 1호 고유 정보 정리
# (선택) 운영 데이터가 들어가도 새 RPi 첫 실행 시 backend 에서 갱신되므로 보통은 그대로 둠
# 깔끔하게 가려면:
# rm -rf /home/lhk/.node-red/context/global/*

# (5) 로그/임시 파일 정리
rm -rf /home/lhk/smartfarm/logs/*
rm -f /tmp/smartfarm-*
rm -f /home/lhk/.bash_history /root/.bash_history

# (6) SSH host key 재생성 트리거 (first-boot.sh 가 처리)
touch /home/lhk/smartfarm/.first-boot-pending

# (7) PM2 stop (이미지 굽는 중 파일 변경 방지)
pm2 stop all
pm2 save --force
sudo systemctl stop nginx

# (7-1) ★필수★ flows.json placeholder 복원
#   wrapper.sh 가 NR 시작 시 flows.json 의 ${FARM_ID} 를 .farm-id 값으로 sed 치환한다(편도).
#   운영 중인 1호의 flows.json 은 farm_0001 로 치환된 상태이므로, 그대로 이미지를 뜨면
#   모든 신규 농장이 farm_0001 의 MQTT 토픽을 구독한다 → 제어 오작동(치명).
#   반드시 PM2 stop 이후에 실행할 것 (NR 이 flows.json 을 다시 쓰지 못하게).
/home/lhk/smartfarm/scripts/regen-flows-placeholder.sh
cp /home/lhk/smartfarm/master-template/flows.json.placeholder \
   /home/lhk/.node-red/flows.json

# 검증 1 — 14 가 나와야 한다. 0 이면 중단하고 원인부터 확인할 것.
grep -o '\${FARM_ID}' /home/lhk/.node-red/flows.json | wc -l
# 검증 2 — 0 이어야 한다. 1 이상이면 농장 고유값이 남은 것이다.
grep -o 'smartfarm/farm_0001' /home/lhk/.node-red/flows.json | wc -l

# (7-1b) 2026-08-29 부터 아래 농장 고유 파일은 clone-image.sh 가 지운다 (수동 확인용 목록):
#   .sensor-api-key(농장 키) · .sim-mode · .nr-credential-secret · flows_cred.json · .config.runtime.json · cameras.conf
#   → 새 농장: setup 이 키를 받고, ecosystem 이 credentialSecret 을 새로 만든다. 절대 이 파일들을 이미지에 남기지 말 것.

# (7-2) 카메라 정보 비우기 — 카메라는 농장마다 다르다
python3 -c "import yaml;p='/home/lhk/smartfarm/go2rtc.yaml';d=yaml.safe_load(open(p));d['streams']={};yaml.safe_dump(d,open(p,'w'))"
sudo truncate -s0 /etc/smartfarm/cameras.conf

# (8) shutdown
sudo poweroff
```

### A-2. SD카드 이미지 추출 (PC, Windows)

1. 1호에서 SD카드 분리 → PC에 USB 어댑터로 연결
2. **HDD Raw Copy Tool v2.5** 실행 → SD → `D:\smartfarm-rpi-{날짜}.img`
   (Win32DiskImager는 Win11 LTSC에서 크래시함)
3. WSL Ubuntu 에서 PiShrink 로 축소:
   ```
   sudo ~/pishrink.sh /mnt/d/smartfarm-rpi-{날짜}.img
   ```
4. 1호 SD를 다시 1호에 삽입 → 부팅 → Tailscale 재등록:
   ```bash
   sudo tailscale up --authkey=<KEY> --hostname=farm-0001 --ssh
   echo "farm_0001" > /home/lhk/smartfarm/.farm-id
   pm2 start all
   ```

### A-3. 새 농장 배포

⚠ **재설치 시 (2026-08-29 N2)**: setup 은 1회용이다 — `devices.installed_at` 이 차 있으면 키·인증서를 안 내려준다.
이미 배포했던 장비를 다시 설치하려면 서버에서 그 장비를 재설치 가능 상태로 되돌린다:
```sql
-- 그 장비코드만. 인증서를 새로 발급했다면 cert_pem/private_key 도 함께 갱신.
UPDATE devices SET installed_at = NULL WHERE device_code = '<코드>';
```


1. 사무실 PC: 농장 등록 → 장비코드 발급
2. AWS IoT: Thing 생성 + 인증서 발급 → 관리자 웹에서 cert+key 업로드
3. RPi Imager: `.img` → 새 SD/SSD 굽기
4. 현장: RPi 전원 ON → WiFi → `http://IP/setup` → 장비코드 입력
5. 자동 흐름:
   - first-boot.sh: SSH host key + machine-id 재생성
   - setup.js: 인증서 다운로드 + FARM_ID 설정
   - 다음 부팅: Tailscale 자동 등록 (hostname=farm-XXXX)
6. 카메라 (있으면): Tapo 앱에서 '카메라 계정' 생성(유저명 8자+) → RPi 에서
   `smartfarm-camera-setup.sh list` 로 MAC 확인 → `smartfarm-camera-setup.sh add cam1 <MAC> <user> <pass>`
   → 출력된 **공유기 DHCP 예약** 을 반드시 설정 (안 하면 IP 표류로 다시 죽는다)

---

## B 흐름: 빈 OS + provision.sh

### B-1. 새 RPi 셋업

1. Raspberry Pi OS Bookworm 64-bit 굽기 (RPi Imager)
2. 첫 부팅 → SSH 활성 → 사용자 `lhk` 생성 (또는 OS 설정에서)
3. 이 저장소를 RPi 에 clone:
   ```bash
   cd ~ && git clone https://github.com/leehyoungkeun/environment-smartfarm.git
   ```
4. provision.sh 실행:
   ```bash
   cd ~/environment-smartfarm/rpi-files
   sudo ./provision.sh
   ```
   자동 처리 항목:
   - 시스템 패키지 + Node.js 20 + Node-RED + PM2 + nginx
   - AWS IoT 루트 CA 다운로드
   - system-server (setup + system-api)
   - first-boot 서비스 등록
   - **USB 안정화 (udev/cron/cmdline)**
   - **마스터 flows.json + settings.js 복원** ← `rpi-files/master/`
5. 프론트엔드 빌드 복사:
   ```bash
   # PC 에서
   npx vite build --mode rpi
   scp -r dist/* lhk@<RPi-IP>:/home/lhk/smartfarm-frontend/
   ```
6. PM2 서비스 등록 (provision.sh 끝에 명령 안내):
   ```bash
   sudo -u lhk pm2 start node-red -- -s ~/smartfarm/node-red/settings.js
   sudo -u lhk pm2 start ~/smartfarm/rpi-server/src/system-server.js --name smartfarm-system
   sudo -u lhk pm2 save
   sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u lhk --hp /home/lhk
   ```
7. setup 페이지 (`http://IP/setup`) 에서 농장 등록

---

## 배포 후 검증 체크리스트 (어느 흐름이든)

각 항목이 통과해야 운영 시작:

- [ ] `cat /home/lhk/smartfarm/.farm-id` → 농장 ID (UNSET 아님)
- [ ] `tailscale status` → 정상 등록 (`farm-XXXX`)
- [ ] `ls /home/lhk/certs/*.pem.crt` → 인증서 존재
- [ ] `pm2 list` → node-red, smartfarm-system, smartfarm-rpi 모두 online
- [ ] `curl -s http://localhost:1880/api/local/modbus/ping | head -c 100` → JSON 응답 (200 또는 503)
- [ ] `ls /dev/smartfarm-485` → 심볼릭 링크 존재 (USB-485 어댑터 연결됨)
- [ ] `crontab -l | grep modbus-healthcheck` → DISABLED 아님
- [ ] `cat /sys/bus/usb/devices/*/power/control` → 모두 `on`
- [ ] backend 에서 농장 last_seen_at 갱신 확인 (5분 이내)
- [ ] 프론트 대시보드에 농장 카드 표시 확인
- [ ] (카메라) `smartfarm-camera-setup.sh check` → 설정/실제 IP 일치 + 프레임 ✓, 공유기 예약 완료

---

## 마스터 사본 파일 (rpi-files/master/)

| 파일 | 용도 | 갱신 시점 |
|---|---|---|
| `flows.json` | Node-RED 마스터 (439 노드) | 1호에 의미 있는 변경 후 |
| `settings.js` | Node-RED 설정 | adminAuth/path 변경 시 |
| `smartfarm-camera-probe.sh` | 카메라 도달성·IP 표류 프로브 (root cron 매분) | 프로브 로직 변경 시 |
| `onvif-discover.py` | ONVIF 탐색 (setup·probe 공용) | — |
| `go2rtc.yaml.example` | go2rtc 템플릿 (스트림 비움) | 포트/옵션 변경 시 |
| `etc/journald-50-smartfarm-persistent.conf` | 저널 영속화 (RPi OS 휘발 강제 덮음) | — |

갱신 명령:
```bash
scp lhk@192.168.137.30:/home/lhk/.node-red/flows.json rpi-files/master/flows.json
scp lhk@192.168.137.30:/home/lhk/smartfarm/node-red/settings.js rpi-files/master/settings.js
```

⚠️ **주의**: `master/` 의 사본을 운영 중인 RPi 에 scp 로 덮어쓰지 말 것 — 항상 1호 에디터에서 변경 → 마스터 백업 갱신 순서.

---

## 알려진 트랩

1. **FARM_ID 환경변수 트랩** (commit `cbeefac`): `/home/lhk/.env` 에 FARM_ID 가 박혀있으면 `.farm-id` 파일보다 우선됨 → 새 농장이 farm_0001 로 잘못 등록. 이미지 청소 시 `.env` 삭제 필수.

1-1. **VITE_FARM_ID 빌드 타임 트랩** (해결됨, 2026-05-02): 프론트 빌드 시 `.env.production` 의 `VITE_FARM_ID=farm_0001` 이 dist 에 박힘 → 1호 dist 를 새 농장에 그대로 가져가면 farm_0001 로 동작. 해결: `system-api.js` 의 `GET /api/system/info` 가 `.farm-id` 파일을 동적 반환, `AuthContext` 가 fetch 로 farmId 결정. 빌드 환경변수는 fallback 으로만 남음.

2. **Tailscale 등록 정보**: `/var/lib/tailscale/` 에 등록 상태가 남아있으면 새 RPi 가 farm-0001 로 등록됨. 청소 시 `logout + 파일 삭제` 모두 필수.

3. **healthcheck flow**: 표준 이미지에 반드시 포함되어야 cron(`smartfarm-modbus-healthcheck.sh`)이 의미 있게 작동. 빠지면 cron 이 무한 재시작 루프를 일으킬 수 있음. 마스터 `flows.json` 에 `mh_*` 노드 4개 있는지 확인:
   ```bash
   grep -c '"id":"mh_' rpi-files/master/flows.json   # 4 이어야 함
   ```

4. **Win32DiskImager 사용 금지**: Windows 11 LTSC 에서 크래시. HDD Raw Copy Tool v2.5 사용.

5. **AWS IoT clientId 하드코딩 트랩** (해결됨, 2026-05-08): `MyFarmPi_01_nodered` 가 flows.json + ecosystem.config.js 두 곳에 박힌 채 SD 복제 → 다른 농장 RPi 와 같은 clientId 충돌 → AWS IoT 매 15초 끊김 무한 루프. 해결: 마스터에는 `MyFarmPi_UNSET_nodered` placeholder 박힘 + setup.js 가 새 농장 setup 시 `MyFarmPi_<deviceCode>` 로 자동 치환.

6. **system-api.js 와 setup.js 분리 — /setup 404 트랩** (해결됨, 2026-05-08): system-api.js 가 plain http 라 /setup 라우트 없음 + setup.js 가 어디서도 require 안 됨 → /setup 404. 해결: system-api.js 를 Express 로 재작성 + `app.use('/setup', require('./setup'))` 마운트. provision.sh 의 옛 inline system-server.js 생성(80줄 heredoc) 도 중복이라 같이 제거.
   ```bash
   # 검증
   ssh lhk@<RPi-IP> "curl -s -o /dev/null -w %{http_code} http://localhost/setup"   # 200
   ```

7. **PM2 dump.pm2 stopped 상태 박힘 — 부팅 후 서비스 안 뜸** (해결됨, 2026-05-08): sanitize 절차 끝에 `pm2 stop all && pm2 save` 가 dump.pm2 를 stopped 로 만듦 → 부팅 후 자동 시작 안 됨. 해결: `smartfarm-pm2-start.service` (systemd oneshot) 추가. dump 상태 무관하게 부팅 시 무조건 `pm2 start all`.
   ```bash
   # 검증
   ssh lhk@<RPi-IP> "systemctl is-enabled smartfarm-pm2-start.service && pm2 list"
   ```

---

## 마스터 이미지 v4 (정식, 2026-05-08, 9.76GB)

**파일**: `D:\smartfarm_rpi_20260508_v4.img`

**포함 수정**:
- ✅ 트랩 1·1-1·2·3 (이전 버전부터 적용)
- ✅ 트랩 5: clientid placeholder (MyFarmPi_UNSET_nodered)
- ✅ 트랩 6: system-api.js Express + setup mount (rpi-server/src/ 정확한 위치)
- ✅ 트랩 7: smartfarm-pm2-start.service 자동 시작
- ✅ 워치독 자가청소 패치 (모듈 교체 시 옛 카운터 자동 정리)

**검증 절차** (1호에서 reboot 후 확인됨):
```bash
ssh lhk@<RPi-IP> "
  systemctl is-enabled smartfarm-pm2-start.service &&
  pm2 list | grep -E 'online' &&
  curl -s -o /dev/null -w 'setup:%{http_code}\n' http://localhost/setup &&
  curl -s -o /dev/null -w 'info:%{http_code}\n' http://localhost/api/system/info &&
  grep '\"clientid\":' /home/lhk/.node-red/flows.json
"
# 기대: enabled, 3개 online, setup:200, info:200, clientid: MyFarmPi_UNSET_nodered
```

새 농장 셋업 시 setup.js 가 placeholder 를 `MyFarmPi_<deviceCode>` 로 자동 치환.
