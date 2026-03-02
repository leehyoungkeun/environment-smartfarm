# SmartFarm RPi ↔ 백엔드 연결 아키텍처

## 1. 전체 시스템 구조

```
┌─────────────────────────────────────────────────────┐
│  프론트엔드 (React PWA :5174)                        │
│  apiSwitcher.js가 PC/RPi 자동 선택                   │
└──────────┬──────────────────┬───────────────────────┘
           │ 온라인            │ 오프라인/팜로컬
           ▼                  ▼
┌───────────────────┐  ┌─────────────────────────────┐
│ PC 백엔드          │  │ RPi Node-RED (:1880)        │
│ Express :3000     │  │                             │
│ PostgreSQL        │  │  SQLite (로컬 저장)          │
│ TimescaleDB       │  │  센서 수집 + 자동화          │
└───────────────────┘  └─────────────────────────────┘
          ▲                     │
          │  HTTP (x-api-key)   │
          └─────────────────────┘
           RPi → PC 단방향 (Pull)
```

**핵심 특징:**
- RPi가 항상 PC에 요청하는 **Pull 방식** (PC → RPi Push 없음)
- 오프라인 시 SQLite에 저장, 온라인 복귀 시 자동 동기화
- 프론트엔드는 apiSwitcher를 통해 PC/RPi API를 자동 선택

---

## 2. 네트워크 구성

| 장치 | IP | 포트 | 역할 |
|------|-----|------|------|
| PC (백엔드) | 192.168.137.1 | 3000 | Express API + PostgreSQL |
| RPi | 192.168.137.30 | 1880 | Node-RED + SQLite |
| 프론트엔드 | localhost | 5174 | React 대시보드 (개발) |

---

## 3. RPi → PC 백엔드 HTTP 요청 (전체 목록)

### 3.1 헬스체크 (모드 결정)

| 항목 | 값 |
|------|-----|
| URL | `GET /health` |
| 주기 | 30초 |
| 인증 | 없음 |
| 목적 | 서버 가용성 확인 → online/offline 모드 결정 |

```
응답 200 + success:true → serverOnline = true
응답 실패/타임아웃     → serverOnline = false
```

### 3.2 설정 로드

| 항목 | 값 |
|------|-----|
| URL | `GET /api/config/farm/{farmId}` |
| 주기 | 10분 (센서 수집 시마다) |
| 인증 | `x-api-key: smartfarm-sensor-key` |
| 목적 | 전체 하우스 설정 로드 (센서 목록, 수집 주기 등) |

**응답 예시:**
```json
{
  "success": true,
  "data": [
    {
      "farmId": "farm_0001",
      "houseId": "house_002",
      "houseName": "2번 하우스",
      "sensors": [
        { "sensorId": "temp_002", "name": "온도", "unit": "°C", "min": -10, "max": 50 }
      ],
      "collection": { "intervalSeconds": 60 },
      "enabled": true
    }
  ]
}
```

### 3.3 센서 데이터 전송 (개별)

| 항목 | 값 |
|------|-----|
| URL | `POST /api/sensors/collect` |
| 주기 | 10분 (온라인 모드만) |
| 인증 | `x-api-key: smartfarm-sensor-key` |
| 목적 | 하우스별 센서 데이터 실시간 전송 |

**요청 바디:**
```json
{
  "farmId": "farm_0001",
  "houseId": "house_002",
  "data": {
    "temp_002": 25.3,
    "humidity_002": 65.5,
    "co2_002": 450
  },
  "timestamp": "2026-03-01T10:00:00.000Z",
  "deviceInfo": {
    "deviceId": "rpi_0001",
    "ip": "192.168.137.30",
    "version": "2.0.0-offline"
  }
}
```

### 3.4 센서 데이터 배치 동기화

| 항목 | 값 |
|------|-----|
| URL | `POST /api/sensors/batch` |
| 주기 | 오프라인→온라인 복귀 시 |
| 인증 | `x-api-key: smartfarm-sensor-key` |
| 목적 | 오프라인 기간 미전송 데이터 일괄 전송 (200건 단위) |

