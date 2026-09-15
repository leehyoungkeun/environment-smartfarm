# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 23:15:26
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **2/2 통과**
- 프레임: TX 1934 / RX 1934 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.5.2 | 레벨 1 스위치 제어 시험 | SPS-7466 §5.5.2 a)~j) (화면 → 202 작동시간 → 작동중·남은시간 표시 → 화면 중지 → READY 표시) | ✅ 통과 |
| 5.2.1 | 레벨 1 스위치 시험 (노드 시험 — 만료·재명령 포함) | SPS-7466 §5.2.1 a)~m) (202 TIMED_ON → 만료 → 202 → 0 OFF) | ✅ 통과 |

## 5.5.2 레벨 1 스위치 제어 시험

- ✅ a) 5.5.1 수행됨 — 디폴트맵 구동기 노드(제품타입 2·채널 24) 로 탐색됨 — `{'kind': 'actuator', 'default_map': True, 'product_type': 2, 'channels': 24}`
- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 20s 명령 — `{'success': True, 'data': {'request_id': 'local_1789481726727', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T14:15:26.727Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 작동시간 명령(202) 수신 — 작동시간 20s = 명령 20s — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 167, 'time': 20, 'opid': 167, 'status': 201, 'remain': 20}`
- ✅ d) 시험장비 상태 작동중(201) — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 167, 'time': 20, 'opid': 167, 'status': 201, 'remain': 20}`
- ✅ e) 제어기 화면에 작동중(201) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 167, 'status': 201, 'status_name': 'ON', 'remain': 19} (명령 OPID 167)`
- ✅ f) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) [(1.5, 19, 18.5), (3.8, 17, 16.2), (6.1, 15, 13.9)] — `허용 오차 폴링 2.0s + 1.5s, 감소 [19, 17, 15]`
- ✅ g) 제어기 인터페이스(화면 경로)로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1789481735170', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T14:15:35.170Z', 'mode': 'local'}}`
- ✅ h) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 168, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} (작동 명령 OPID 167)`
- ✅ i) 시험장비 상태 중지중(READY, 0) 으로 전이 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 168, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ j) 제어기 화면에 중지중(READY) 표시 — 남은시간 0 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`

## 5.2.1 레벨 1 스위치 시험 (노드 시험 — 만료·재명령 포함)

- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 작동 명령 (OPID·202·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789481736195', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T14:15:36.195Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 202 + 동일 작동시간 수신 → 작동 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 169, 'time': 12, 'opid': 169, 'status': 201, 'remain': 12}`
- ✅ d) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 169 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 169, 'status': 201, 'status_name': 'ON', 'remain': 10}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 정해진 작동시간(12s) 후 스스로 중지 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 169`
- ✅ h) 다시 작동시간 작동 명령 (OPID·202·12s) — `{'success': True, 'data': {'request_id': 'local_1789481750262', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T14:15:50.262Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 202 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 170, 'time': 12, 'opid': 170, 'status': 201, 'remain': 12} (이전 OPID 169)`
- ✅ j) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 170 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 170, 'status': 201, 'status_name': 'ON', 'remain': 10}`
- ✅ k) 쓰기영역에 작동중지 명령 (OPID·0) — `{'success': True, 'data': {'request_id': 'local_1789481752272', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T14:15:52.272Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 171, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ m) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 171`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.5.2 화면 증적: 제어판 kstest_sw1 「📐 시간 지정 ON」 20초 → 📐 배지 '켜짐 NNs' 감소 → ■ OFF → 'READY' 캡처, 표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s 실시간 카운트다운), ④ 진단 프레임(FC16 503~506 / FC03 203~206)
- [ ] §5.5.2 화면 증적: 제어판 kstest_sw1 「📐 시간 지정 ON」 12초 → 📐 배지 '켜짐 NNs' 감소 → 'READY' 자동 복귀 캡처, 표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s), ④ 진단 프레임(FC16 503~506 / FC03 203~206)
