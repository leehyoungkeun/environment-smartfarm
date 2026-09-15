# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 22:10:50
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **1/1 통과**
- 프레임: TX 2321 / RX 2078 / 예외 0 / 타임아웃 243 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.5.3 | 레벨 1 개폐기 제어 시험 | SPS-7466 §5.5.3 / 5.2.2 a)~z) (303 열기·304 닫기 각각 만료 → 중지 명령) | ✅ 통과 |

## 5.5.3 레벨 1 개폐기 제어 시험

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477850291', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T13:10:50.291Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 303 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 148, 'time': 12, 'opid': 148, 'status': 301, 'remain': 12} (이전 OPID None)`
- ✅ d) 읽기영역: OPID 동일 + 상태 여는중(301) — `명령 OPID 148 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 148, 'status': 301, 'status_name': 'OPENING', 'remain': 11}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `11 → 7`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 0.94s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 작동시간(12s) 동안 열린 후 스스로 중지 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 148`
- ✅ h) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477863845', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T13:11:03.845Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 304 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 149, 'time': 12, 'opid': 149, 'status': 302, 'remain': 12} (이전 OPID 148)`
- ✅ j) 읽기영역: OPID 동일 + 상태 닫는중(302) — `명령 OPID 149 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 149, 'status': 302, 'status_name': 'CLOSING', 'remain': 10}`
- ✅ k) 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ l) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ m) 작동시간(12s) 동안 닫힌 후 스스로 중지 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ n) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 149`
- ✅ o) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477877908', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T13:11:17.908Z', 'mode': 'local'}}`
- ✅ p) 시험장비가 303 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 150, 'time': 12, 'opid': 150, 'status': 301, 'remain': 12} (이전 OPID 149)`
- ✅ q) 읽기영역: OPID 동일 + 상태 여는중(301) — `명령 OPID 150 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 150, 'status': 301, 'status_name': 'OPENING', 'remain': 10}`
- ✅ q') 남은 작동시간이 적절히 줄어든다 — `10 → 8`
- ✅ r) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477882539', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T13:11:22.539Z', 'mode': 'local'}}`
- ✅ s) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 151, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ t) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 151`
- ✅ u) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477884050', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T13:11:24.050Z', 'mode': 'local'}}`
- ✅ v) 시험장비가 304 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 152, 'time': 12, 'opid': 152, 'status': 302, 'remain': 12} (이전 OPID 151)`
- ✅ w) 읽기영역: OPID 동일 + 상태 닫는중(302) — `명령 OPID 152 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 152, 'status': 302, 'status_name': 'CLOSING', 'remain': 11}`
- ✅ w') 남은 작동시간이 적절히 줄어든다 — `11 → 9`
- ✅ x) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789477888677', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T13:11:28.677Z', 'mode': 'local'}}`
- ✅ y) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 153, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ z) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 153`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 12초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → 'READY' 자동 복귀 → ⏱ 시간 닫기 → '닫히는 중' → 자동 복귀 → 다시 열기 → ■ 정지 → 'READY' → 닫기 → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
