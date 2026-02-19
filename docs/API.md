# API Documentation
## Configurable SmartFarm System

Base URL: `http://localhost:3000/api`

### 인증 방식
- **JWT**: `Authorization: Bearer <accessToken>` (대시보드, 제어, 일지, AI 등)
- **API Key**: `x-api-key: <SENSOR_API_KEY>` (센서 수집, 설정 조회 - JWT 폴백)

---

## Auth API (`/api/auth`)

### POST /auth/login
로그인

**Request Body:**
```json
{ "username": "admin", "password": "password123" }
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "username": "admin", "name": "관리자", "role": "admin", "farmId": "farm_001" },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### POST /auth/refresh
토큰 갱신

**Request Body:**
```json
{ "refreshToken": "eyJ..." }
```

### POST /auth/setup
초기 관리자 계정 생성 (첫 실행 시)

**Request Body:**
```json
{ "username": "admin", "password": "password123", "name": "관리자" }
```

### GET /auth/check-setup
초기 설정 필요 여부 확인

### GET /auth/me
현재 사용자 정보 (JWT 필요)

### POST /auth/logout
로그아웃 (JWT 필요)

### PUT /auth/change-password
비밀번호 변경 (JWT 필요)

**Request Body:**
```json
{ "currentPassword": "old", "newPassword": "new" }
```

### GET /auth/users
사용자 목록 (admin 전용)

### POST /auth/users
사용자 생성 (admin 전용)

**Request Body:**
```json
{ "username": "worker1", "password": "pass123", "name": "작업자1", "role": "worker" }
```

---

## Configuration API (`/api/config`)

인증: API Key 또는 JWT

### GET /config/farm/:farmId
농장 전체 하우스 목록 조회

**Response:**
```json
{
  "success": true,
  "data": {
    "farmId": "farm_001",
    "houses": [
      {
        "houseId": "house_001",
        "houseName": "1번 하우스",
        "enabled": true,
        "collection": { "intervalSeconds": 60, "method": "http" },
        "sensors": [
          { "sensorId": "temp_001", "name": "온도", "unit": "°C", "type": "number", "min": -10, "max": 50, "enabled": true, "icon": "🌡️" }
        ],
        "devices": [
          { "deviceId": "window1", "name": "1번창", "type": "window" }
        ]
      }
    ]
  }
}
```

### GET /config/:id
하우스 설정 조회 (farmId 쿼리 파라미터 또는 houseId로 조회)

### POST /config
새 하우스 설정 생성

**Request Body:**
```json
{
  "farmId": "farm_001",
  "houseId": "house_003",
  "houseName": "3번 하우스",
  "collection": { "intervalSeconds": 60 },
  "sensors": [
    { "sensorId": "temp_001", "name": "온도", "unit": "°C", "type": "number", "min": -10, "max": 50 }
  ]
}
```

### PUT /config/:houseId?farmId=farm_001
하우스 설정 수정

### DELETE /config/:houseId?farmId=farm_001
하우스 설정 삭제

---

## Sensor Data API (`/api/sensors`)

인증: API Key 또는 JWT

### POST /sensors/collect
센서 데이터 수집 (임계값 초과 시 알림 자동 생성)

**Request Body:**
```json
{
  "farmId": "farm_001",
  "houseId": "house_001",
  "data": {
    "temp_001": 25.5,
    "humidity_001": 65.2
  }
}
```

### POST /sensors/batch
배치 데이터 수집

**Request Body:**
```json
{
  "farmId": "farm_001",
  "houseId": "house_001",
  "dataArray": [
    { "timestamp": "2026-02-10T11:00:00Z", "data": { "temp_001": 25.0 } },
    { "timestamp": "2026-02-10T11:01:00Z", "data": { "temp_001": 25.2 } }
  ]
}
```

### GET /sensors/latest/:farmId/:houseId
### GET /sensors/:farmId/:houseId/latest
최신 센서 데이터 조회

### GET /sensors/data/:farmId/:houseId
### GET /sensors/:farmId/:houseId/history
히스토리 데이터 조회

**Query Parameters:**
- `startDate` (ISO string): 시작 날짜
- `endDate` (ISO string): 종료 날짜

### GET /sensors/:farmId/:houseId/stats/:sensorId
센서 통계 (TimescaleDB time_bucket 집계)

**Query Parameters:**
- `startDate`, `endDate` (ISO string)
- `interval`: `minute` | `hour` | `day` | `week`

---

## Alerts API (`/api/alerts`)

인증: JWT 필요

### GET /alerts/:farmId
알림 목록 조회

**Query Parameters:**
- `houseId` (string): 하우스 필터
- `acknowledged` (boolean): 확인 여부 필터
- `limit` (number, default 50, max 200)
- `page` (number, default 1)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "uuid",
      "farmId": "farm_001",
      "houseId": "house_001",
      "sensorId": "temp_001",
      "alertType": "HIGH",
      "severity": "WARNING",
      "message": "온도가 35°C로 임계값(30°C) 초과",
      "value": 35.0,
      "threshold": 30.0,
      "acknowledged": false,
      "timestamp": "2026-02-10T12:00:00Z"
    }
  ],
  "pagination": { "total": 10, "page": 1, "limit": 50, "totalPages": 1 }
}
```

