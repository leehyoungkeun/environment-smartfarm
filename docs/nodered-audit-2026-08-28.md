# Node-RED 완결성 감사 — 2026-08-28 (1호, 19탭 · 472노드)

재실행: `scp rpi-files/scripts/nr-audit.py lhk@192.168.0.38:/tmp/ && ssh lhk@192.168.0.38 python3 /tmp/nr-audit.py`
(읽기 전용 — flows.json 을 바꾸지 않는다. 수정은 항상 에디터에서.)

## 구조는 건강하다

| 검사 | 결과 |
|---|---|
| 끊긴 선 (없는 노드로 향함) | 0 |
| HTTP in 40개 → http response 도달 | 40/40 |
| modbus-client 설정 | 1개 `relay-485` |
| 함수 안 `${FARM_ID}` 템플릿 리터럴 | 0 |
| 안 쓰는 설정 노드 · 이름 없는 함수 | 0 · 0 |

## 고칠 것 (위험 순, 전부 에디터 작업)

1. **`자동화 평가` › `function 1`** — 수동 디버그 노드인데 실행하면 `autoDevices` 를 `['house_0001:cooler1']` 로 덮어쓴다. 삭제.
2. **`모듈 동기화` › `config/update` mqtt in 2개** — 같은 토픽을 둘이 구독해 설정 변경 한 번에 두 갈래가 따로 돈다. 하나로 합쳐 순서 보장.
3. **옛 IP `192.168.137.30` 하드코딩** — `센서 수집 › ③ 센서 데이터 수집`(ip), `데이터 동기화 › 배치 전송 준비`(deviceInfo). `/api/system/ip` 로 대체.
4. **Catch 없는 탭 11개** — Config CRUD API·SQLite 초기화·릴레이 MQTT 상태·모듈 동기화·동기화 MQTT·시스템 상태 MQTT·시작 초기화·Heartbeat·릴레이 초기화·센서 MQTT 조회. 오류가 GlitchTip 에 안 간다. `docs/nodered-catch/` 방식으로 탭별 추가.

## 잔재 (동작 영향 없음)

- `자동화 평가 › 규칙 조회 준비` — SQLite 시절 SQL 만 남은 고아 노드
- `자동화 평가` http request `2b72ea57` — `⑤ 스케줄 실행 핸들러` 뒤, 출력 없음
- `AWS IoT 제어 수신` link in `schedule-off Modbus` — 부르는 link out 없음
- 활성 debug 노드 17개 (자동화 평가 4·센서 수집 4·AWS 3·SQLite 2·워치독 2·기타)
- `양액 자동제어`(비활성) — **FC5 2곳 + unitId 3 하드코딩 4곳.** 재활성 전 FC15·`msg._module` 로 고칠 것.

## 설계 노트

`|| 'house_0001'` 폴백 30여 곳은 다중하우스 전환 때의 하위호환. 하우스 1개인 지금은 무해하나,
하우스 2개 이상 농장에서 houseId 없는 메시지는 조용히 1번 하우스로 간다. 양산 전 `houseConfig` 첫 하우스 기준으로 통일.
