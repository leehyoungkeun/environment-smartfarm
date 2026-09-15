# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 23:50:33
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **13/13 통과**
- 프레임: TX 1086 / RX 1075 / 예외 11 / 타임아웃 35 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.4.1 | 연결시험 | SPS-7466 §5.4.1 a)~d) + 당일 준비 점검 | ✅ 통과 |
| 5.4.2 | 디폴트 레지스터맵 센서 노드 검색 시험 | SPS-7466 §5.4.2 a)~d) (KS X 3267 노드정보 1~8 · 디바이스 코드 101~) | ✅ 통과 |
| 5.4.3 | 데이터 확인 시험 | SPS-7466 §5.4.3 a)~d) (관측치 CDAB float · 상태코드 주기 변경) | ✅ 통과 |
| 5.5.1 | 디폴트 레지스터맵 구동기 노드 검색 시험 | SPS-7466 §5.5.1 a)~d) (노드정보 1~8 · 디바이스 코드 102/112) | ✅ 통과 |
| 5.5.2 | 레벨 1 스위치 제어 시험 | SPS-7466 §5.5.2 a)~j) (화면 → 202 작동시간 → 작동중·남은시간 표시 → 화면 중지 → READY 표시) | ✅ 통과 |
| 5.5.3 | 레벨 1 개폐기 제어 시험 | SPS-7466 §5.5.3 a)~s) (화면 → 303 열기 → 여는중·남은시간 → 중지 → READY → 304 닫기 → 닫는중 → 중지 → READY) | ✅ 통과 |
| 부가-L2 | 레벨2 명령 미생성 (스코프 선언: 디폴트맵·레벨1 전용) | KS X 3267 6.3.4 / 116 연동장비표 레벨2 × / §5.3.1 b) 203·§5.3.2 305 는 제어기가 내지 않는다 | ✅ 통과 |
| 5.2.1 | 레벨 1 스위치 시험 (노드 시험 — 만료·재명령 포함) | SPS-7466 §5.2.1 a)~m) (202 TIMED_ON → 만료 → 202 → 0 OFF) | ✅ 통과 |
| 5.2.2 | 레벨 1 개폐기 시험 (노드 시험 — 만료·재명령 포함) | SPS-7466 §5.2.2 a)~z) (303 열기·304 닫기 각각 만료 → 중지 명령) | ✅ 통과 |
| 5.3.1 | 레벨 1 스위치 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할) | SPS-7466 §5.3.1 a)~f) (203 → 미작동·에러/READY → 0 → READY) | ✅ 통과 |
| 5.3.3 | 레벨 1 개폐기 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할) | SPS-7466 §5.3.3 a)~f) (305 → 미작동·에러/READY → 0 → READY) | ✅ 통과 |
| 5.3.4 | 레벨 1 개폐기 동일 OPID 명령 시험 (노드 시험 — 드라이버가 시험장비 역할) | SPS-7466 §5.3.4 a)~y) (같은 OPID 무시 · 새 OPID 로 활성화, 303/304 각각) | ✅ 통과 |
| 116-재연결 | 연결단자 해제·재연결 후 2분 이내 정상 복귀 (5회) | KOAT 검정기준 116/117 통합제어기 마. 시험방법 1-가)·2-가) | ✅ 통과 |

## 5.4.1 연결시험