### PUT /alerts/:alertId/acknowledge
개별 알림 확인 처리

### PUT /alerts/:farmId/acknowledge-all
전체 알림 확인 처리

**Query Parameters:**
- `houseId` (string): 특정 하우스만 처리

### DELETE /alerts/:alertId
알림 삭제

---

## Control Logs API (`/api/control-logs`)

인증: JWT 필요

### POST /control-logs
제어 이력 저장

**Request Body:**
```json
{
  "farmId": "farm_001",
  "houseId": "house_001",
  "deviceId": "window1",
  "deviceType": "window",
  "deviceName": "1번창",
  "command": "open",
  "success": true,
  "operator": "web_dashboard",
  "operatorName": "관리자"
}
```

### GET /control-logs/:farmId
제어 이력 조회

**Query Parameters:**
- `houseId`, `deviceType`, `startDate`, `endDate`
- `limit` (default 50), `page` (default 1)

### GET /control-logs/:farmId/stats
제어 통계 (장치별, 시간별)

### DELETE /control-logs/:farmId
제어 이력 삭제

---

## Automation API (`/api/automation`)

인증: API Key 또는 JWT

### GET /automation/:farmId
자동화 규칙 목록

### POST /automation/:farmId
규칙 생성

**Request Body:**
```json
{
  "name": "고온 환풍기 자동 가동",
  "houseId": "house_001",
  "conditionLogic": "AND",
  "conditions": [
    { "type": "sensor", "sensorId": "temp_001", "sensorName": "온도", "operator": ">", "value": 30 }
  ],
  "actions": [
    { "deviceId": "fan1", "deviceType": "fan", "deviceName": "환풍기 1", "command": "on" }
  ],
  "cooldownSeconds": 300,
  "enabled": true
}
```

### PUT /automation/:farmId/:ruleId
규칙 수정

### DELETE /automation/:farmId/:ruleId
규칙 삭제

### PATCH /automation/:farmId/:ruleId/toggle
규칙 활성/비활성 토글

### POST /automation/:farmId/evaluate
규칙 평가 (센서 데이터 기반)

---

## Journal API (`/api/journal`)

인증: JWT 필요

### 영농일지

| Method | Path | 설명 |
|--------|------|------|
| GET | /journal/:farmId/entries | 일지 목록 (page, limit, startDate, endDate) |
| GET | /journal/:farmId/entries/:id | 일지 상세 |
| POST | /journal/:farmId/entries | 일지 작성 |
| PUT | /journal/:farmId/entries/:id | 일지 수정 |
| DELETE | /journal/:farmId/entries/:id | 일지 삭제 |

### 수확 기록

| Method | Path | 설명 |
|--------|------|------|
| GET | /journal/:farmId/harvests | 수확 목록 |
| POST | /journal/:farmId/harvests | 수확 등록 |
| PUT | /journal/:farmId/harvests/:id | 수확 수정 |
| DELETE | /journal/:farmId/harvests/:id | 수확 삭제 |

### 투입물 기록

| Method | Path | 설명 |
|--------|------|------|
| GET | /journal/:farmId/inputs | 투입물 목록 |
| POST | /journal/:farmId/inputs | 투입물 등록 |
| PUT | /journal/:farmId/inputs/:id | 투입물 수정 |
| DELETE | /journal/:farmId/inputs/:id | 투입물 삭제 |

### 통계
| Method | Path | 설명 |
|--------|------|------|
| GET | /journal/:farmId/summary | 영농일지 통계 요약 |

---

## AI API (`/api/ai`)

인증: JWT 필요. AI 프로바이더: Ollama (기본) / OpenAI / Claude

### POST /ai/:farmId/pest-analysis
병해충 사진 진단 (multipart/form-data, `photo` 필드)

### GET /ai/:farmId/pest-analysis
병해충 진단 이력

### POST /ai/:farmId/growth-prediction
생육 예측

**Request Body:**
```json
{ "cropName": "토마토", "plantingDate": "2026-01-15", "growthStage": "개화기" }
```

### GET /ai/:farmId/task-recommendation
오늘의 작업 추천

### POST /ai/:farmId/chat
AI 농업 상담

**Request Body:**
```json
{ "message": "토마토 잎이 노랗게 변하고 있어요", "context": [] }
```

---

## 공통 사항

### 에러 응답
```json
{
  "success": false,
  "error": "에러 메시지",
  "code": "ERROR_CODE"
}
```

### HTTP 상태 코드
- 200: 성공
- 201: 생성 성공
- 400: 잘못된 요청
- 401: 인증 실패 (TOKEN_EXPIRED, INVALID_TOKEN)
- 403: 권한 없음
- 404: 리소스 없음
- 429: 요청 제한 초과
- 500: 서버 오류

### Rate Limiting
- 인증 API: 20 req / 15분
- 일반 API: 300 req / 1분
