# KS X 3267:2022 온실통합제어기 적합성 — 실행 계획

작성 2026-08-30. 근거: KS X 3267:2022 원문, SPS-X KOAT-0004-7466 (프로토콜 적합성 시험방법), KOAT 116 (통합제어기 검정), 2026-07-17 스코프 결정.

## 0. 범위 선언 (변경 시 이 절부터 갱신)

| 항목 | 결정 |
|---|---|
| 역할 | 우리 제어기(RPi + Node-RED) = **온실 통합 제어기 = 모드버스 마스터** |
| 레지스터 맵 | **디폴트 레지스터 맵(부속서 A) 전용**. 자동등록(KS X 3286) 미지원 선언 |
| 노드 레벨 | **레벨 1** 스위치형(코드 102)·개폐형(코드 112). 레벨 2(SET_POSITION/SET_CONFIG/DIRECTIONAL_ON) 미지원 |
| 프로토콜 버전 | 노드 정보 reg 5 = **10** 기대 (SPS §5.1.2) |
| 기능 코드 | 조회 0x03, 제어 **0x10** (0x06 병행은 시험기관 확인 후) |
| 인코딩 | 워드 내 big-endian, 워드 간 little-endian (float/uint32 = CDAB) |
| 기존 장비 | Waveshare/XY-MD02 경로 **무수정 병존** (이중 드라이버). 표준 노드는 **별도 RS485 포트** |
| 대상 농장 | **RPi 1호(farm_0001)만**. 다른 농장 절대 금지 (원칙) |
| 안전 원칙 | 자동 모드 전환 금지, 워크어라운드 금지, 진단 UI 는 읽기 전용 |

## 1. 디폴트 맵 주소 공식 (부속서 A 에서 도출 — 코드·시뮬레이터·테스트의 단일 출처)

센서 노드 (타입 1, 채널 30): 디바이스 i (1..30)
- 디바이스 코드: `100 + i`
- 값(float, 2w): `203 + 3(i-1)`, 상태(uint16): `205 + 3(i-1)` → 203..292

구동기 노드 (타입 2, 채널 24): 스위치 k (1..16), 개폐기 j (1..8)
- 디바이스 코드: 스위치 `100 + k`, 개폐기 `116 + j`
- 노드 상태: OPID#0 `201`, 상태 `202`; 노드 명령 `501`, OPID#0 `502`
- 스위치 상태: OPID `203 + 4(k-1)`, 상태 `204 + 4(k-1)`, 남은시간(uint32) `205..206 + 4(k-1)`
- 개폐기 상태: OPID `267 + 4(j-1)`, 상태 `268 + 4(j-1)`, 남은시간 `269..270 + 4(j-1)`
- 스위치 명령: 명령 `503 + 4(k-1)`, OPID `504 + 4(k-1)`, 동작시간(uint32) `505..506 + 4(k-1)`
- 개폐기 명령: 명령 `567 + 4(j-1)`, OPID `568 + 4(j-1)`, 동작시간 `569..570 + 4(j-1)`

원문 오탈자(시험기관에 확인): A.2.5 reg 220 "스위치 5 상태 uint32"(uint16 이어야), reg 245 "스위치 12"(11), OPID #21 이 283·287 에 중복(287 은 #22, 이후 순차 밀림).

코드표: 상태 READY 0 / ERROR 1 / BUSY 2 / VOLTAGE 3 / CURRENT 4 / TEMP 5 / FUSE 6 / 센서 101~103 / ON 201 / USER_CONTROL 299 / OPENING 301 / CLOSING 302 / MANUAL 399 / 제조사 900~999.
명령: 스위치 OFF 0 · ON 201 · TIMED_ON 202(hold-time uint16?→A.2.6 은 uint32 동작시간) / 개폐기 STOP 0 · OPEN 301 · CLOSE 302 · TIMED_OPEN 303 · TIMED_CLOSE 304.
opid: 매 명령 변경, 0 은 "없음", 노드는 opid 변경 시점에 명령 활성화.

## 2. 단계별 계획

### Phase 1 — 디폴트맵 노드 시뮬레이터 (3일) `tools/ks3267-sim/`
목적: 시험장비 복제품. 이후 모든 단계의 기준. 운영 무영향.
- `map.json` — 1절 공식으로 생성한 레지스터 맵 (센서/구동기 두 프로필). **코드가 아니라 데이터**로 두어 드라이버·테스트와 공유
- `sim.py` (pymodbus 3.x, RTU 슬레이브): 노드 정보(1~8), 디바이스 코드(101~), 상태/명령 레지스터
  - 명령 처리: opid 변경 감지 → 상태 전이(ON 201 / OPENING 301…) → 남은시간 카운트다운 → 완료 시 READY 0
  - TIMED_* 는 동작시간 후 자동 종료. STOP/OFF 즉시
  - 센서 값: 설정 가능한 기본값 + 잡음, float CDAB 인코딩
  - 옵션: `--port --unit --type sensor|actuator --baud 9600 --fault <코드>`(예외응답 주입)