**요청 바디:**
```json
{
  "farmId": "farm_0001",
  "houseId": "house_002",
  "dataArray": [
    {
      "timestamp": "2026-03-01T09:50:00Z",
      "data": { "temp_002": 24.8, "humidity_002": 66.0 },
      "deviceInfo": { "deviceId": "rpi_0001" }
    },
    {
      "timestamp": "2026-03-01T09:40:00Z",
      "data": { "temp_002": 24.5, "humidity_002": 67.2 }
    }
  ]
}
```

### 3.5 자동화 규칙 동기화

| 항목 | 값 |
|------|-----|
| URL | `POST /api/automation/{farmId}/sync` |
| 주기 | 규칙 변경 시 |
| 인증 | `x-api-key: smartfarm-sensor-key` |
| 목적 | RPi에서 수정된 자동화 규칙을 PC에 반영 |

### 3.6 설정 동기화

| 항목 | 값 |
|------|-----|
| URL | `POST /api/config/{farmId}/sync` |
| 주기 | 설정 변경 시 |
| 인증 | `x-api-key: smartfarm-sensor-key` |
| 목적 | RPi 설정(하우스/센서/기기) 변경분을 PC에 반영 |

### 3.7 시스템 설정 조회

| 항목 | 값 |
|------|-----|
| URL | `GET /api/config/system-settings/{farmId}` |
| 주기 | 초기화 시 1회 |
| 인증 | `x-api-key: smartfarm-sensor-key` |
| 목적 | 데이터 보관 기간 등 시스템 설정 |

---

## 4. 센서 수집 플로우 (핵심)

```
[10분 타이머] ──→ [① 설정 로드] ──→ [HTTP GET config]
                       │                    │
                       │              [② 설정 응답 처리]
                       │                    │
                  (오프라인)           (온라인)
                       │                    │
                       ▼                    ▼
               [SQLite 캐시]        [서버에서 10개 하우스 로드]
                       │                    │
                       └────────┬───────────┘
                                │
                       [③ 센서 데이터 수집]
                       (하우스별 센서 읽기)
                                │
                       [④ SQLite INSERT]
                       (항상 저장, synced=0)
                                │
                       [⑤ 모드별 분기]
                       ┌────────┴────────┐
                  (온라인)           (오프라인)
                       │                 │
              [POST /api/sensors     [저장 완료]
               /collect]              (synced=0 유지)
                       │
              [⑥ 전송 결과 처리]
              (성공 → synced=1)
```

### 타이밍

| 이벤트 | 시점 |
|--------|------|
| Node-RED 시작 | t=0 |
| SQLite 초기화 | t+1s |
| startup_init (설정 복원) | t+3s |
| 헬스체크 시작 | t+5s |
| 첫 번째 센서 수집 | t+10s |
| 이후 수집 주기 | 10분 (600초) |
| 헬스체크 주기 | 30초 |

---

## 5. 온라인/오프라인 모드 전환

### 5.1 모드 상태 변수

```javascript
// Node-RED global 변수
global.operationMode   // 'online' | 'offline'
global.serverOnline    // true | false
global.manualOverride  // true | false (수동 전환)
global.houseConfig     // 설정 캐시 (Object)
```

### 5.2 전환 흐름

```
[헬스체크 30초마다]
    │
    ├─ GET /health → 200 OK
    │   └─ serverOnline = true
    │      operationMode = 'online' (수동 아닐 때)
    │      ├─ config 미캐시 → GET /api/config/farm/{farmId}
    │      └─ 모드 변경 감지 (offline→online)
    │           └─ sync_flow 트리거 (배치 동기화)
    │
    ├─ GET /health → 실패/타임아웃
    │   └─ serverOnline = false
    │      operationMode = 'offline'
    │      └─ SQLite 캐시로 수집 계속
    │
    └─ 수동 전환 (POST /api/system/mode)
        └─ manualOverride = true
           operationMode = 'offline' (강제)
```

### 5.3 온라인 복귀 시 자동 동기화

