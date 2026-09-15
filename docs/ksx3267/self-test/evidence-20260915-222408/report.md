# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 22:23:53
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **1/1 통과**
- 프레임: TX 42 / RX 42 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.3.4 | 레벨 1 개폐기 동일 OPID 명령 시험 (노드 시험 — 드라이버가 시험장비 역할) | SPS-7466 §5.3.4 a)~y) (같은 OPID 무시 · 새 OPID 로 활성화, 303/304 각각) | ✅ 통과 |

## 5.3.4 레벨 1 개폐기 동일 OPID 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동중지 명령 (OPID·0) — `{'ok': True, 'accepted': True, 'opid': 162, 'op': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ c) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 162`
- ✅ d) 쓰기영역에 작동시간 열기 명령 (OPID·303·30s) — OPID 를 직전 명령과 같은 162 로 — `{'ok': True, 'accepted': False, 'opid': 162, 'op': 303, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ e) 개폐기가 작동하지 않음 (같은 OPID 는 활성화 아님) — `시험장비 {'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 162, 'time': 30, 'opid': 0, 'status': 0, 'remain': 0} / 제어기 읽기 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ f) 쓰기영역의 OPID 를 새 값 163 으로 변경 (OPID 워드 1개만 씀) — `{'ok': True, 'opid': 163, 'status': 301, 'status_name': 'OPENING', 'remain': 30}`
- ✅ g) 개폐기 작동 (시험장비 여는중·남은시간 30s) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 163, 'time': 30, 'opid': 163, 'status': 301, 'remain': 30}`
- ✅ h) 읽기영역: OPID 동일(163) + 상태 여는중(301) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 163, 'status': 301, 'status_name': 'OPENING', 'remain': 30}`
- ✅ i) 쓰기영역에 작동중지 명령 (OPID·0) — OPID 를 작동 명령과 같은 163 로 — `{'ok': True, 'accepted': True, 'opid': 163, 'op': 0, 'status': 301, 'status_name': 'OPENING', 'remain': 29}`
- ✅ j) 개폐기가 여전히 작동 (같은 OPID 의 중지는 무시) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 163, 'time': 0, 'opid': 163, 'status': 301, 'remain': 27}`
- ✅ k) 읽기영역: OPID 동일(163) + 상태 작동중(301) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 163, 'status': 301, 'status_name': 'OPENING', 'remain': 28}`
- ✅ l) 쓰기영역의 OPID 를 새 값 164 으로 변경 — `{'ok': True, 'opid': 164, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ m) 개폐기 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 164, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ n) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 164`
- ✅ o) 쓰기영역에 작동시간 닫기 명령 (OPID·304·30s) — OPID 를 직전 명령과 같은 164 로 — `{'ok': True, 'accepted': False, 'opid': 164, 'op': 304, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ p) 개폐기가 작동하지 않음 (같은 OPID 는 활성화 아님) — `시험장비 {'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 164, 'time': 30, 'opid': 0, 'status': 0, 'remain': 0} / 제어기 읽기 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ q) 쓰기영역의 OPID 를 새 값 165 으로 변경 (OPID 워드 1개만 씀) — `{'ok': True, 'opid': 165, 'status': 302, 'status_name': 'CLOSING', 'remain': 30}`
- ✅ r) 개폐기 작동 (시험장비 닫는중·남은시간 30s) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 165, 'time': 30, 'opid': 165, 'status': 302, 'remain': 30}`
- ✅ s) 읽기영역: OPID 동일(165) + 상태 닫는중(302) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 165, 'status': 302, 'status_name': 'CLOSING', 'remain': 29}`
- ✅ t) 쓰기영역에 작동중지 명령 (OPID·0) — OPID 를 작동 명령과 같은 165 로 — `{'ok': True, 'accepted': True, 'opid': 165, 'op': 0, 'status': 302, 'status_name': 'CLOSING', 'remain': 29}`
- ✅ u) 개폐기가 여전히 작동 (같은 OPID 의 중지는 무시) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 165, 'time': 0, 'opid': 165, 'status': 302, 'remain': 26}`
- ✅ v) 읽기영역: OPID 동일(165) + 상태 작동중(302) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 165, 'status': 302, 'status_name': 'CLOSING', 'remain': 27}`
- ✅ w) 쓰기영역의 OPID 를 새 값 166 으로 변경 — `{'ok': True, 'opid': 166, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ x) 개폐기 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 166, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ y) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 166`

## 수동 증적 항목 (화면 캡처·저장 확인)

