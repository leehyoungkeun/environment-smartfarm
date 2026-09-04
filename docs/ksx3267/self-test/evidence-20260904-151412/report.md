# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-04 15:13:55
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **1/1 통과**
- 프레임: TX 2726 / RX 2726 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.5.2 | 레벨 1 스위치 제어 시험 | SPS-7466 §5.5.2 / 5.2.1 b)~m) (202 TIMED_ON → 만료 → 202 → 0 OFF) | ✅ 통과 |

## 5.5.2 레벨 1 스위치 제어 시험

- ✅ b) 쓰기영역에 작동시간 작동 명령 (OPID·202·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1788502435719', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-04T06:13:55.719Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 202 + 동일 작동시간 수신 → 작동 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 48, 'time': 12, 'opid': 48, 'status': 201, 'remain': 12}`
- ✅ d) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 48 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 48, 'status': 201, 'status_name': 'ON', 'remain': 12}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `12 → 8`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 정해진 작동시간(12s) 후 스스로 중지 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 48`
- ✅ h) 다시 작동시간 작동 명령 (OPID·202·12s) — `{'success': True, 'data': {'request_id': 'local_1788502448773', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-04T06:14:08.773Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 202 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 49, 'time': 12, 'opid': 49, 'status': 201, 'remain': 12} (이전 OPID 48)`
- ✅ j) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 49 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 49, 'status': 201, 'status_name': 'ON', 'remain': 11}`
- ✅ k) 쓰기영역에 작동중지 명령 (OPID·0) — `{'success': True, 'data': {'request_id': 'local_1788502450782', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-04T06:14:10.782Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 50, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ m) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 50`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.5.2 화면 증적: 제어판 kstest_sw1 「📐 시간 지정 ON」 12초 → 📐 배지 '켜짐 NNs' 감소 → 'READY' 자동 복귀 캡처, 표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s), ④ 진단 프레임(FC16 503~506 / FC03 203~206)