- ✅ a) 시험장비-제어기 연결 — 시뮬레이터 환경: 루프백 TCP 가 RS485 케이블을 대신 — `tcp 127.0.0.1:5020 · 열림 / 시험장비 {'ok': True, 'units': {'1': 'actuator', '2': 'sensor'}}`
- ✅ b) 시험장비 통신 설정 — 시뮬레이터 --tcp 5020, 노드 주소 2(센서)·1(구동기) — `{'ok': True, 'units': {'1': 'actuator', '2': 'sensor'}}`
- ✅ c) 제어기 통신 설정 — 시뮬레이터 주소로 연결됨 (당일엔 RS485·표준 포트·9600) — `tcp 127.0.0.1:5020`
- ✅ c') 노드 슬레이브 아이디 입력 2 — `2`
- ✅ d) 통신 연결 수행 — 센서 노드 2 응답 — `센서 노드 · 프로토콜 10 · 채널 30`
- ✅ d) 통신 연결 수행 — 구동기 노드 1 응답 — `구동기 노드 · 프로토콜 10 · 채널 24`
- ✅ 준비) 표준 노드 포트(FTDI, 고정 이름 /dev/smartfarm-485-std) 인식 — `표준 노드 포트 · FTDI · ttyUSB1`
- ✅ 준비) 표준 포트 열림 시험 (9600 8N1) — `열고 닫음 · 정상`

## 5.4.2 디폴트 레지스터맵 센서 노드 검색 시험

- ✅ a) 5.4.1 연결시험 이후 — 연결 시험 d) 노드 2 응답 — `센서 노드 · 프로토콜 10 · 채널 30`
- ✅ b) 시험장비 노드 스펙 설정 — 센서 5개: 온도 3 · 습도 1 · CO2 1 (순번 [1, 2, 3, 4, 13]) — `{'ok': True, 'unit': 2, 'kind': 'sensor', 'attached': [1, 2, 3, 4, 13], 'devices': {'1': 1, '2': 1, '3': 1, '4': 2, '13': 11}}`
- ✅ c) 제어기가 노드정보를 읽어 디폴트 레지스터맵 센서 노드로 인지 — `{'kind': 'sensor', 'default_map': True, 'supported': True, 'product_type': 1, 'protocol_version': 10, 'channels': 30, 'serial': 0}`
- ✅    노드정보 1~6 디폴트값 (기관 0, 회사 0, 제품타입 1, 제품코드 0, 프로토콜 10, 채널 30)
- ✅ d) 연결된 센서 개수·종류가 설정대로 — 제어기 5개 온도 3 · 습도 1 · CO2 1 / 설정 5개 온도 3 · 습도 1 · CO2 1 — `제어기=[(1, 1), (2, 1), (3, 1), (4, 2), (13, 11)] 시험장비=[(1, 1), (2, 1), (3, 1), (4, 2), (13, 11)]`
- ✅ d') 스펙을 전체로 되돌린 뒤 — 제어기 30개 온도 10 · 습도 3 · 이슬점 1 · 감우 1 · 유량 1 · 강우 1 · 일사 1 · 풍속 1 · 풍향 1 · 전압 1 · CO2 1 · EC 1 · 광양자 1 · 토양함수율 1 · 토양수분장력 1 · pH 1 · 지온 1 · 무게 2 / 설정 30개 — `제어기=[(1, 1), (2, 1), (3, 1), (4, 2), (5, 3), (6, 4), (7, 5), (8, 6), (9, 7), (10, 8), (11, 9), (12, 10), (13, 11), (14, 12), (15, 13), (16, 14), (17, 15), (18, 16), (19, 17), (20, 1), (21, 1), (22, 1), (23, 1), (24, 1), (25, 1), (26, 1), (27, 2), (28, 2), (29, 18), (30, 18)]`

## 5.4.3 데이터 확인 시험

- ✅ a)b) 관측치 21.5 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': 21.5, 'status': 0, 'status_name': 'READY'}`
- ✅ a)b) 관측치 30.25 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': 30.25, 'status': 0, 'status_name': 'READY'}`
- ✅ a)b) 관측치 -3.0 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': -3.0, 'status': 0, 'status_name': 'READY'}`
- ✅ a)b) 관측치 28.8 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 0, 'status_name': 'READY'}`
- ✅ c) 시험장비 상태를 4.0s 주기로 [103, 102, 0] 순환하도록 설정 — `{'ok': True, 'index': 1, 'cycle': {'values': [], 'statuses': [103, 102, 0], 'period': 4.0}}`
- ✅ d) 제어기가 상태 변화를 매번 순서대로 읽음 — 관측 [103, 102, 0, 103] — `변화 이력 4건, 상태명 ['NEED_CHECK', 'NEED_CALIBRATION', 'READY', 'NEED_CHECK']`
- ✅ d') 변화 간격 ≈ 설정 주기 4.0s (폴링 2.0s 오차 내) — `간격 [4.0, 4.0, 4.0]s`
- ✅    해제 후 상태 0(READY) 복귀 확인 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 0, 'status_name': 'READY'}`

