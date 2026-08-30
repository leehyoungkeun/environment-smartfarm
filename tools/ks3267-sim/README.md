# KS X 3267 디폴트맵 노드 시뮬레이터

시험기관 시험장비(부속서 A 디폴트 레지스터 맵 노드)의 복제품. 마스터 드라이버 개발·자가 시험의 기준.

```
ksmap.py    부속서 A 주소 공식 + 코드표 — 단일 출처 (docs/ksx3267/PLAN.md 1절)
codec.py    4.3.3 인코딩 (float/uint32 CDAB)
node.py     노드 동작 모델 (pymodbus 무관, 순수 파이썬) — opid 활성화·상태 전이·남은시간
sim.py      pymodbus 서버 래퍼 — RTU(실선/가상 시리얼) 또는 TCP(개발 편의)
test_sim.py 공식 vs 부속서 표 대조, 인코딩, 동작 의미론
```

## 실행

```bash
pip install -r requirements.txt
python -m unittest -v                                   # 자체 검증
python sim.py --tcp 5020 --unit 1 --type actuator       # 개발 PC: TCP 로 띄우기
python sim.py --port COM7 --unit 1 --type sensor        # RTU (Windows)
python sim.py --port /dev/ttyUSB1 --unit 2 --type actuator --opener-time 30   # RPi
python ksmap.py actuator > map.json                     # 맵을 데이터로 내보내기
```

옵션: `--devices 1,2,17` (부착 디바이스 순번만; 나머지 코드 0) · `--fault none|illegal_addr|slave_failure|timeout` (예외응답 주입) · `--sensor-noise` · `--log-frames` (TX/RX hex, 시험 증적).

## 의미론 요약 (표준 6절)

- 명령 활성화 = **opid 변경 시점**. opid 0 = 명령 없음. 같은 opid 재전송은 무시.
- 스위치 L1: OFF 0 / ON 201 / TIMED_ON 202(동작시간 uint32) → 완료 시 READY·opid 0·remain 0
- 개폐기 L1: STOP 0 / OPEN 301 / CLOSE 302 (완전 열림·닫힘 소요시간 = `--opener-time`) / TIMED_OPEN 303 / TIMED_CLOSE 304
- 레벨2 명령(203·305·306)·미부착 디바이스 → 예외응답 0x03 (illegal data value)
- 0x10 한 번에 4 워드 쓰기와 0x06 한 워드씩 쓰기 모두 지원 (15절)

## 원문 오탈자 (시험기관 확인 대상)

A.2.5 reg 220 "스위치 5 상태 uint32"(uint16 이어야) · reg 245 "스위치 12"(11) · OPID #21 중복(283/287). 시뮬레이터는 공식(순차)을 따른다.