- 자체 테스트 `tools/ks3267-sim/test_sim.py`: 맵 공식 vs 부속서 표 대조, 인코딩, 상태 전이
- 개발 PC 는 가상 시리얼(com0com / socat), RPi 는 USB-485 두 개를 맞물려 실선 시험
- 산출: 시뮬레이터 + 맵 데이터 + "부속서 A 해석 메모"(모호점 목록)

### Phase 2 — ks3267 마스터 드라이버 데몬 (1~2주) `rpi-files/master/ks3267d/`
D16 데몬 패턴(pm2 관리 python) 재사용. NR 은 오케스트레이터.
- 포트: `/dev/smartfarm-485-std` (udev 규칙, 기존 `/dev/smartfarm-485` 와 분리)
- `codec.py`: CDAB float/uint32, 프레임 조립·파싱, 예외응답(0x8x) 해석 — **순수 함수, 테스트 대상**
- `discovery.py`: 주소 → reg 1~8 → 디폴트맵 판정(기관·회사=0, 버전=10, 타입) → reg 101~(100+채널수) → 디바이스 목록(코드 0 제외) → 1절 공식으로 주소 배정
- `master.py`: 폴링 루프(센서 값/상태, 구동기 상태·남은시간, 주기 설정), 명령 발행(0x10, opid 생성기 1..65535 순환·영속), 명령 후 readback 확인, 타임아웃/재시도 정책(재시도는 표준 허용 범위 내, 워크어라운드 아님), 단일 트랜잭션 직렬화(마스터는 동시 1건)
- `api.py`: 127.0.0.1:3002 REST — `GET /discover?addr=`, `GET /nodes`, `POST /command {node, index, op, time}`, `GET /status`, `GET /frames`(최근 200 프레임 hex 링버퍼)
- 상태 push: 변경 시 NR REST(`/api/ks3267/status`)로 전달 → 기존 relay_status/device_positions 흐름과 합류
- 로그: GlitchTip 연동(기존 패턴), 프레임 링버퍼는 메모리만
- 테스트: `codec`·`discovery`·주소 공식·opid 규칙 유닛 + 시뮬레이터 E2E(가상 시리얼)

### Phase 3 — NR·백엔드 통합 (1주)
- houseConfig 장치 프로필 확장: `{ protocol: "ks3267", node: <addr>, index: <k|j>, kind: "switch"|"opener", openDuration, closeDuration }` — 기존 `modbus` 프로필과 병존. 백엔드 저장 검증(깊은 병합 테스트 있음)
- NR `execute_control`: `protocol==='ks3267'` 분기 → 데몬 `/command` 호출. 매핑: on→ON, off→OFF, on+duration→TIMED_ON, open→OPEN, close→CLOSE, stop→STOP, open+duration→TIMED_OPEN, close+duration→TIMED_CLOSE. **vendor 분기는 무수정**
- 센서: 데몬 → 기존 센서 수집 흐름(`sensor prep`)에 합류, quality good
- 상태: 데몬 push → deviceStates/devicePositions(house_0001:… 정규키) 갱신 + relay_status 유사 발행
- 백엔드: `config.routes.js` 에 탐색 프록시 `GET /api/config/:farmId/ks3267/discover?addr=` (RPi 데몬 경유, 농장 키 인증) + 매핑 저장은 기존 system-settings/houseConfig 경로
- 테스트: NR 하네스로 execute_control 분기(명령 매핑·opid 전달 없음 확인·vendor 경로 불변), 백엔드 통합 테스트(프록시 인증)

### Phase 4 — UI (1주) — 위치는 2026-08-30 결정 그대로 — **완료 2026-08-30 (HW 없이 빌드·테스트 검증, 실 화면 검증은 P5 후)**
- 구현 메모: 매핑은 하우스/센서 탭의 장치·센서 설정(프로토콜 선택)에서 하고, 표준노드 탭은 탐색 결과 옆에 현재 매핑·중복을 보여준다(하우스 저장 로직 중복 회피). 순수 로직 `frontend/src/lib/ks3267.js` ← `backend/test/unit/ks3267-ui-lib.test.js`(12).
- `frontend/src/components/Settings/KsNodeManager.jsx` (신규, lazy) — 설정 › **표준노드** 탭
  - 포트·주소 입력 → 탐색 → 노드 정보 카드 + 디바이스 표(코드→종류, 미지원 항목 표기) → 우리 장치명·하우스 매핑 → 저장
  - 하단 접이식 **진단**: 최근 프레임 TX/RX hex, 응답시간, 예외·타임아웃 카운터 (읽기 전용)