## 5.5.1 디폴트 레지스터맵 구동기 노드 검색 시험

- ✅ a) 5.4.1 연결시험 이후 — 연결 시험 d) 노드 1 응답 — `구동기 노드 · 프로토콜 10 · 채널 24`
- ✅ b) 시험장비 노드 스펙 설정 — 구동기 5개: 스위치 3 · 개폐기 2 (순번 [1, 2, 3, 17, 18]) — `{'ok': True, 'unit': 1, 'kind': 'actuator', 'attached': [1, 2, 3, 17, 18], 'devices': {'1': 102, '2': 102, '3': 102, '17': 112, '18': 112}}`
- ✅ c) 제어기가 노드정보를 읽어 디폴트 레지스터맵 구동기 노드로 인지 — `{'kind': 'actuator', 'default_map': True, 'supported': True, 'product_type': 2, 'protocol_version': 10, 'channels': 24, 'serial': 0}`
- ✅    노드정보 1~6 디폴트값 (기관 0, 회사 0, 제품타입 2, 제품코드 0, 프로토콜 10, 채널 24)
- ✅ d) 연결된 구동기 개수·종류가 설정대로 — 제어기 5개 스위치 3 · 개폐기 2 / 설정 5개 스위치 3 · 개폐기 2 — `제어기=[(1, 102), (2, 102), (3, 102), (17, 112), (18, 112)] 시험장비=[(1, 102), (2, 102), (3, 102), (17, 112), (18, 112)]`
- ✅ d') 스펙을 전체로 되돌린 뒤 — 제어기 24개 스위치 16 · 개폐기 8 / 설정 24개 — `제어기=[(1, 102), (2, 102), (3, 102), (4, 102), (5, 102), (6, 102), (7, 102), (8, 102), (9, 102), (10, 102), (11, 102), (12, 102), (13, 102), (14, 102), (15, 102), (16, 102), (17, 112), (18, 112), (19, 112), (20, 112), (21, 112), (22, 112), (23, 112), (24, 112)]`

## 5.5.2 레벨 1 스위치 제어 시험

