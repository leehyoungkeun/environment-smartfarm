# Configurable SmartFarm System
## 완전히 동적 설정 가능한 스마트팜 통합 관리 시스템

---

## 프로젝트 개요

관리자가 앱에서 **하우스 개수, 센서 종류, 수집 주기**를 설정하면
**Edge(라즈베리파이) → Server(백엔드) → Client(React)**
전체 파이프라인이 자동으로 반응하는 완전 동적 시스템

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│              React Admin App (PWA)                       │
│  (대시보드, 제어, 자동화, 영농일지, AI 도우미)            │
└────────────────┬───────────────────┬────────────────────┘
                 │ REST API          │ AWS API Gateway
┌────────────────▼──────────┐  ┌────▼────────────────────┐
│  Node.js Express Backend  │  │  AWS Lambda → IoT Core  │
│  (PostgreSQL+TimescaleDB) │  │  (개폐기 제어)           │
└────────────────┬──────────┘  └─────────────────────────┘
                 │ HTTP (Config 조회 & 데이터 수집)
┌────────────────▼────────────────────────────────────────┐
│         Raspberry Pi (Node-RED)                          │
│  (동적 센서 수집 - 서버 설정 기반)                        │
└─────────────────────────────────────────────────────────┘
```

---

## 프로젝트 구조

```
configurable-smartfarm/
├── backend/                          # Node.js Express 백엔드
│   ├── src/
│   │   ├── models/
│   │   │   ├── User.js               # 사용자 (Prisma)
│   │   │   ├── Config.js             # 하우스 설정 (Prisma)
│   │   │   ├── AutomationRule.js     # 자동화 규칙 (Prisma)
│   │   │   ├── SensorData.js         # 센서 데이터 (TimescaleDB)
│   │   │   ├── ControlLog.js         # 제어 이력 (TimescaleDB)
│   │   │   └── Alert.js              # 알림 (TimescaleDB)
│   │   ├── routes/
│   │   │   ├── auth.routes.js        # 인증/사용자 관리
│   │   │   ├── config.routes.js      # 하우스 설정 CRUD
│   │   │   ├── sensors.js            # 센서 데이터 수집/조회
│   │   │   ├── alerts.js             # 알림 조회/확인/삭제
│   │   │   ├── control-logs.js       # 제어 이력
│   │   │   ├── automation.routes.js  # 자동화 규칙 CRUD
│   │   │   ├── journal.routes.js     # 영농일지/수확/투입물
│   │   │   └── ai.routes.js          # AI 병해충/생육/추천/채팅
│   │   ├── middleware/
│   │   │   └── auth.middleware.js     # JWT, API Key, RBAC, 테넌트 격리
│   │   ├── utils/
│   │   │   └── logger.js             # Winston 로거
│   │   ├── db.js                     # Prisma + pg Pool 이중 연결
│   │   └── app.js                    # Express 앱
│   ├── prisma/
│   │   ├── schema.prisma             # Prisma 스키마
│   │   └── init-timescale.sql        # TimescaleDB 하이퍼테이블
│   ├── .env.example
│   └── package.json
│
├── frontend/                         # React SPA (Vite + Tailwind)
│   ├── src/
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx       # JWT 인증 + 자동 토큰 갱신
│   │   ├── services/
│   │   │   └── controlApi.js         # AWS 개폐기 제어 API
│   │   ├── components/
│   │   │   ├── Auth/
│   │   │   │   ├── LoginPage.jsx     # 로그인 + 초기 설정
│   │   │   │   └── UserManager.jsx   # 사용자 관리 (admin)
│   │   │   ├── Dashboard/
│   │   │   │   ├── DynamicDashboard.jsx   # 메인 대시보드
│   │   │   │   ├── ControlPanel.jsx       # 장치 제어
│   │   │   │   ├── ControlHistory.jsx     # 제어 이력
│   │   │   │   ├── AutomationManager.jsx  # 자동화 규칙
│   │   │   │   ├── AlertPanel.jsx         # 알림 패널
│   │   │   │   ├── AnalyticsDashboard.jsx # 센서 분석
│   │   │   │   ├── SensorChart.jsx        # 시계열 차트
│   │   │   │   ├── GaugeWidget.jsx        # 게이지 위젯
│   │   │   │   ├── StatsWidget.jsx        # 통계 위젯
│   │   │   │   ├── SystemStatusWidget.jsx # 시스템 상태
│   │   │   │   └── TodaySummaryWidget.jsx # 오늘 요약
│   │   │   ├── Settings/
│   │   │   │   └── ConfigurationManager.jsx # 하우스/센서/장치 설정
│   │   │   ├── Journal/
│   │   │   │   └── JournalManager.jsx     # 영농일지/수확/투입물
│   │   │   └── AI/
│   │   │       └── AIManager.jsx          # AI 농업 도우미
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   │   ├── sw.js                     # Service Worker (PWA)
│   │   └── manifest.json
│   ├── env.example
│   └── package.json
│
├── node-red/                         # Node-RED (라즈베리파이)
│   └── function-nodes/
│       └── dynamic-collection.js     # 동적 센서 수집 함수
│
└── docs/
    └── API.md                        # API 문서
