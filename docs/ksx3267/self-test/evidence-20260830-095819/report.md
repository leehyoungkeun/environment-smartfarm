# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-08-30 09:57:42
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **7/7 통과**
- 프레임: TX 66 / RX 66 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.4.1 | 연결시험 | SPS-7466 §5.4.1 | ✅ 통과 |
| 5.4.2 | 디폴트 레지스터맵 센서 노드 검색 시험 | SPS-7466 §5.4.2 (KS X 3267 §5.1.2 노드정보 1~8) | ✅ 통과 |
| 5.4.3 | 데이터 확인 시험 | SPS-7466 §5.4.3 (관측치 CDAB float, 상태코드) | ✅ 통과 |
| 5.5.1 | 디폴트 레지스터맵 구동기 노드 검색 시험 | SPS-7466 §5.5.1 | ✅ 통과 |
| 5.5.2 | 레벨 1 스위치 제어 시험 | SPS-7466 §5.5.2 (명령 202 TIMED_ON / 0 OFF) | ✅ 통과 |
| 5.5.3 | 레벨 1 개폐기 제어 시험 | SPS-7466 §5.5.3 (명령 303 TIMED_OPEN / 304 TIMED_CLOSE / 0 STOP) | ✅ 통과 |
| 부가-L2 | 레벨2 명령 미생성 (스코프 선언: 디폴트맵·레벨1 전용) | KS X 3267 6.3.4 / 116 연동장비표 레벨2 × | ✅ 통과 |

## 5.4.1 연결시험

- ✅ a)~d) 시험장비-제어기 통신 연결 (드라이버 /health) — `{'ok': True, 'transport': 'tcp 127.0.0.1:5020', 'nodes': [1, 2], 'stats': {'tx': 12, 'rx': 12, 'exceptions': 0, 'timeouts': 0}}`
- ✅ 시험장비(시뮬레이터) 응답 — `{'ok': True, 'units': {'1': 'actuator', '2': 'sensor'}}`

## 5.4.2 디폴트 레지스터맵 센서 노드 검색 시험

- ✅ b) 시험장비 노드 스펙 조회 — `attached=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]`
- ✅ c) 디폴트 레지스터맵 센서 노드 인지 — `{'kind': 'sensor', 'default_map': True, 'supported': True, 'product_type': 1, 'protocol_version': 10, 'channels': 30, 'serial': 0}`
- ✅    노드정보 1~6 디폴트값 (기관 0, 회사 0, 제품타입 1, 제품코드 0, 프로토콜 10, 채널 30)
- ✅ d) 연결된 센서 개수·종류가 설정대로 인식 — `제어기=[(1, 1), (2, 1), (3, 1), (4, 2), (5, 3), (6, 4), (7, 5), (8, 6), (9, 7), (10, 8), (11, 9), (12, 10), (13, 11), (14, 12), (15, 13), (16, 14), (17, 15), (18, 16), (19, 17), (20, 1), (21, 1), (22, 1), (23, 1), (24, 1), (25, 1), (26, 1), (27, 2), (28, 2), (29, 18), (30, 18)] 시험장비=[(1, 1), (2, 1), (3, 1), (4, 2), (5, 3), (6, 4), (7, 5), (8, 6), (9, 7), (10, 8), (11, 9), (12, 10), (13, 11), (14, 12), (15, 13), (16, 14), (17, 15), (18, 16), (19, 17), (20, 1), (21, 1), (22, 1), (23, 1), (24, 1), (25, 1), (26, 1), (27, 2), (28, 2), (29, 18), (30, 18)]`

## 5.4.3 데이터 확인 시험

- ✅ b) 관측치 21.5 읽기 — `{'name': '온도1', 'code': 1, 'value': 21.5, 'status': 0, 'status_name': 'READY'}`
- ✅ b) 관측치 30.25 읽기 — `{'name': '온도1', 'code': 1, 'value': 30.25, 'status': 0, 'status_name': 'READY'}`
- ✅ b) 관측치 -3.0 읽기 — `{'name': '온도1', 'code': 1, 'value': -3.0, 'status': 0, 'status_name': 'READY'}`
- ✅ b) 관측치 28.8 읽기 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 0, 'status_name': 'READY'}`
- ✅ d) 센서 상태 103(NEED_CHECK) 읽기 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 103, 'status_name': 'NEED_CHECK'}`
- ✅ d) 센서 상태 102(NEED_CALIBRATION) 읽기 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 102, 'status_name': 'NEED_CALIBRATION'}`
- ✅ d) 센서 상태 0(READY) 읽기 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 0, 'status_name': 'READY'}`

## 5.5.1 디폴트 레지스터맵 구동기 노드 검색 시험