- ✅ a) 5.5.1 수행됨 — 디폴트맵 구동기 노드(제품타입 2·채널 24) 로 탐색됨 — `{'kind': 'actuator', 'default_map': True, 'product_type': 2, 'channels': 24}`
- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 20s 명령 — `{'success': True, 'data': {'request_id': 'local_1789483858967', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T14:50:58.967Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 작동시간 명령(202) 수신 — 작동시간 20s = 명령 20s — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 184, 'time': 20, 'opid': 184, 'status': 201, 'remain': 20}`
- ✅ d) 시험장비 상태 작동중(201) — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 184, 'time': 20, 'opid': 184, 'status': 201, 'remain': 20}`
- ✅ e) 제어기 화면에 작동중(201) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 184, 'status': 201, 'status_name': 'ON', 'remain': 18} (명령 OPID 184)`
- ✅ f) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) [(2.0, 18, 18.0), (4.3, 16, 15.7), (6.7, 14, 13.3)] — `허용 오차 폴링 2.0s + 1.5s, 감소 [18, 16, 14]`
- ✅ g) 제어기 인터페이스(화면 경로)로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1789483867925', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T14:51:07.925Z', 'mode': 'local'}}`
- ✅ h) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 185, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} (작동 명령 OPID 184)`
- ✅ i) 시험장비 상태 중지중(READY, 0) 으로 전이 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 185, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ j) 제어기 화면에 중지중(READY) 표시 — 남은시간 0 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`

## 5.5.3 레벨 1 개폐기 제어 시험

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 열기 20s 명령 — `{'success': True, 'data': {'request_id': 'local_1789483868948', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T14:51:08.948Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 작동시간 열기 명령(303) 수신 — 작동시간 20s = 명령 20s — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 186, 'time': 20, 'opid': 186, 'status': 301, 'remain': 20}`
- ✅ d) 시험장비 상태 열림중(301), 작동시간 20s — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 186, 'time': 20, 'opid': 186, 'status': 301, 'remain': 20}`
- ✅ e) 제어기 화면에 열림중(301) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 186, 'status': 301, 'status_name': 'OPENING', 'remain': 18} (명령 OPID 186)`
- ✅ f) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) [(2.0, 18, 18.0), (4.3, 16, 15.7), (6.6, 14, 13.4)] — `허용 오차 폴링 2.0s + 1.5s, 감소 [18, 16, 14]`
- ✅ g) 제어기 인터페이스(화면 경로)로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1789483877899', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:51:17.899Z', 'mode': 'local'}}`
- ✅ h) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 187, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} (작동 명령 OPID 186)`
- ✅ i) 시험장비 상태 중지중(READY, 0) 으로 전이 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 187, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ j) 제어기 화면에 중지중(READY) 표시 — 남은시간 0 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ k) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 닫기 20s 명령 — `{'success': True, 'data': {'request_id': 'local_1789483878918', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T14:51:18.918Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 작동시간 닫기 명령(304) 수신 — 작동시간 20s = 명령 20s — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 188, 'time': 20, 'opid': 188, 'status': 302, 'remain': 20}`
- ✅ m) 시험장비 상태 닫힘중(302), 작동시간 20s — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 188, 'time': 20, 'opid': 188, 'status': 302, 'remain': 20}`
- ✅ n) 제어기 화면에 닫힘중(302) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 188, 'status': 302, 'status_name': 'CLOSING', 'remain': 18} (명령 OPID 188)`
- ✅ o) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) [(2.0, 18, 18.0), (4.3, 16, 15.7), (6.6, 14, 13.4)] — `허용 오차 폴링 2.0s + 1.5s, 감소 [18, 16, 14]`
- ✅ p) 제어기 인터페이스(화면 경로)로 중지 명령 — `{'success': True, 'data': {'request_id': 'local_1789483887860', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:51:27.860Z', 'mode': 'local'}}`
- ✅ q) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 189, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} (작동 명령 OPID 188)`
- ✅ r) 시험장비 상태 중지중(READY, 0) 으로 전이 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 189, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ s) 제어기 화면에 중지중(READY) 표시 — 남은시간 0 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`

## 부가-L2 레벨2 명령 미생성 (스코프 선언: 디폴트맵·레벨1 전용)

- ✅ 드라이버가 switch1 에 203 (레벨2 방향성 ON, §5.3.1 b)) 를 로컬에서 거부 — `{'ok': False, 'error': '명령 203: 레벨1 switch 에서 미지원 (레벨2/자동등록 전용)'}`
- ✅    시험장비 switch1 명령 블록 변화 없음 (버스로 안 나감) — `cmd/OPID 0/185 → 0/185, 상태 0`
- ✅ 드라이버가 opener1 에 305 (SET_POSITION) 를 로컬에서 거부 — `{'ok': False, 'error': '명령 set_position: 레벨1 opener 에서 미지원 (레벨2/자동등록 전용)'}`
- ✅    시험장비 opener1 명령 블록 변화 없음 (버스로 안 나감) — `cmd/OPID 0/189 → 0/189, 상태 0`
- ✅ 드라이버가 opener1 에 306 (SET_CONFIG) 를 로컬에서 거부 — `{'ok': False, 'error': '명령 306: 레벨1 opener 에서 미지원 (레벨2/자동등록 전용)'}`
- ✅    시험장비 opener1 명령 블록 변화 없음 (버스로 안 나감) — `cmd/OPID 0/189 → 0/189, 상태 0`