```
[offline → online 전환 감지]
         │
    [sync_flow 트리거]
         │
    SELECT * FROM sensor_data WHERE synced = 0 LIMIT 200
         │
    ┌────┴────┐
    │ 0건     │ 200건
    │ 완료    │
    │         ▼
    │    하우스별 분리
    │         │
    │    POST /api/sensors/batch (하우스별)
    │         │
    │    ┌────┴────┐
    │    │ 성공    │ 실패(404)
    │    │         │ "다음 주기에 재시도"
    │    ▼         │
    │  UPDATE synced=1
    │    │
    │    ▼
    │  [다음 배치 확인] → 1초 후 반복
    └─────────────────────────────────┘
```

---

## 6. API Key 인증 흐름

### 6.1 미들웨어 (`authenticateApiKey`)

```
요청 도착 (x-api-key 헤더)
    │
    ├─ 1) farms 테이블에서 apiKey 조회
    │      SELECT * FROM farms WHERE api_key = 'smartfarm-sensor-key'
    │      → 찾음: req.isDevice=true, req.farmId='farm_0001'
    │      → lastSeenAt 비동기 업데이트
    │      → next() ✅
    │
    ├─ 2) env SENSOR_API_KEY 폴백 (기존 호환)
    │      apiKey === process.env.SENSOR_API_KEY
    │      → 일치: req.isDevice=true → next() ✅
    │
    └─ 3) 둘 다 실패 → JWT 인증으로 폴백
           → 토큰 없음 → 401 Unauthorized
```

### 6.2 인증이 적용되는 라우트

```javascript
// backend/src/app.js
app.use("/api/sensors",    authenticateApiKey, sensorsRoutes);    // API키 또는 JWT
app.use("/api/config",     authenticateApiKey, configRoutes);     // API키 또는 JWT
app.use("/api/automation", authenticateApiKey, automationRoutes); // API키 또는 JWT
app.use("/api/farms",      authenticate, farmsRoutes);           // JWT만
app.use("/api/alerts",     authenticate, enforceTenant, ...);    // JWT + 테넌트

// 인증 불필요
app.get("/health", ...);              // 헬스체크
app.use("/internal", internalRoutes); // 내부 통신
```

### 6.3 Rate Limiting 제외

```javascript
// sensors, config 경로는 rate limit 제외 (RPi 폴링 허용)
skip: (req) => req.path.startsWith("/sensors") || req.path.startsWith("/config")
```

---

## 7. 프론트엔드 API 라우팅 (apiSwitcher)

### 7.1 API 선택 로직

```
getApiBase() 호출
    │
    ├─ 팜로컬 모드 (VITE_FARM_LOCAL=true)
    │   → window.origin 또는 http://192.168.137.30:1880
    │   (인터넷 불필요, RPi에서 직접 서비스)
    │
    ├─ 서버 오프라인 (serverOnline=false)
    │   → http://192.168.137.30:1880/api (RPi 폴백)
    │
    └─ 서버 온라인 (serverOnline=true)
        → http://192.168.137.1:3000/api (PC 메인)
```

### 7.2 헬스체크 (프론트엔드)

```
PC 서버 체크: GET http://192.168.137.1:3000/health (10초 간격)
RPi 체크:     GET http://192.168.137.30:1880/api/system/mode (3초 타임아웃)

Adaptive backoff: 연속 실패 시 10s → 20s → 40s → 60s (최대)
```

---

## 8. Node-RED 환경변수 의존 관계

### 8.1 탭별 필요 환경변수

| 탭 | SENSOR_API_KEY | SERVER_URL | FARM_ID | HOUSE_ID |
|---|---|---|---|---|
| collection_offline_flow | ✅ 서버 인증 | ✅ 서버 주소 | ✅ config 조회 | ✅ 폴백 |
| health_monitor_flow | ✅ config 캐시 | ✅ 헬스체크 | ✅ config 조회 | - |
| sync_flow | ✅ 배치 전송 | ✅ 서버 주소 | ✅ 규칙 동기화 | - |
| rest_api_flow | - | - | ✅ API 응답 | ✅ API 응답 |

### 8.2 env.get() 우선순위

```
env.get('FARM_ID')
  1순위: 현재 flow 탭의 env vars 정의
  2순위: global config node의 env vars
  3순위: process.env.FARM_ID
  4순위: 코드 내 fallback (|| 'farm_0001')
```

### 8.3 현재 값

