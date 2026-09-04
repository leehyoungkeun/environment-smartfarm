# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-04 16:38:32
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **1/1 통과**
- 프레임: TX 688 / RX 688 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.5.3 | 레벨 1 개폐기 제어 시험 | SPS-7466 §5.5.3 b)~s) (303 TIMED_OPEN / 304 TIMED_CLOSE / 0 STOP) | ✅ 통과 |

## 5.5.3 레벨 1 개폐기 제어 시험

- ✅ b) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1788507512695', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-04T07:38:32.695Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 303 + 동일 작동시간 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 90, 'time': 12, 'opid': 90, 'status': 301, 'remain': 12} (이전 OPID None)`
- ✅ d)e) 읽기영역: OPID 동일 + 상태 열림중(301) 표시 — `명령 OPID 90 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 90, 'status': 301, 'status_name': 'OPENING', 'remain': 12}`
- ✅ f) 남은 작동시간이 적절히 표시·감소 (노드 갱신 주기 ≈ 1.01s, 제어기 표시 주기 2.0s) — `12 → 8 / 4회 변화`
- ✅ g) 쓰기영역에 중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1788507517226', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-04T07:38:37.226Z', 'mode': 'local'}}`
- ✅ h)i) 시험장비가 0 수신 → 중지중 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 91, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ j) 읽기영역: 중지중(READY) 표시 + OPID 확인 — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 91`
- ✅ k) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1788507519238', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-04T07:38:39.238Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 304 + 동일 작동시간 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 92, 'time': 12, 'opid': 92, 'status': 302, 'remain': 12} (이전 OPID 91)`
- ✅ m)n) 읽기영역: OPID 동일 + 상태 닫힘중(302) 표시 — `명령 OPID 92 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 92, 'status': 302, 'status_name': 'CLOSING', 'remain': 11}`
- ✅ o) 남은 작동시간이 적절히 표시·감소 (노드 갱신 주기 ≈ 1.01s, 제어기 표시 주기 2.0s) — `11 → 7 / 3회 변화`
- ✅ p) 쓰기영역에 중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1788507525281', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-04T07:38:45.281Z', 'mode': 'local'}}`
- ✅ q)r) 시험장비가 0 수신 → 중지중 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 93, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ s) 읽기영역: 중지중(READY) 표시 + OPID 확인 — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 93`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 12초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → ■ 정지 → 'READY' → ⏱ 시간 닫기 → '닫히는 중 NNs' → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