## 5.2.1 레벨 1 스위치 시험 (노드 시험 — 만료·재명령 포함)

- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 작동 명령 (OPID·202·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483888896', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T14:51:28.896Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 202 + 동일 작동시간 수신 → 작동 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 190, 'time': 12, 'opid': 190, 'status': 201, 'remain': 12}`
- ✅ d) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 190 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 190, 'status': 201, 'status_name': 'ON', 'remain': 10}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 정해진 작동시간(12s) 후 스스로 중지 — `{'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 190`
- ✅ h) 다시 작동시간 작동 명령 (OPID·202·12s) — `{'success': True, 'data': {'request_id': 'local_1789483902969', 'device_id': 'kstest_sw1', 'command': 'on', 'executed_at': '2026-09-15T14:51:42.969Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 202 수신 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 202, 'cmd_opid': 191, 'time': 12, 'opid': 191, 'status': 201, 'remain': 12} (이전 OPID 190)`
- ✅ j) 읽기영역: OPID 동일 + 상태 작동중(201) — `명령 OPID 191 / 읽은 {'name': '스위치1', 'kind': 'switch', 'n': 1, 'opid': 191, 'status': 201, 'status_name': 'ON', 'remain': 10}`
- ✅ k) 쓰기영역에 작동중지 명령 (OPID·0) — `{'success': True, 'data': {'request_id': 'local_1789483904981', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T14:51:44.981Z', 'mode': 'local'}}`
- ✅ l) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 0, 'cmd_opid': 192, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ m) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 192`

## 5.2.2 레벨 1 개폐기 시험 (노드 시험 — 만료·재명령 포함)

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483906995', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T14:51:46.995Z', 'mode': 'local'}}`
- ✅ c) 시험장비가 303 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 193, 'time': 12, 'opid': 193, 'status': 301, 'remain': 12} (이전 OPID None)`
- ✅ d) 읽기영역: OPID 동일 + 상태 여는중(301) — `명령 OPID 193 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 193, 'status': 301, 'status_name': 'OPENING', 'remain': 10}`
- ✅ d') 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ f) 작동시간(12s) 동안 열린 후 스스로 중지 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 193`
- ✅ h) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483921056', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T14:52:01.056Z', 'mode': 'local'}}`
- ✅ i) 시험장비가 304 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 194, 'time': 12, 'opid': 194, 'status': 302, 'remain': 12} (이전 OPID 193)`
- ✅ j) 읽기영역: OPID 동일 + 상태 닫는중(302) — `명령 OPID 194 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 194, 'status': 302, 'status_name': 'CLOSING', 'remain': 10}`
- ✅ k) 남은 작동시간이 적절히 줄어든다 — `10 → 6`
- ✅ l) 남은시간 업데이트 주기 (노드 레지스터 직접 측정) — `노드 갱신 주기 ≈ 1.01s (4회 변화 관측) / 제어기 폴링·표시 주기 2.0s`
- ✅ m) 작동시간(12s) 동안 닫힌 후 스스로 중지 — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ n) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 194`
- ✅ o) 쓰기영역에 작동시간 열기 명령 (OPID·303·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483935120', 'device_id': 'kstest_op1', 'command': 'open', 'executed_at': '2026-09-15T14:52:15.120Z', 'mode': 'local'}}`
- ✅ p) 시험장비가 303 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 195, 'time': 12, 'opid': 195, 'status': 301, 'remain': 12} (이전 OPID 194)`
- ✅ q) 읽기영역: OPID 동일 + 상태 여는중(301) — `명령 OPID 195 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 195, 'status': 301, 'status_name': 'OPENING', 'remain': 11}`
- ✅ q') 남은 작동시간이 적절히 줄어든다 — `11 → 9`
- ✅ r) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483939754', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:52:19.754Z', 'mode': 'local'}}`
- ✅ s) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 196, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ t) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 196`
- ✅ u) 쓰기영역에 작동시간 닫기 명령 (OPID·304·12s) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483941265', 'device_id': 'kstest_op1', 'command': 'close', 'executed_at': '2026-09-15T14:52:21.265Z', 'mode': 'local'}}`
- ✅ v) 시험장비가 304 + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 197, 'time': 12, 'opid': 197, 'status': 302, 'remain': 12} (이전 OPID 196)`
- ✅ w) 읽기영역: OPID 동일 + 상태 닫는중(302) — `명령 OPID 197 / 읽은 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 197, 'status': 302, 'status_name': 'CLOSING', 'remain': 11}`
- ✅ w') 남은 작동시간이 적절히 줄어든다 — `11 → 9`
- ✅ x) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483945895', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:52:25.895Z', 'mode': 'local'}}`
- ✅ y) 시험장비가 0 수신 → 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 198, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ z) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 198`

## 5.3.1 레벨 1 스위치 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)

- ✅ a) 디바이스코드에 레벨 1 스위치(102) 포함 — switch1 — `탐색 코드 102 (디폴트맵 순번 1, 노드 1)`
- ✅ b) 쓰기영역에 작동 명령 (OPID·203) — 시험용 강제 송신, 버스로 나감 — `{'ok': False, 'opid': 199, 'exception': 3, 'error': 'exception 0x03 (illegal_data_value)'} ← 노드가 Modbus 예외 3 로 쓰기 자체를 거부`
- ✅ c) 스위치가 작동하지 않음 (시험장비: 작동중 아님·남은시간 0·203 미적용) — `{'ok': True, 'kind': 'switch', 'n': 1, 'cmd': 203, 'cmd_opid': 199, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} — 203 수신 기록은 남으나 적용 OPID 0 ≠ 199`
- ✅ d) 읽기영역: 상태가 에러(1~6) 혹은 READY(0) + OPID 확인 — `상태 0(READY), OPID 0 — 명령 OPID 199 와 다름 = 쓰기가 예외로 거부되어 이전 OPID 0 유지`
- ✅ e) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483949917', 'device_id': 'kstest_sw1', 'command': 'off', 'executed_at': '2026-09-15T14:52:29.917Z', 'mode': 'local'}}`
- ✅ f) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 200`

## 5.3.3 레벨 1 개폐기 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동 명령 (OPID·305) — 시험용 강제 송신, 버스로 나감 — `{'ok': False, 'opid': 201, 'exception': 3, 'error': 'exception 0x03 (illegal_data_value)'} ← 노드가 Modbus 예외 3 로 쓰기 자체를 거부`
- ✅ c) 개폐기가 작동하지 않음 (시험장비: 작동중 아님·남은시간 0·305 미적용) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 305, 'cmd_opid': 201, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0} — 305 수신 기록은 남으나 적용 OPID 0 ≠ 201`
- ✅ d) 읽기영역: 상태가 에러(1~6) 혹은 READY(0) + OPID 확인 — `상태 0(READY), OPID 0 — 명령 OPID 201 와 다름 = 쓰기가 예외로 거부되어 이전 OPID 0 유지`
- ✅ e) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로 — `{'success': True, 'data': {'request_id': 'local_1789483952934', 'device_id': 'kstest_op1', 'command': 'stop', 'executed_at': '2026-09-15T14:52:32.934Z', 'mode': 'local'}}`
- ✅ f) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 202`

## 5.3.4 레벨 1 개폐기 동일 OPID 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)

- ✅ a) 디바이스코드에 레벨 1 개폐기(112) 포함 — opener1 — `탐색 코드 112 (디폴트맵 순번 17, 노드 1)`
- ✅ b) 쓰기영역에 작동중지 명령 (OPID·0) — `{'ok': True, 'accepted': True, 'opid': 203, 'op': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ c) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 203`
- ✅ d) 쓰기영역에 작동시간 열기 명령 (OPID·303·30s) — OPID 를 직전 명령과 같은 203 로 — `{'ok': True, 'accepted': False, 'opid': 203, 'op': 303, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ e) 개폐기가 작동하지 않음 (같은 OPID 는 활성화 아님) — `시험장비 {'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 203, 'time': 30, 'opid': 0, 'status': 0, 'remain': 0} / 제어기 읽기 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ f) 쓰기영역의 OPID 를 새 값 204 으로 변경 (OPID 워드 1개만 씀) — `{'ok': True, 'opid': 204, 'status': 301, 'status_name': 'OPENING', 'remain': 30}`
- ✅ g) 개폐기 작동 (시험장비 여는중·남은시간 30s) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 303, 'cmd_opid': 204, 'time': 30, 'opid': 204, 'status': 301, 'remain': 30}`
- ✅ h) 읽기영역: OPID 동일(204) + 상태 여는중(301) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 204, 'status': 301, 'status_name': 'OPENING', 'remain': 29}`
- ✅ i) 쓰기영역에 작동중지 명령 (OPID·0) — OPID 를 작동 명령과 같은 204 로 — `{'ok': True, 'accepted': True, 'opid': 204, 'op': 0, 'status': 301, 'status_name': 'OPENING', 'remain': 29}`
- ✅ j) 개폐기가 여전히 작동 (같은 OPID 의 중지는 무시) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 204, 'time': 0, 'opid': 204, 'status': 301, 'remain': 26}`
- ✅ k) 읽기영역: OPID 동일(204) + 상태 작동중(301) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 204, 'status': 301, 'status_name': 'OPENING', 'remain': 27}`
- ✅ l) 쓰기영역의 OPID 를 새 값 205 으로 변경 — `{'ok': True, 'opid': 205, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ m) 개폐기 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 205, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ n) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 205`
- ✅ o) 쓰기영역에 작동시간 닫기 명령 (OPID·304·30s) — OPID 를 직전 명령과 같은 205 로 — `{'ok': True, 'accepted': False, 'opid': 205, 'op': 304, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ p) 개폐기가 작동하지 않음 (같은 OPID 는 활성화 아님) — `시험장비 {'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 205, 'time': 30, 'opid': 0, 'status': 0, 'remain': 0} / 제어기 읽기 {'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 0, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ q) 쓰기영역의 OPID 를 새 값 206 으로 변경 (OPID 워드 1개만 씀) — `{'ok': True, 'opid': 206, 'status': 302, 'status_name': 'CLOSING', 'remain': 30}`
- ✅ r) 개폐기 작동 (시험장비 닫는중·남은시간 30s) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 304, 'cmd_opid': 206, 'time': 30, 'opid': 206, 'status': 302, 'remain': 30}`
- ✅ s) 읽기영역: OPID 동일(206) + 상태 닫는중(302) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 206, 'status': 302, 'status_name': 'CLOSING', 'remain': 29}`
- ✅ t) 쓰기영역에 작동중지 명령 (OPID·0) — OPID 를 작동 명령과 같은 206 로 — `{'ok': True, 'accepted': True, 'opid': 206, 'op': 0, 'status': 302, 'status_name': 'CLOSING', 'remain': 29}`
- ✅ u) 개폐기가 여전히 작동 (같은 OPID 의 중지는 무시) — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 206, 'time': 0, 'opid': 206, 'status': 302, 'remain': 26}`
- ✅ v) 읽기영역: OPID 동일(206) + 상태 작동중(302) — `{'name': '개폐기1', 'kind': 'opener', 'n': 1, 'opid': 206, 'status': 302, 'status_name': 'CLOSING', 'remain': 27}`
- ✅ w) 쓰기영역의 OPID 를 새 값 207 으로 변경 — `{'ok': True, 'opid': 207, 'status': 0, 'status_name': 'READY', 'remain': 0}`
- ✅ x) 개폐기 중지 — `{'ok': True, 'kind': 'opener', 'n': 1, 'cmd': 0, 'cmd_opid': 207, 'time': 0, 'opid': 0, 'status': 0, 'remain': 0}`
- ✅ y) 읽기영역: OPID 확인 + 상태 READY(0) — `READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 207`

