# P3 — Node-RED 통합 적용 안내 (KS X 3267 표준노드)

에디터: http://192.168.0.38:1880/node-red/  (RPi 1호만. flows.json 직접 수정 금지)

적용 전 검증: `cd backend && node --test --import=./test/setup.js test/nr/ks3267.test.js`
(이 폴더의 교체본·신규 함수를 파일에서 실행해 잠근 테스트. 적용 후엔 마스터 동기화로 같은 검증을 노드 id 로 다시 건다.)

## 1. 새 탭 가져오기

1. `python docs/ksx3267/nodered/gen_tab.py` → `ks3267-tab.json` 생성 (이미 생성돼 있으면 생략)
2. 에디터 우상단 메뉴(≡) → **가져오기** → 파일 선택 `ks3267-tab.json` → "새 플로우" 로 가져오기
3. 탭 **「KS X 3267 표준노드」** 가 생기고 노드 15개가 배치됨. 탭 설정의 환경변수는 **비워둔다**.

## 2. AWS IoT 제어 수신 탭 — `제어 실행 (릴레이)` 교체 (출력 2 → 3)

1. 노드 더블클릭 → 코드 전체 삭제 → `execute_control.js` 내용 붙여넣기
2. 같은 창 하단 **출력 개수: 3** 으로 변경 → 완료
3. 팔레트에서 **link out** 노드를 끌어와 이름 `→ KS3267 명령`, 대상으로 새 탭의 `← execute_control 제어 (ks3267)` 를 체크
4. `제어 실행 (릴레이)` 의 **3번 출력** → 이 link out 에 연결 (1·2번 출력 배선은 그대로)

## 3. 센서 수집 탭 — `③ 센서 데이터 수집` 교체

노드 더블클릭 → 코드 전체 교체 → `fn_collect_sensors.js` (출력·배선 변경 없음)

## 3-1. http request 노드 3개 — "2xx 아닌 응답만 Catch 노드로 전송" 체크 **해제**

`데몬 GET`·`데몬 /command`·`서버 제어이력` 모두 해제 상태여야 한다. 체크되면 데몬이 꺼진 상태에서 오류가 Catch 로 빠져
http 응답이 나가지 않고 요청이 매달린다 (2026-08-30 1호 적용 때 `데몬 GET` 이 이 상태였음 → 12초+ 무응답).
해제면 오류가 payload 문자열로 다음 노드에 오고, `응답 정리`가 502 로 돌려준다.

## 3-2. 구동기 1분 스냅샷 노드 추가 (116 검정, 2026-08-30) — 탭을 이미 가져온 농장

1. `python docs/ksx3267/nodered/gen_tab.py` → `ks3267-snapshot-nodes.json` (4노드: 매 60초 inject → 표준 구동기 1분 스냅샷 → 서버 actuator-status → 스냅샷 전송 결과)
2. 에디터에서 **「KS X 3267 표준노드」 탭을 연 상태**로 가져오기 → 파일 선택 → 가져오기 (현재 탭에 들어간다). 새로 가져오는 농장은 `ks3267-tab.json` 에 이미 포함(22노드).
3. `서버 actuator-status` http request 의 "2xx 아닌 응답만 Catch" 해제 확인 → Deploy
4. 서버 DB 에 `backend/prisma/migration-actuator-status.sql` 이 먼저 적용돼 있어야 한다 (없으면 500 → NR 큐에 쌓였다가 적용 후 자동 재전송)

## 4. Deploy → 마스터 동기화 → 테스트

```
scp lhk@192.168.0.38:/home/lhk/.node-red/flows.json <scratch>/flows.live.json
python rpi-files/scripts/master-flows-sync.py <scratch>/flows.live.json rpi-files/master/flows.json --write
cd backend && npm test
```

## 5. 데몬 기동 (HW 도착 후) 과 houseConfig 프로필

```
pm2 start rpi-files/master/ks3267d/ks3267d.py --name ks3267d --interpreter python3 -- \
    --port /dev/smartfarm-485-std --units 1,2 --nr-url http://127.0.0.1:1880/api/ks3267/status
```

houseConfig 에 표준 장치를 등록하는 형식 (P4 설정 UI: 하우스/센서 탭 → 장치 펼침 → 프로토콜 '표준 노드', 센서 펼침 → '표준 노드에 매핑'):
```json
{ "deviceId": "fan1",    "modbus": { "protocol": "ks3267", "unit": 1, "kind": "switch", "n": 3 } }
{ "deviceId": "window1", "modbus": { "protocol": "ks3267", "unit": 1, "kind": "opener", "n": 2 } }
{ "sensorId": "temp_std", "ks3267": { "unit": 2, "index": 1 } }
```

## 데이터 흐름

```
웹/자동화/키오스크 제어 ──→ execute_control ──(protocol==='ks3267')──→ [link] 표준 명령 조립 → 데몬 /command → 결과·이력
                                     └──(vendor)──→ Modbus Flex Write (기존, 무수정)
데몬 폴링 ──→ POST /api/ks3267/status ──→ deviceStates / ks3267Readings ──→ ③ 센서 수집(3분 TTL) → SQLite·서버·자동화
설정 UI ──→ 백엔드 /api/config/:farmId/ks3267/:action ──→ NR /api/ks3267/:action ──→ 데몬 (읽기 전용)
```