- `ConfigurationManager.jsx`: 탭 등록 + Suspense 4줄
- `ControlPanel.jsx`: 표준 장치 카드에 상태코드 배지 + 남은 동작시간 (조건부 2줄)
- 하우스/센서 탭: 표준 장치 `표준` 배지(읽기 전용)
- 대시보드 이력: csv 추출 버튼 유무 확인(116)
- 순수 로직(탐색 결과 파싱, 매핑 검증)은 `lib/ks3267.js` 로 분리 → node:test 로 테스트

### Phase 5 — 하드웨어 (1주, 부품 수급 병행 — **즉시 발주 권장**)
- M12 4핀 A-코드 패널 커넥터(수) ×2 (INPUT/OUTPUT), M12 암 케이블
- 핀: 1 +24VDC(적) · 2 RS485-A(녹) · 3 RS485-B(백) · 4 GND(흑)
- 24VDC 전원(노드 급전) — 제어기가 버스에 24V 를 공급하는 구조. 퓨즈·역접속 보호
- 두 번째 USB-485(절연형 권장) + udev 규칙 `/dev/smartfarm-485-std`
- 종단저항 120Ω, 바이어스 저항 확인
- 실 표준 노드 1대 확보(시장 제품) — 시뮬레이터와 교차 검증용

### Phase 6 — SPS-7466 §5.4/5.5 자가 시험 (3일) — **시뮬레이터 상대 7/7 통과 2026-08-30** (`rpi-files/master/ks3267d/selftest_sps7466.py`, 절차·116 대응표 `docs/ksx3267/self-test/README.md`, 증적 `evidence-20260830-095819/`). 실 노드 교차·화면 캡처·5.4.4 저장 10분은 HW 후
- 시험 시나리오를 스크립트로: 탐색 → 센서 조회 → 스위치 ON/OFF/TIMED_ON → 개폐기 OPEN/CLOSE/STOP/TIMED_* → 상태 readback → (제어기 시험엔 비정상 시나리오 없음 — 재확인)
- 증적: 프레임 hex 로그, UI 캡처, 결과표 → `docs/ksx3267/self-test/`

### Phase 7 — 116 검정 갭 (3일)
손실률 3%↓(지표 있음), 시각화 1h/1/7/30일(확인), **1분 단위 조회·csv/txt/xls 추출**(버튼 확인/추가), 전원차단 30분 후 자동 복구(pm2·systemd 확인, 드릴 1회).

### Phase 8 — 문서·신청 (1주 + 심사 4~8주)
제품 사양서, 지원 선언서(0절 표), 자체 시험 성적서, 연동장비표(표준 노드 + 비표준 장비 별도 인정), 설치 SOP(커넥터·핀·종단).

## 3. 일정 (병렬 트랙)

| 주 | 소프트웨어 | 하드웨어 | 사장님 |
|---|---|---|---|
| 1 | P1 시뮬레이터 → P2 codec/discovery | 부품 발주 | 시험기관 4항목 문의 |
| 2 | P2 master/api + 유닛·E2E | 커넥터 패널 제작 | 실 표준 노드 수배 |
| 3 | P3 NR·백엔드 통합 | 실선 배선·종단 | — |
| 4 | P4 UI + P6 자가시험 | 실 노드 교차검증 | 116 자료 준비 |
| 5 | P7 116 갭 + P8 문서 | — | 신청 |
| 6~ | 심사 대응 | | |

## 4. 시험기관 확인 항목 (1주차)
1. 디폴트맵에 노드 제어권(CONTROL) 레지스터가 없음(A.2.4 는 501·502 뿐) — 제어기 시험에 제어권 명령 포함 여부
2. 시험장비가 디폴트맵 노드인지 (자동등록 노드면 스코프 변경)
3. 제어 기능코드 0x10 단독으로 충분한지
4. 116 연동장비표 체크 범위(온·습도 + 스위치, 측창 시 개폐기)
5. 부속서 A 오탈자(1절) 해석

## 5. 위험과 대응
- HW 수급 지연 → 1주차 발주, 소프트웨어는 시뮬레이터로 선행
- 시뮬레이터 ≠ 실 노드 타이밍 → 실 노드 1대 교차 검증
- 기존 운영 회귀 → 별도 포트·별도 데몬·vendor 경로 무수정 + 게이트 테스트
- 표준 해석 오류 → 맵을 데이터(map.json)로 두어 수정 1곳, 시험기관 확인 항목 조기 처리

## 6. 완료 기준
- 시뮬레이터 상대 §5.4/5.5 전 시나리오 통과 + 실 노드 1대 교차 통과
- 게이트 테스트에 codec·discovery·execute_control 분기·프록시 포함, 변이 검사 통과
- 운영 경로(Waveshare/XY-MD02) 회귀 0 (기존 테스트 전부 통과)
- 문서 3종 + 증적 완비