- ✅ c) 디폴트 레지스터맵 구동기 노드 인지 — `{'kind': 'actuator', 'product_type': 2, 'protocol_version': 10, 'channels': 24}`
- ✅    노드정보: 제품타입 2, 프로토콜 10, 채널 24
- ✅ d) 연결된 구동기 개수·종류(코드 102 스위치/112 개폐기 레벨1)가 설정대로 인식 — `제어기 24개 / 시험장비 24개, 불일치=[]`

## 5.5.2 레벨 1 스위치 제어 시험

- ✅ b) 제어기 인터페이스 경로로 작동시간 명령 (on 20s) — `{'success': True, 'data': {'request_id': 'local_1788051474783', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-08-30T00:57:54.783Z', 'mode': 'local'}}`
- ✅ c) 시험장비에서 작동시간 명령(202) 수신, 작동시간 동일 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 1, 'time': 20, 'opid': 1, 'status': 201, 'remain': 20}`
- ✅ d)e) 시험장비 작동중(201) → 제어기 표시 상태 켜짐 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 1, 'status': 201, 'status_name': 'ON', 'remain': 18}`
- ✅ f) 남은 작동시간이 줄어든다 — `18 → 14`
- ✅ g) 제어기 인터페이스 경로로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1788051481097', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-08-30T00:58:01.097Z', 'mode': 'local'}}`
- ✅ h) 시험장비에서 중지 명령(0) 수신 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 2, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ i)j) 시험장비 중지중 → 제어기 표시 READY — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`

## 5.5.3 레벨 1 개폐기 제어 시험

- ✅ 열기: 제어기 인터페이스 경로로 작동시간 열기 명령 (15s) — `{'success': True, 'data': {'request_id': 'local_1788051483107', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-08-30T00:58:03.107Z', 'mode': 'local'}}`
- ✅ 열기: 시험장비에서 명령(303) 수신, 작동시간 동일 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 3, 'time': 15, 'opid': 3, 'status': 301, 'remain': 15}`
- ✅ 열기: 시험장비 열림중(301) → 제어기 표시 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 3, 'status': 301, 'status_name': 'OPENING', 'remain': 14}`
- ✅ 열기: 남은 작동시간이 줄어든다 — `14 → 10`
- ✅ 열기: 제어기 인터페이스 경로로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1788051489418', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-08-30T00:58:09.418Z', 'mode': 'local'}}`
- ✅ 열기: 시험장비에서 중지 명령(0) 수신 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 4, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ 열기: 시험장비 중지중 → 제어기 표시 READY — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ 닫기: 제어기 인터페이스 경로로 작동시간 닫기 명령 (15s) — `{'success': True, 'data': {'request_id': 'local_1788051490926', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-08-30T00:58:10.926Z', 'mode': 'local'}}`
- ✅ 닫기: 시험장비에서 명령(304) 수신, 작동시간 동일 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 5, 'time': 15, 'opid': 5, 'status': 302, 'remain': 15}`
- ✅ 닫기: 시험장비 닫힘중(302) → 제어기 표시 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 5, 'status': 302, 'status_name': 'CLOSING', 'remain': 13}`
- ✅ 닫기: 남은 작동시간이 줄어든다 — `13 → 9`
- ✅ 닫기: 제어기 인터페이스 경로로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1788051497237', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-08-30T00:58:17.237Z', 'mode': 'local'}}`
- ✅ 닫기: 시험장비에서 중지 명령(0) 수신 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 6, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ 닫기: 시험장비 중지중 → 제어기 표시 READY — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`

## 부가-L2 레벨2 명령 미생성 (스코프 선언: 디폴트맵·레벨1 전용)

- ✅ 드라이버가 레벨2(SET_POSITION) 를 로컬에서 거부 (버스로 안 나감) — `{'ok': False, 'error': '명령 set_position: 레벨1 opener 에서 미지원 (레벨2/자동등록 전용)'}`
- ✅ 시험장비 명령 블록 변화 없음 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 6, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.4.4 데이터 저장 시험(10분 이상): 센서를 하우스/센서 탭에서 표준 노드에 매핑(temp_std ← U2 센서1) 후 10분 뒤 API `GET /api/sensors/farm_0001/house_0001/history?startDate=…` 로 1분 단위 저장 확인 — 이 스크립트는 운영 houseConfig 를 건드리지 않는다
- [ ] §5.5.2 e)f)j) 화면 증적: 제어판의 kstest_sw1 카드 📐 배지가 '켜짐 NNs' → 'READY' 로 바뀌는 캡처 (테스트 장치를 houseConfig 에 매핑한 상태에서 수행) + 표준노드 탭 U1 스위치1 행
- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 📐 배지 '열리는 중 NNs' / '닫히는 중 NNs' / 'READY' 캡처
