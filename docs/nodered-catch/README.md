# Node-RED 탭별 예외 수집 (GlitchTip)

Node-RED 의 **Catch 노드는 같은 탭의 오류만** 잡는다. 탭을 넘지 못한다.
그래서 탭마다 하나씩 놓고 `link out → link in` 으로 한 곳에 모은다.

## ⚠ 한 파일씩, 해당 탭을 연 상태에서

**Node-RED 는 가져오기 할 때 노드의 `z`(소속 탭)를 무시하고 현재 열려 있는
탭에 전부 넣는다.** 2026-08-26 에 17개 탭 것을 한 번에 가져왔다가 34개가
GlitchTip 탭에 몰렸다(Ctrl+Z 한 번으로 되돌림).

## 순서

| 순번 | 파일 | 열어야 할 탭 | 이유 |
|---|---|---|---|
| 0 | `0-glitchtip-tab-FIRST.json` | **GlitchTip 에러 추적** | 수집 지점 — 가장 먼저 |
| 1 | `1-aws-control-receiver.json` | **AWS IoT 제어 수신** | 클라우드 제어 수신 |
| 2 | `2-rest-api-offline.json` | **REST API (오프라인)** | 로컬 제어 |
| 3 | `3-automation-eval.json` | **자동화 평가** | 규칙 실행 |
| 4 | `4-sensor-collect.json` | **센서 수집** | Modbus 읽기 |
| 5 | `5-relay-watchdog.json` | **릴레이 워치독** | 릴레이 상태 감시 |
| 6 | `6-startup-init.json` | **시작 초기화** | 2026-08-28 감사에서 Catch 없음 |
| 7 | `7-heartbeat.json` | **Heartbeat** | 2026-08-28 감사에서 Catch 없음 |
| 8 | `8-config-crud.json` | **Config CRUD API** | 2026-08-28 감사에서 Catch 없음 |
| 9 | `9-sqlite-init.json` | **SQLite 초기화** | 2026-08-28 감사에서 Catch 없음 |
| 10 | `10-relay-reset.json` | **릴레이 초기화** | 2026-08-28 감사에서 Catch 없음 |
| 11 | `11-relay-mqtt-status.json` | **릴레이 MQTT 상태** | 2026-08-28 감사에서 Catch 없음 |
| 12 | `12-modules-sync.json` | **모듈 동기화** | 2026-08-28 감사에서 Catch 없음 |
| 13 | `13-sensor-mqtt-query.json` | **센서 MQTT 조회** | 2026-08-28 감사에서 Catch 없음 |
| 14 | `14-sync-mqtt.json` | **동기화 MQTT** | 2026-08-28 감사에서 Catch 없음 |
| 15 | `15-system-mqtt.json` | **시스템 상태 MQTT** | 2026-08-28 감사에서 Catch 없음 |

각 파일마다:

1. Node-RED 에디터에서 **표의 탭을 연다**
2. 파일 내용 전체 복사
3. ☰ → 가져오기 → 붙여넣기 → 가져오기
4. 노드가 그 탭에 놓였는지 확인

탭을 다 넣은 뒤 **한 번만 배포**해도 된다. (6~15 는 2026-08-28 감사에서 추가 — 나머지 탭 전부)

## 확인

각 탭 왼쪽 위에 `예외 → GlitchTip` → `예외 →` 두 노드가 보이면 정상이다.
`link out` 이 점선으로 GlitchTip 탭의 `← 각 탭 예외 수집` 과 이어진다.

## 설계 메모

- `scope: null` — 그 탭 전체를 감시한다
- `uncaught: true` — 이미 특정 노드에 걸린 Catch(센서 수집 5개 등)가
  처리하는 오류는 중복 보고하지 않는다. 이 Catch 는 **아무도 안 잡은
  오류만** 받는 예비망이다
- 나머지 12개 탭은 우선순위가 낮아 뺐다. 필요해지면 같은 방식으로 추가한다
