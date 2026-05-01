# Node-RED 에디터 수정 가이드 — RPi 1호 안정화 (2026-05-01)

> **에디터 URL**: http://192.168.137.30:1880/node-red/
> **flows.json 직접 수정 금지** — 모든 변경은 에디터 UI 통해서만.

## 사전 작업 (이미 완료)

- ✅ `house_0001`의 motor1, fan1 device 삭제 (modbus.unitId=1 고아) — 백엔드에서 처리
- ✅ Node-RED 재시작 → houseConfig 자동 갱신 (configVersion 13)
- ✅ Modbus 통신 장애 로그 사라짐
- ✅ RPi 시스템 안정화 (udev, USB autosuspend, ecosystem.config.js, headthcheck cron)

## 다음 작업 (사용자 — 에디터에서 수동)

### 1. Modbus 노드들의 serialPort 변경

**위치**: 좌측 사이드바 → 우측 상단 햄버거 메뉴 → 설정 → modbus-client (Servers)

또는 modbus 관련 노드 더블클릭 → server 선택 → 연필 아이콘 → serialPort 필드

- 현재: `/dev/ttyUSB0`
- 변경: `/dev/smartfarm-485`

서버는 **하나만** 유지 (RS-485 버스 1개에 modbus-client 1개 원칙).

또한 같은 서버 설정 다이얼로그에서:
- **재연결**: 활성화 (있다면)
- **타임아웃**: 5000ms

### 2. modbus-flex-getter / modbus-flex-write 노드 timeout 명시

각 Modbus 노드 더블클릭 → **timeout: 2000** 입력 (현재 빈값=기본 1분).

대상: 워치독의 `wd_modbus_read`, `wd_modbus_write`, 센서 수집 탭의 모든 Modbus 노드.

### 3. 워치독 v3 코드 적용

**위치**: 릴레이 워치독 탭 → `wd_evaluator` 노드 더블클릭

기존 코드를 모두 지우고 [`docs/nodered-watchdog-v3.js`](nodered-watchdog-v3.js) 의 코드를 통째로 붙여넣기.

**중요 변경**: 출력 개수가 3 → **4** 로 변경되어야 함:
1. 디버그 로그
2. 복구 Modbus
3. modbus-client reconnect (신규)
4. HTTP 백엔드 알림 (신규)

새로 추가할 출력 와이어:
- 출력 3 → modbus-client 노드의 `inject` 형태로 reconnect 메시지를 보낼 수 있는 노드 (또는 modbus-server 재연결 트리거 노드)
- 출력 4 → `http request` 노드 (URL 비워두고 method=use 모드, msg.url/method 사용)

### 4. Modbus 헬스체크 엔드포인트 import

**위치**: 우측 상단 햄버거 → Import → Clipboard

[`docs/nodered-modbus-healthcheck-flow.json`](nodered-modbus-healthcheck-flow.json) 파일 내용 전체 붙여넣기 → Import.

**주의**: import 시 z(탭) 이름 충돌 경고가 뜨면 "Import to selected nodes" 등 옵션으로 기존 `rest_api_flow` 탭에 추가.

확인:
```bash
ssh lhk@192.168.137.30 "curl -s http://localhost:1880/api/local/modbus/ping | python3 -m json.tool"
```
→ `{ "healthy": true, ... }` 응답 확인.

### 5. Config 자동 동기화 플로우 import

[`docs/nodered-config-sync-flow.json`](nodered-config-sync-flow.json) 파일 내용 전체 붙여넣기 → Import.

import 후:
- `cs_mqtt_in` 노드 더블클릭 → **broker**: 기존 `AWS IoT Core` 선택
- Deploy

이후부터 **UI에서 모듈/디바이스 변경 시 RPi가 자동으로 houseConfig 갱신** (5분 폴링/재시작 불필요).

### 6. 헬스체크 cron 활성화 (4번 완료 후)

```bash
ssh lhk@192.168.137.30 "crontab -l | sed 's|^# DISABLED until healthcheck flow imported: \(\* \* \* \* \* /usr/local/bin/smartfarm-modbus-healthcheck.sh\)|\1|' | crontab -"
```

## 검증

### 6.1 Modbus 직접 통신 테스트
```bash
ssh lhk@192.168.137.30 "pm2 stop node-red && sleep 2 && \
  sudo mbpoll -m rtu -a 2 -b 9600 -P none -t 4 -r 1 -c 8 /dev/smartfarm-485 -1 && \
  pm2 start node-red"
```
→ Eletechsup unit 2의 8개 register 값 출력되어야 함.

### 6.2 헬스체크 엔드포인트
```bash
curl -s http://192.168.137.30:1880/api/local/modbus/ping
```

### 6.3 USB disconnect 시뮬레이션
```bash
ssh lhk@192.168.137.30 "sudo udevadm trigger --action=remove --subsystem-match=tty"
```
→ `/home/lhk/smartfarm/logs/usb-events.log` 에 remove 이벤트 + 백엔드에 USB_DISCONNECT 알림.
다시 `--action=add` → 자동 Node-RED 재시작 + USB_RECONNECTED + NODERED_RESTARTED 알림.

### 6.4 백엔드 알림 확인
프론트엔드의 알림 패널 또는:
```bash
curl -s "https://api.smartgreen.kr/api/alerts?farmId=farm_0001&limit=10" -H "x-api-key: smartfarm-sensor-key" | python -m json.tool
```

## 참고

- **flows.json 백업** 추천: 작업 전 `cp ~/.node-red/flows.json ~/.node-red/flows.json.bak.$(date +%s)`
- **Deploy 실패 시**: 좌측 메모리 → 변경사항 확인 후 다시 Deploy
- **롤백**: `pm2 stop node-red && cp ~/.node-red/flows.json.bak.* ~/.node-red/flows.json && pm2 start node-red`
