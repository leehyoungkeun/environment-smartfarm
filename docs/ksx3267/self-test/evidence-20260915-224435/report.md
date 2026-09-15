# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서

- 일시: 2026-09-15 22:44:10
- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: tcp 127.0.0.1:5020
- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit 2, 구동기 unit 1)
- 결과: **1/1 통과**
- 프레임: TX 36 / RX 36 / 예외 0 / 타임아웃 0 (frames.txt)

| 시험 | 항목 | 근거 | 결과 |
|---|---|---|---|
| 5.4.3 | 데이터 확인 시험 | SPS-7466 §5.4.3 a)~d) (관측치 CDAB float · 상태코드 주기 변경) | ✅ 통과 |

## 5.4.3 데이터 확인 시험

- ✅ a)b) 관측치 21.5 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': 21.5, 'status': 0, 'status_name': 'READY'}`
- ✅ a)b) 관측치 30.25 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': 30.25, 'status': 0, 'status_name': 'READY'}`
- ✅ a)b) 관측치 -3.0 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': -3.0, 'status': 0, 'status_name': 'READY'}`
- ✅ a)b) 관측치 28.8 가상 설정 → 제어기가 읽음 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 0, 'status_name': 'READY'}`
- ✅ c) 시험장비 상태를 4.0s 주기로 [103, 102, 0] 순환하도록 설정 — `{'ok': True, 'index': 1, 'cycle': {'values': [], 'statuses': [103, 102, 0], 'period': 4.0}}`
- ✅ d) 제어기가 상태 변화를 매번 순서대로 읽음 — 관측 [103, 102, 0, 103] — `변화 이력 4건, 상태명 ['NEED_CHECK', 'NEED_CALIBRATION', 'READY', 'NEED_CHECK']`
- ✅ d') 변화 간격 ≈ 설정 주기 4.0s (폴링 2.0s 오차 내) — `간격 [4.0, 4.0, 4.0]s`
- ✅    해제 후 상태 0(READY) 복귀 확인 — `{'name': '온도1', 'code': 1, 'value': 28.8, 'status': 0, 'status_name': 'READY'}`

## 수동 증적 항목 (화면 캡처·저장 확인)

- [ ] §5.4.4 데이터 저장 시험(10분 이상): 센서를 하우스/센서 탭에서 표준 노드에 매핑(temp_std ← U2 센서1) 후 10분 뒤 API `GET /api/sensors/farm_0001/house_0001/history?startDate=…` 로 1분 단위 저장 확인 — 이 스크립트는 운영 houseConfig 를 건드리지 않는다
