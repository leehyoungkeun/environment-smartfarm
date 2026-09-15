# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 22:08:06
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **2/2 통과**
- 프레임: TX 2137 / RX 1894 / 예외 0 / 타임아웃 243 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.5.2 | 레벨 1 스위치 제어 시험 | SPS-7466 §5.5.2 / 5.2.1 a)~m) (202 TIMED_ON → 만료 → 202 → 0 OFF) | ✅ 통과 |
| 5.5.3 | 레벨 1 개폐기 제어 시험 | SPS-7466 §5.5.3 a)~s) (303 TIMED_OPEN / 304 TIMED_CLOSE / 0 STOP) | ✅ 통과 |

## 5.5.2 레벨 1 스위치 제어 시험

- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 작동 명령 (OPID·202·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477686954', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T13:08:06.954Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 202 + 동일 작동시간 수신 → 작동 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 141, 'time': 12, 'opid': 141, 'status': 201, 'remain': 12}`
- ✅ d) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 141 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 141, 'status': 201, 'status_name': 'ON', 'remain': 12}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `12 → 8`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 정해진 작동시간(12s) 후 스스로 중지 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 141`
- ✅ h) 다시 작동시간 작동 명령 (OPID·202·12s) — `{'success': True, 'data': {'request_id': 'local_1789477699510', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T13:08:19.510Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 202 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 142, 'time': 12, 'opid': 142, 'status': 201, 'remain': 12} (이전 OPID 141)`
- ✅ j) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 142 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 142, 'status': 201, 'status_name': 'ON', 'remain': 10}`
- ✅ k) 쓰기영역에 작동중지 명령 (OPID·0) — `{'success': True, 'data': {'request_id': 'local_1789477701520', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T13:08:21.520Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 143, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ m) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 143`

## 5.5.3 레벨 1 개폐기 제어 시험

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477703535', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T13:08:23.535Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 303 + 동일 작동시간 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 144, 'time': 12, 'opid': 144, 'status': 301, 'remain': 12} (이전 OPID None)`
- ✅ d)e) 읽기영역: OPID 동일 + 상태 열림중(301) 표시 — `명령 OPID 144 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 144, 'status': 301, 'status_name': 'OPENING', 'remain': 10}`
- ✅ f) 남은 작동시간이 적절히 표시·감소 (노드 갱신 주기 ≈ 1.01s, 제어기 표시 주기 2.0s) — `10 → 6 / 4회 변화`
- ✅ g) 쓰기영역에 중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477709571', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T13:08:29.571Z', 'mode': 'local'}}`
- ✅ h)i) 시험장비가 0 수신 → 중지중 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 145, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ j) 읽기영역: 중지중(READY) 표시 + OPID 확인 — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 145`
- ✅ k) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477711580', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T13:08:31.580Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 304 + 동일 작동시간 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 146, 'time': 12, 'opid': 146, 'status': 302, 'remain': 12} (이전 OPID 145)`
- ✅ m)n) 읽기영역: OPID 동일 + 상태 닫힘중(302) 표시 — `명령 OPID 146 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 146, 'status': 302, 'status_name': 'CLOSING', 'remain': 10}`
- ✅ o) 남은 작동시간이 적절히 표시·감소 (노드 갱신 주기 ≈ 1.01s, 제어기 표시 주기 2.0s) — `10 → 6 / 4회 변화`
- ✅ p) 쓰기영역에 중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477717614', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T13:08:37.614Z', 'mode': 'local'}}`
- ✅ q)r) 시험장비가 0 수신 → 중지중 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 147, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ s) 읽기영역: 중지중(READY) 표시 + OPID 확인 — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 147`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.5.2 화면 증적: 제어판 kstest_sw1 「📐 시간 지정 ON」 12초 → 📐 배지 '켜짐 NNs' 감소 → 'READY' 자동 복귀 캡처, 표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s), ④ 진단 프레임(FC16 503~506 / FC03 203~206)
- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 12초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → ■ 정지 → 'READY' → ⏱ 시간 닫기 → '닫히는 중 NNs' → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
