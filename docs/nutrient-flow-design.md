# 양액 관리 Node-RED 플로우 설계 (Phase 3.1)

> RPi 1호 (192.168.219.111) Node-RED 에 추가될 양액 자동 제어 플로우.
> Phase 3.1 = 하드웨어 도착 전 골격. 시뮬레이터로 전체 흐름 검증 → 도착 후 실 센서 노드 활성화.

## 운영 알파 + 시스템 검토 반영 BOM (~₩175만)
- **RS-485 버스**:
  - Unit-Id 1: XY-MD02 온습도 (기존)
  - Unit-Id 2: Waveshare 8CH 릴레이 (기존)
  - **Unit-Id 3: 24CH Modbus 릴레이 (신규)** — 도싱 6 + 밸브 14 + 메인펌프 + 교반기 = 22채널 + 여유 2
  - **Unit-Id 4: Modbus EC 트랜스미터 (신규)**
- **USB**: Atlas EZO-pH (Carrier Board, /dev/ttyACM0 또는 /dev/ttyUSB1)
- **GPIO**: 비상정지 (BCM 17, 풀업), 누액 감지 (BCM 27)
- **플로트 스위치**: 24CH 릴레이의 dry contact 입력 또는 GPIO 22~28

## 채널 매핑 (Unit-Id 3, 24CH 릴레이)

| 채널 | 용도 | 매핑 |
|---|---|---|
| 0~5 | 도싱 펌프 A·B·C·D·산·알칼리 | nutrient_configs.tanks[i].modbusReg |
| 6 | 메인 송수 펌프 | 고정 |
| 7 | 교반기 | 고정 |
| 8~21 | 관수 밸브 1~14 | nutrient_configs.valveCount 까지 |
| 22 | 원수 보충 솔레노이드 | 고정 |
| 23 | 예비 | — |

## 플로우 구조 (탭 1개 = `양액 자동제어`)

```
┌─────────────────────────────────────────────────────────┐
│  ① 센서 수집 (5초 주기)                                 │
│     [inject 5s] → [Modbus EC] ─┐                        │
│                  [Serial pH] ──┤→ [telemetry publisher] │
│                  [Modbus 유량] ┘    POST /state/telemetry│
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  ② 안전 인터락 (5초 주기 + 즉시)                        │
│     EC > critical → 모드 emergency → 모든 릴레이 OFF    │
│     pH 범위 이탈 → 경보 + 도싱 정지                     │
│     탱크 잔량 부족 → 해당 도싱만 비활성                 │
│     비상정지 GPIO → 전체 OFF + 모드 emergency           │
│     누액 GPIO → 전체 OFF + critical 경보                │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  ③ 시나리오 트리거 (1분 주기)                           │
│     GET /scenarios → active 추출                        │
│     irrigationMode 별 평가:                             │
│       solar  → solarAccumulated >= solarThreshold?      │
│       timer  → 마지막 사이클로부터 interval 경과?       │
│       schedule → 현재 시각이 scheduleSlots 에 있나?     │
│     → 트리거 OK 시 ④ 발사                               │
└─────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────┐
│  ④ 1회 관수 사이클 실행                                 │
│     Phase 1: 도싱 (pumps × dosingRatio × time)          │
│              ↓ (각 펌프 시퀀셜 또는 병렬)               │
│     Phase 2: 교반 (60초)                                │
│              ↓                                          │
│     Phase 3: EC/pH 안정화 확인 (3회 측정)               │
│              ↓                                          │
│     Phase 4: 메인펌프 ON + 밸브 순차 ON (구역별 duration) │
│              ↓                                          │
│     Phase 5: 정리 (모든 릴레이 OFF, counters increment) │
│                                                          │
│     각 단계마다 PUT /state/telemetry { currentCycle }   │
└─────────────────────────────────────────────────────────┘
```

## 데이터 흐름

