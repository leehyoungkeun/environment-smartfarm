# 자동 OFF 예약 — NR 에디터 적용 가이드

웹·핸드폰 어디서든 예약 후 닫아도 정확히 동작하도록 NR (RPi) 측에 타이머 영구화.

## 사전 확인
- NR 에디터 접속: `http://farm-0001:1880/node-red/` (또는 RPi IP)
- 사용자 NR 에디터 캐시 충돌 방지 — 다른 PC/탭에서 동시 작업 금지

## 단계 1 — function 2 (MQTT 파서) 코드 보강

목적: `schedule-off` / `schedule-off-cancel` 명령 처리 분기 추가.

1. NR 에디터에서 **'AWS IoT 제어 수신'** (또는 비슷한 이름) 탭 열기
2. **function 2** 노드 더블클릭 (현재 코드: MQTT 파싱 + msg.control 첨부)
3. **함수** 탭의 기존 코드를 **메모장 등에 백업**
4. `docs/nodered-schedule-off-function.js` 의 전체 내용을 복사해 함수 코드에 붙여넣기
5. **출력**: 1개 (변경 없음)
6. 우측 상단 **완료**
7. **로컬 제어** 탭 (`/api/control/local` 처리) 의 function 2 노드에도 동일 적용 (있는 경우)

## 단계 2 — 재시작 시 복구 노드 추가

목적: NR 가 재시작되더라도 활성 예약을 자동으로 timer 재등록.

1. NR 에디터에서 같은 탭 (또는 새 탭) 에 노드 추가:
   - **inject** 노드 (왼쪽 팔레트 → "inject" 검색 → 드래그)
   - **function** 노드 (오른쪽 추가)
2. **inject** 노드 설정:
   - **반복 (Repeat)**: `없음`
   - **Inject once after `5` seconds, then`** 체크
   - **이름**: `schedule-off 복구 trigger`
3. **function** 노드 설정:
   - **이름**: `schedule-off recovery`
   - **함수 코드**: `docs/nodered-schedule-off-startup.js` 내용 붙여넣기
   - **출력**: 1개
4. 연결 (wire):
   - `inject` → `function` (recovery)
   - `function` (recovery) → **function 2 와 같은 modbus mapper 노드**
5. **Deploy**

## 단계 3 — REST 조회 엔드포인트 (선택)

목적: Frontend 가 polling 으로 활성 예약 상태 sync (UI 새로고침 시).

1. NR 에디터 → **메뉴 (≡)** → **가져오기** → **클립보드**
2. `docs/nodered-schedule-off-rest.json` 내용 붙여넣기
3. 가져온 노드들의 `z` 필드 (탭 ID) 를 현재 탭 ID 로 교체
4. **Deploy**

테스트:
```
curl http://farm-0001:1880/api/schedule-off
# → { "success": true, "data": [...] }
```

## 단계 4 — 검증

1. 웹에서 장치 ON 후 '예약' → 30초 선택
2. 즉시 OFF 안 되는지 확인 (function 2 가 `schedule-off` 분기 진입 — 디버그 패널에 `📅 예약 등록` 메시지 확인)
3. **30초 대기** → device OFF + relay 실제 동작 (`⏰ 예약 만료 → OFF 실행` 메시지)
4. **재시작 테스트**:
   - 다시 예약 (5분 등)
   - `sudo systemctl restart node-red` 또는 `pm2 restart node-red`
   - NR 다시 떠도 timer 살아있어 정상 OFF 실행 (recovery 노드 동작)
5. **취소 테스트**:
   - 예약 후 chip 클릭 → 'schedule-off-cancel' 송출
   - 디버그: `🚫 예약 취소`
   - 30초 후 OFF 안 됨 ✓

## 단계 5 — Frontend NR 통보 재활성 (제가 진행)

NR 적용 완료 보고해주시면:
1. `ControlPanel.jsx` 의 picker `onPick` / cancel 버튼에 `sendControlCommand` 재추가
2. NR `/api/schedule-off` polling 추가 (선택)
3. localStorage MVP 코드 정리

## 문제 발생 시 롤백

```bash
# flows.json 백업 (NR 패치 자동 적용 서비스 가 한 백업 위치)
ls ~/.node-red/flows.json.before-*
# 가장 최신 백업으로 복구
cp ~/.node-red/flows.json.before-XXXX ~/.node-red/flows.json
pm2 restart node-red
```

또는 NR 에디터에서 function 2 의 백업해둔 옛 코드로 되돌리기 + Deploy.

## 관련 메모리

- [[feedback-nr-broker-patch-safety]] — mqtt-broker 직접 patch 금지 (이 작업은 function 노드 만 수정이라 안전)
- [[project-nr-mqtt-recovery-pending]] — 옛 MQTT race fix 작업
