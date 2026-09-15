# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 23:19:33
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **2/2 통과**
- 프레임: TX 2236 / RX 2236 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.5.3 | 레벨 1 개폐기 제어 시험 | SPS-7466 §5.5.3 a)~s) (화면 → 303 열기 → 여는중·남은시간 → 중지 → READY → 304 닫기 → 닫는중 → 중지 → READY) | ✅ 통과 |
| 5.2.2 | 레벨 1 개폐기 시험 (노드 시험 — 만료·재명령 포함) | SPS-7466 §5.2.2 a)~z) (303 열기·304 닫기 각각 만료 → 중지 명령) | ✅ 통과 |

## 5.5.3 레벨 1 개폐기 제어 시험

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 열기 20s 명령 — `{'success': True, 'data': {'request_id': 'local_1789481973612', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T14:19:33.612Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 작동시간 열기 명령(303) 수신 — 작동시간 20s = 명령 20s — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 172, 'time': 20, 'opid': 172, 'status': 301, 'remain': 20}`
- ✅ d) 시험장비 상태 열림중(301), 작동시간 20s — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 172, 'time': 20, 'opid': 172, 'status': 301, 'remain': 20}`
- ✅ e) 제어기 화면에 열림중(301) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 172, 'status': 301, 'status_name': 'OPENING', 'remain': 19} (명령 OPID 172)`
- ✅ f) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) [(1.0, 19, 19.0), (3.3, 17, 16.7), (5.6, 15, 14.4)] — `허용 오차 폴링 2.0s + 1.5s, 감소 [19, 17, 15]`
- ✅ g) 제어기 인터페이스(화면 경로)로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1789481981547', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:19:41.546Z', 'mode': 'local'}}`
- ✅ h) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 173, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} (작동 명령 OPID 172)`
- ✅ i) 시험장비 상태 중지중(READY, 0) 으로 전이 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 173, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ j) 제어기 화면에 중지중(READY) 표시 — 남은시간 0 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ k) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 닫기 20s 명령 — `{'success': True, 'data': {'request_id': 'local_1789481982567', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T14:19:42.567Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 작동시간 닫기 명령(304) 수신 — 작동시간 20s = 명령 20s — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 174, 'time': 20, 'opid': 174, 'status': 302, 'remain': 20}`
- ✅ m) 시험장비 상태 닫힘중(302), 작동시간 20s — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 174, 'time': 20, 'opid': 174, 'status': 302, 'remain': 20}`
- ✅ n) 제어기 화면에 닫힘중(302) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 174, 'status': 302, 'status_name': 'CLOSING', 'remain': 18} (명령 OPID 174)`
- ✅ o) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) [(2.0, 18, 18.0), (4.3, 16, 15.7), (6.7, 14, 13.3)] — `허용 오차 폴링 2.0s + 1.5s, 감소 [18, 16, 14]`
- ✅ p) 제어기 인터페이스(화면 경로)로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1789481991520', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:19:51.520Z', 'mode': 'local'}}`
- ✅ q) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 175, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} (작동 명령 OPID 174)`
- ✅ r) 시험장비 상태 중지중(READY, 0) 으로 전이 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 175, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ s) 제어기 화면에 중지중(READY) 표시 — 남은시간 0 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`

## 5.2.2 레벨 1 개폐기 시험 (노드 시험 — 만료·재명령 포함)

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789481992543', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T14:19:52.543Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 303 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 176, 'time': 12, 'opid': 176, 'status': 301, 'remain': 12} (이전 OPID None)`
- ✅ d) 읽기영역: OPID 동일 + 상태 여는중(301) — `명령 OPID 176 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 176, 'status': 301, 'status_name': 'OPENING', 'remain': 10}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 작동시간(12s) 동안 열린 후 스스로 중지 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 176`
- ✅ h) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789482006613', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T14:20:06.613Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 304 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 177, 'time': 12, 'opid': 177, 'status': 302, 'remain': 12} (이전 OPID 176)`
- ✅ j) 읽기영역: OPID 동일 + 상태 닫는중(302) — `명령 OPID 177 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 177, 'status': 302, 'status_name': 'CLOSING', 'remain': 10}`
- ✅ k) 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ l) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 0.94s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ m) 작동시간(12s) 동안 닫힌 후 스스로 중지 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ n) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 177`
- ✅ o) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789482020685', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T14:20:20.685Z', 'mode': 'local'}}`
- ✅ p) 시험장비가 303 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 178, 'time': 12, 'opid': 178, 'status': 301, 'remain': 12} (이전 OPID 177)`
- ✅ q) 읽기영역: OPID 동일 + 상태 여는중(301) — `명령 OPID 178 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 178, 'status': 301, 'status_name': 'OPENING', 'remain': 10}`
- ✅ q') 남은 작동시간이 적절히 줄어든다 — `10 → 8`
- ✅ r) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789482025317', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:20:25.317Z', 'mode': 'local'}}`
- ✅ s) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 179, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ t) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 179`
- ✅ u) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789482026827', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T14:20:26.827Z', 'mode': 'local'}}`
- ✅ v) 시험장비가 304 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 180, 'time': 12, 'opid': 180, 'status': 302, 'remain': 12} (이전 OPID 179)`
- ✅ w) 읽기영역: OPID 동일 + 상태 닫는중(302) — `명령 OPID 180 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 180, 'status': 302, 'status_name': 'CLOSING', 'remain': 11}`
- ✅ w') 남은 작동시간이 적절히 줄어든다 — `11 → 9`
- ✅ x) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789482031458', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:20:31.458Z', 'mode': 'local'}}`
- ✅ y) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 181, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ z) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 181`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 20초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → ■ 정지 → 'READY' → ⏱ 시간 닫기 → '닫히는 중 NNs' → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s 실시간 카운트다운), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 12초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → 'READY' 자동 복귀 → ⏱ 시간 닫기 → '닫히는 중' → 자동 복귀 → 다시 열기 → ■ 정지 → 'READY' → 닫기 → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