| 변수 | 값 | 용도 |
|------|-----|------|
| SENSOR_API_KEY | `smartfarm-sensor-key` | RPi→백엔드 인증 |
| SERVER_URL | `http://192.168.137.1:3000` | PC 백엔드 주소 |
| FARM_ID | `farm_0001` | 기본 농장 ID |
| HOUSE_ID | `house_0001` | 기본 하우스 ID |

---

## 9. 데이터 저장소 비교

### RPi (SQLite)

| 테이블 | 용도 | 동기화 |
|--------|------|--------|
| sensor_data | 센서 측정값 | synced 플래그로 PC 전송 관리 |
| config_cache | 서버 설정 캐시 | 오프라인 시 사용 |
| automation_rules | 자동화 규칙 | 변경 시 PC에 동기화 |
| control_logs | 제어 기록 | 로컬 전용 |
| house_configs | 하우스 설정 CRUD | 팜로컬 모드용 |
| system_settings | 보관기간 등 | 서버에서 조회 |

### PC (PostgreSQL + TimescaleDB)

| 테이블 | 용도 |
|--------|------|
| sensor_data | 센서 데이터 (TimescaleDB 하이퍼테이블) |
| house_configs | 하우스 설정 (마스터) |
| farms | 농장 정보 + API Key |
| alerts | 알림 (임계값 초과 등) |
| automation_rules | 자동화 규칙 (마스터) |
| control_logs | 제어 로그 (TimescaleDB) |
| users / user_farms | 사용자 + 농장 매핑 |

---

## 10. 주요 파일 경로

### Node-RED (RPi)

| 파일 | 용도 |
|------|------|
| `node-red/flows/combined-flows.json` | 전체 플로우 (배포용) |
| RPi: `~/.node-red/flows.json` | 실제 실행 파일 |
| RPi: `~/.node-red/smartfarm.db` | SQLite 데이터베이스 |

### 백엔드 (PC)

| 파일 | 용도 |
|------|------|
| `backend/src/app.js` | Express 메인 + 라우트 마운팅 |
| `backend/src/middleware/auth.middleware.js` | API Key/JWT 인증 |
| `backend/src/routes/config.routes.js` | 설정 CRUD API |
| `backend/src/routes/sensors.js` | 센서 데이터 수신 |
| `backend/src/routes/internal.routes.js` | 내부 통신 (인증 불필요) |
| `backend/src/models/Config.js` | house_configs Prisma 래퍼 |

### 프론트엔드

| 파일 | 용도 |
|------|------|
| `frontend/src/services/apiSwitcher.js` | PC/RPi API 자동 선택 |
| `frontend/.env` | API URL 설정 |
| `frontend/.env.farmlocal` | 팜로컬 모드 설정 |

---

## 11. RPi 배포 절차

```bash
# 1. PC에서 flows 파일 전송
scp node-red/flows/combined-flows.json lhk@192.168.137.30:/tmp/

# 2. RPi에서 적용
ssh lhk@192.168.137.30
cp /tmp/combined-flows.json ~/.node-red/flows.json
pm2 restart node-red

# 3. 로그 확인
pm2 logs node-red --lines 30
```

---

## 12. 트러블슈팅 체크리스트

### 센서 데이터가 안 올 때

1. RPi에서 `pm2 logs node-red` 확인
2. `🔍 ① 모드=online` 로그 있는지 → 없으면 헬스체크 실패
3. `🔍 ② statusCode=200` 로그 → 없으면 API key 또는 네트워크 문제
4. `📋 전체 N개, 활성 N개` → 0이면 farmId 불일치
5. `⑥ 서버 전송 성공` → 없으면 houseId가 DB에 없음

### 동기화 404 에러

- SQLite에 저장된 옛날 데이터의 houseId가 서버 DB와 불일치
- 해결: `sqlite3 ~/.node-red/smartfarm.db "UPDATE sensor_data SET synced=1 WHERE synced=0;"`

### 대시보드 "수집 대기" 표시

- 마지막 센서 데이터가 `intervalSeconds × 10` 보다 오래됨
- 센서 수집 + 서버 전송 성공하면 자동으로 "정상"으로 변경