| 송신 | 경로 | API |
|---|---|---|
| EC·pH·유량 (5초마다) | RPi → backend | `PUT /api/nutrient/:farmId/state/telemetry` |
| 1회 사이클 진행 상황 | RPi → backend | `PUT /api/nutrient/:farmId/state/telemetry` (currentCycle 갱신) |
| 누적량 (사이클 완료 시) | RPi → backend | `POST /api/nutrient/:farmId/counters/increment` |
| 경보 발생 | RPi → backend | `POST /api/nutrient/:farmId/alerts` |
| 시나리오 / 설정 조회 | backend → RPi | `GET /api/nutrient/:farmId/scenarios`, `/config` |

## 시뮬레이터 모드 (하드웨어 도착 전)

`global.set('nutrientSimulator', true)` 시 활성화:
- EC 1.8 ~ 2.2 mS/cm 사이 랜덤 변동
- pH 5.8 ~ 6.4 사이 변동
- 유량 0 또는 8 L/min (메인펌프 상태 기반)
- 도싱 펌프·밸브 ON/OFF는 로그만 출력 (실 릴레이 미동작)

## 보안·인증

- backend API 호출 시 농장 API Key (`x-api-key` 헤더) 사용
- RPi 1호용 키는 `farms.apiKey` 에 저장됨
- Node-RED `global.farmConfig.apiKey` 로 보관 (settings.js 또는 별도 inject)

## 안전 우선순위 (인터락)

1. **비상정지 / 누액**: 모든 릴레이 즉시 OFF, 모드 emergency 고정 (수동 복구)
2. **EC critical 초과**: 도싱·관수 정지, 경보, 모드 paused
3. **pH critical 초과**: 도싱 정지, 경보 (관수는 계속)
4. **탱크 잔량 부족** (해당 탱크): 해당 도싱만 비활성, 경보
5. **센서 통신 오류 30초**: 모드 paused, critical 경보
6. **사이클 중 EC 급변** (±0.5 in 10s): 일시 정지, 안정화 대기

## 파일 목록

| 파일 | 역할 | 노드 타입 |
|---|---|---|
| [nodered-nutrient-simulator.js](nodered-nutrient-simulator.js) | 가상 EC/pH/유량 생성 | function |
| [nodered-nutrient-telemetry-publisher.js](nodered-nutrient-telemetry-publisher.js) | 센서값 → backend POST | function |
| [nodered-nutrient-trigger-evaluator.js](nodered-nutrient-trigger-evaluator.js) | 시나리오 트리거 평가 | function |
| [nodered-nutrient-cycle-runner.js](nodered-nutrient-cycle-runner.js) | 1회 관수 사이클 실행 | function |
| [nodered-nutrient-safety-interlock.js](nodered-nutrient-safety-interlock.js) | 안전 인터락 | function |
| [nodered-nutrient-import.json](nodered-nutrient-import.json) | Node-RED 가져오기용 전체 플로우 | flow tab |

## 적용 절차 (하드웨어 도착 전 검증)

1. RPi 1호 Node-RED 에디터 (`http://192.168.219.111:1880/node-red/`) 접속
2. 우상단 메뉴 → Import → `nodered-nutrient-import.json` 선택 → "양액 자동제어" 탭 신규 생성
3. function 노드 5개에 각 .js 파일 내용 복사·붙여넣기
4. `global.set('nutrientSimulator', true)` 한 번 inject
5. Deploy → 5초 마다 가상 telemetry 가 backend 에 도달 확인 (frontend NutrientRealtime 에서 EC/pH 변동)
6. frontend 에서 시나리오 활성화 → 1분 후 트리거 → 사이클 진행 로그 확인

## 하드웨어 도착 후 (Phase 3.2)

1. RS-485 신규 부품 Unit-Id 변경 (mbpoll)
2. flow 의 Modbus EC 노드 활성화 (Unit-Id 4)
3. Serial 노드 추가 (Atlas EZO-pH, /dev/ttyACM0)
4. `global.set('nutrientSimulator', false)`
5. 도싱 펌프 캘리브레이션 (펄스당 mL 측정 → nutrient_configs.hardware 에 저장)
6. 안전 인터락 실 동작 시험 (의도적으로 EC 4.5 만든 후 정지 확인)
