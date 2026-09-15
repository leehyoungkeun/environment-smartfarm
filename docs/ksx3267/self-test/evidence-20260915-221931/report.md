# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 22:19:25
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **2/2 통과**
- 프레임: TX 174 / RX 174 / 예외 4 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.3.1 | 레벨 1 스위치 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할) | SPS-7466 §5.3.1 a)~f) (203 → 미작동·에러/READY → 0 → READY) | ✅ 통과 |
| 5.3.3 | 레벨 1 개폐기 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할) | SPS-7466 §5.3.3 a)~f) (305 → 미작동·에러/READY → 0 → READY) | ✅ 통과 |

## 5.3.1 레벨 1 스위치 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)

- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 쓰기영역에 작동 명령 (OPID·203) — 시험용 강제 송신, 버스로 나감 — `{'ok': False, 'opid': 158, 'exception': 3, 'error': 'exception 0x03 (illegal_data_value)'} ← 노드가 Modbus 예외 3 로 쓰기 자체를 거부`
- ✅ c) 스위치가 작동하지 않음 (시험장비: 작동중 아님·남은시간 0·203 미적용) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 203, 'cmd_opid': 158, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} — 203 수신 기록은 남으나 적용 OPID 0 ≠ 158`
- ✅ d) 읽기영역: 상태가 에러(1~6) 혹은 READY(0) + OPID 확인 — `상태 0(READY), OPID 0 — 명령 OPID 158 와 다름 = 쓰기가 예외로 거부되어 이전 OPID 0 유지`
- ✅ e) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789478367591', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T13:19:27.591Z', 'mode': 'local'}}`
- ✅ f) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 159`

## 5.3.3 레벨 1 개폐기 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동 명령 (OPID·305) — 시험용 강제 송신, 버스로 나감 — `{'ok': False, 'opid': 160, 'exception': 3, 'error': 'exception 0x03 (illegal_data_value)'} ← 노드가 Modbus 예외 3 로 쓰기 자체를 거부`
- ✅ c) 개폐기가 작동하지 않음 (시험장비: 작동중 아님·남은시간 0·305 미적용) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 305, 'cmd_opid': 160, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} — 305 수신 기록은 남으나 적용 OPID 0 ≠ 160`
- ✅ d) 읽기영역: 상태가 에러(1~6) 혹은 READY(0) + OPID 확인 — `상태 0(READY), OPID 0 — 명령 OPID 160 와 다름 = 쓰기가 예외로 거부되어 이전 OPID 0 유지`
- ✅ e) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789478370606', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T13:19:30.606Z', 'mode': 'local'}}`
- ✅ f) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 161`

## 수동 증적 항목 (화면 캡처·저장 확인)

