# Node-RED 감사 조치 (2026-08-28) — 에디터 작업 순서

에디터: `http://192.168.0.38:1880/node-red/` (admin). 전부 끝내고 **배포 한 번**.
가져오기는 **해당 탭을 연 상태에서** (Node-RED 는 노드의 z 를 무시하고 현재 탭에 넣는다).

---

## 1. `자동화 평가` › `function 1` 삭제 — 실수로 누르면 autoDevices 가 날아감

- 위치: `자동화 평가` 탭, 이름 `function 1` (id `18c2681a4a1b0e47`) + 그 앞의 `inject` 노드
- 코드가 `global.set('autoDevices', ['house_0001:cooler1'])` — 운영 중 누르면 자동제어 장치 목록이 덮인다
- 조치: **두 노드(inject + function 1) 선택 → Delete**
- 같은 탭 `규칙 조회 준비` (id `97f9197196ac79a2`, SQLite 시절 SQL 만 남은 고아) 도 **삭제**
- 같은 탭 `⑤ 스케줄 실행 핸들러` 뒤에 붙은 **출력 없는 http request** (id `2b72ea57aadebdc4`) 도 **삭제**
  (⑤ 의 4·5번 출력은 항상 null — 아무것도 안 보낸다)

## 2. `모듈 동기화` › `config/update` 를 한 번만 구독

지금: mqtt in 두 개(`config/update 수신`, `config/update → houseConfig refresh`)가 같은 토픽을 받는다.
첫 번째는 type 을 안 보고 항상 system-settings GET 을 날린다 → house_* 이벤트에도 두 요청이 나간다.

1. `모듈 동기화` 탭을 연다
2. `2-modules-sync-single-mqtt-in.json` 가져오기 → `config/update 수신 (단일)` + `type 분기` 두 노드가 들어온다
3. **선 연결** (파일의 wires 는 자리표시자):
   - `type 분기` **출력 1** → `백엔드 API 호출 준비`
   - `type 분기` **출력 2** → `type=house_* 만 처리`
4. 기존 mqtt in 두 개(`config/update 수신`, `config/update → houseConfig refresh`) **삭제**
5. `백엔드 API 호출 준비` 에 다른 입력(inject `scheduled_sync`)이 있으면 그대로 둔다 — 정기 검증 경로

## 3. 옛 IP `192.168.137.30` → 실제 IP

1. `시작 초기화` 탭을 연다 → `3-startup-systemip.json` 가져오기 (inject → `hostname -I` → `global.systemIp 저장`)
   - 부팅 5초 후 한 번 실행, Tailscale(100.x)·링크로컬(169.254.x) 은 제외하고 LAN IP 를 `global.systemIp` 에 둔다
2. `센서 수집` › `③ 센서 데이터 수집` **101행**
   ```js
   ip: '192.168.137.30',
   ```
   → 
   ```js
   ip: global.get('systemIp') || null,
   ```
3. `데이터 동기화` › `배치 전송 준비` **38행**
   ```js
   deviceInfo: { deviceId: 'rpi_0001', ip: '192.168.137.30', version: '1.0.0' }
   ```
   →
   ```js
   deviceInfo: { deviceId: 'rpi_0001', ip: global.get('systemIp') || null, version: '1.0.0' }
   ```

## 4. Catch 없는 탭 10개 — `docs/nodered-catch/6~15`

탭마다 열고 → 해당 번호 파일 가져오기 (표는 `docs/nodered-catch/README.md`). 노드 2개(catch + link out)가 들어오며 선은 이미 이어져 있다.
`gt_link_in` 은 GlitchTip 탭에 이미 있으므로 추가 연결 불필요.

## 5. 잔재 (선택)

- `AWS IoT 제어 수신` › link in `schedule-off Modbus` (id `a68d3178a601380d`) — 부르는 곳 없음. 뒤의 `Modbus 완료 응답`·`debug 4` 와 함께 삭제
- 활성 debug 17개 — 노드 오른쪽 초록 버튼을 눌러 비활성. 특히 `자동화 평가` 의 `debug 9`/`debug 10`, `센서 수집` 의 `새로만든 디버거`, `AWS IoT` 의 `debug 4`, `릴레이 MQTT 상태` 의 `debug 1` 은 이름조차 없다 → 삭제
- `양액 자동제어`(비활성 탭) — 재활성 전에 `1회 관수 사이클`·`direct-relay handler` 의 `fc: 5` → FC15(`modbus-flex-write` `fc: 15, quantity: 1`), `unitid: 3` → `msg._module.unitId`

## 배포 후 확인

```bash
# 1호에서
python3 /tmp/nr-audit.py          # rpi-files/scripts/nr-audit.py 를 scp 후 — "Catch 없음" 0, 고아 0 이어야
curl -s localhost:1880/api/system/ip
```
GlitchTip 탭의 임시 검증 노드(`① 여기 클릭`)로 새 탭 하나에서 예외를 내 Discord 에 오는지 한 번 확인.