```

---

## 핵심 기능

### 1. 완전 동적 설정
- 하우스 개수: 무제한 추가/삭제
- 센서 종류: 무제한 추가/삭제 (ID, 이름, 단위, 범위, 아이콘 커스터마이징)
- 수집 주기: 초/분 단위 설정
- 장치 관리: 개폐기, 환풍기, 히터, 관수밸브

### 2. 인증 및 권한 관리
- JWT 인증 (Access Token + Refresh Token 자동 갱신)
- RBAC: admin(전체 권한), worker(대시보드/제어/이력/일지/AI)
- API Key 인증 (Node-RED 센서 수집용)
- 테넌트 격리 (farmId 기반)

### 3. 센서 데이터 & 알림
- TimescaleDB 하이퍼테이블로 시계열 데이터 최적화
- 센서 임계값 초과 시 자동 알림 생성
- 알림 확인/삭제, 전체 확인 처리

### 4. 장치 제어
- AWS API Gateway → Lambda → IoT Core → 라즈베리파이
- 개폐기(열기/정지/닫기), 환풍기/히터(ON/OFF), 관수밸브(열기/정지/닫기)
- 제어 이력 기록 및 통계

### 5. 자동화
- 센서 조건(온도 > 30도) + 시간 조건(평일 08:00)
- AND/OR 논리 조합
- 쿨다운, 우선순위, 활성/비활성 관리
- 하우스별 동적 센서 목록 연동

### 6. 영농일지
- 작업 일지 (파종, 정식, 관수, 시비, 방제, 수확 등)
- 수확 기록 (작물, 수량, 등급)
- 투입물 기록 (비료, 농약, 종자)
- 사진 업로드 (최대 5장, 10MB)
- PDF/CSV 내보내기, 달력 뷰

### 7. AI 농업 도우미
- 병해충 사진 진단 (Ollama/OpenAI/Claude)
- 생육 예측
- 작업 추천
- AI 채팅 상담

### 8. PWA
- 홈 화면 설치 가능
- 모바일 반응형 (하단 탭 네비게이션)
- 데스크톱/모바일 알림 패널

---

## 데이터 모델

### 관계형 테이블 (Prisma + PostgreSQL)
- `users` - 사용자 (username, password, role, farmId)
- `house_configs` - 하우스 설정 (sensors, devices, collection JSONB)
- `automation_rules` - 자동화 규칙 (conditions, actions JSONB)
- `farm_journals` - 영농일지
- `harvest_records` - 수확 기록
- `input_records` - 투입물 기록

### 시계열 테이블 (TimescaleDB 하이퍼테이블)
- `sensor_data` - 센서 데이터 (7일 파티션, 자동 압축)
- `control_logs` - 제어 이력 (30일 파티션, 자동 압축)
- `alerts` - 알림 (30일 파티션)

---

## 기술 스택

### Backend
- **Runtime**: Node.js 18+ (ES Modules)
- **Framework**: Express 4.21
- **Database**: PostgreSQL + TimescaleDB
- **ORM**: Prisma (관계형) + pg Pool (시계열)
- **Auth**: JWT (bcryptjs), API Key
- **Security**: helmet, cors, express-rate-limit, compression

### Frontend
- **Framework**: React 18 + Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **HTTP**: Axios (인터셉터 기반 자동 토큰 갱신)
- **Export**: html2canvas + jspdf (PDF), CSV
- **PWA**: Service Worker + manifest

### Edge
- **Platform**: Raspberry Pi 4
- **Runtime**: Node-RED
- **Protocol**: HTTP (REST API)

### Cloud
- **제어**: AWS API Gateway → Lambda → IoT Core

---

## 설치 및 실행

### 1. 백엔드

```bash
cd backend
npm install

# 환경변수 설정
cp .env.example .env
# DATABASE_URL, JWT_SECRET 등 수정

# Prisma 스키마 적용
npx prisma db push

# TimescaleDB 하이퍼테이블 생성
psql -U YOUR_USER -d smartfarm_db -f prisma/init-timescale.sql

# 서버 시작
npm run dev
```

### 2. 프론트엔드

```bash
cd frontend
npm install

# 환경변수 설정
cp env.example .env
# VITE_API_BASE_URL, VITE_AWS_CONTROL_ENDPOINT 수정

npm run dev
```

### 3. Node-RED (라즈베리파이)

```bash
node-red
# http://라즈베리파이IP:1880 접속
# function-nodes/dynamic-collection.js 내용을 Function 노드에 설정
```

---

## 보안

- **인증**: JWT (Access 24h + Refresh 7d, 자동 갱신)
- **권한**: Role-based Access Control (admin, worker)
- **Rate Limiting**: 인증 20req/15min, API 300req/min
- **CORS**: 지정된 도메인만 허용
- **테넌트 격리**: farmId 기반 데이터 분리
- **API Key**: 센서 수집용 별도 인증

---

## 라이선스

MIT License