## 116-재연결 연결단자 해제·재연결 후 2분 이내 정상 복귀 (5회)

- ✅ 시작 전: 센서·구동기 노드 모두 정상
- ✅ 1회 해제: 제어기가 두 노드 모두 '응답 없음' 을 인지 — `4.0s 만에 인지`
- ✅ 1회 재연결: 120초 이내 정상 복귀 (드라이버) — `5.0s`
- ✅ 1회 재연결: 화면 경로(NR 프록시)에서도 정상 — `재연결 후 5.0s`
- ✅ 2회 해제: 제어기가 두 노드 모두 '응답 없음' 을 인지 — `4.0s 만에 인지`
- ✅ 2회 재연결: 120초 이내 정상 복귀 (드라이버) — `3.0s`
- ✅ 2회 재연결: 화면 경로(NR 프록시)에서도 정상 — `재연결 후 3.0s`
- ✅ 3회 해제: 제어기가 두 노드 모두 '응답 없음' 을 인지 — `4.0s 만에 인지`
- ✅ 3회 재연결: 120초 이내 정상 복귀 (드라이버) — `5.0s`
- ✅ 3회 재연결: 화면 경로(NR 프록시)에서도 정상 — `재연결 후 5.0s`
- ✅ 4회 해제: 제어기가 두 노드 모두 '응답 없음' 을 인지 — `4.0s 만에 인지`
- ✅ 4회 재연결: 120초 이내 정상 복귀 (드라이버) — `5.0s`
- ✅ 4회 재연결: 화면 경로(NR 프록시)에서도 정상 — `재연결 후 5.0s`
- ✅ 5회 해제: 제어기가 두 노드 모두 '응답 없음' 을 인지 — `4.0s 만에 인지`
- ✅ 5회 재연결: 120초 이내 정상 복귀 (드라이버) — `5.0s`
- ✅ 5회 재연결: 화면 경로(NR 프록시)에서도 정상 — `재연결 후 5.0s`
- ✅ 복귀 시간 요약 (기준 120초) — `최소 3.0s / 최대 5.0s / 평균 4.6s`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.4.4 데이터 저장 시험(10분 이상): 센서를 하우스/센서 탭에서 표준 노드에 매핑(temp_std ← U2 센서1) 후 10분 뒤 API `GET /api/sensors/farm_0001/house_0001/history?startDate=…` 로 1분 단위 저장 확인 — 이 스크립트는 운영 houseConfig 를 건드리지 않는다
- [ ] §5.5.2 화면 증적: 제어판 kstest_sw1 「📐 시간 지정 ON」 20초 → 📐 배지 '켜짐 NNs' 감소 → ■ OFF → 'READY' 캡처, 표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s 실시간 카운트다운), ④ 진단 프레임(FC16 503~506 / FC03 203~206)
- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 20초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → ■ 정지 → 'READY' → ⏱ 시간 닫기 → '닫히는 중 NNs' → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s 실시간 카운트다운), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
- [ ] §5.5.2 화면 증적: 제어판 kstest_sw1 「📐 시간 지정 ON」 12초 → 📐 배지 '켜짐 NNs' 감소 → 'READY' 자동 복귀 캡처, 표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s), ④ 진단 프레임(FC16 503~506 / FC03 203~206)
- [ ] §5.5.3 화면 증적: 제어판 kstest_op1 카드 「📐 작동시간」 12초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → 'READY' 자동 복귀 → ⏱ 시간 닫기 → '닫히는 중' → 자동 복귀 → 다시 열기 → ■ 정지 → 'READY' → 닫기 → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)
- [ ] 116 연결 해제·재연결 화면 증적: 신고한 관제 방식(키오스크·웹·모바일)마다 표준노드 탭 '응답 없음' → 정상 복귀를 캡처. 실물은 M12 커넥터를 물리적으로 해제(노드 1/3 이상)
