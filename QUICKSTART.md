# Quick Start Guide
## Configurable SmartFarm System

완전히 동적 설정 가능한 스마트팜 시스템 빠른 시작 가이드

---

## 🚀 5분 만에 시작하기

### 1단계: 백엔드 실행 (사무실 서버)

```bash
# 프로젝트 압축 해제
tar -xzf configurable-smartfarm-complete.tar.gz
cd configurable-smartfarm/backend

# 패키지 설치
npm install

# 환경변수 설정
cp .env.example .env

# .env 파일 편집 (MongoDB URI는 이미 설정됨)
# MONGODB_URI는 제공된 Atlas URI 사용

# 서버 시작
npm run dev
```

**백엔드가 http://localhost:3000 에서 실행됩니다!**

### 2단계: 프론트엔드 실행 (관리자 앱)

```bash
# 새 터미널 열기
cd configurable-smartfarm/frontend

# 패키지 설치
npm install

# 환경변수 설정
echo "VITE_API_BASE_URL=http://localhost:3000/api" > .env

# 개발 서버 시작
npm run dev
```

**프론트엔드가 http://localhost:5173 에서 실행됩니다!**

### 3단계: 초기 데이터 설정

브라우저에서 http://localhost:5173 접속 후:

1. **설정 페이지**로 이동
2. **"+ 새 하우스 추가"** 버튼 클릭
3. 자동으로 하우스가 생성됨 (기본 센서 2개 포함)
4. **대시보드**로 이동하여 확인

### 4단계: Node-RED 설정 (라즈베리파이)

```bash
# 라즈베리파이에서 실행
node-red

# 브라우저에서 접속
# http://라즈베리파이IP:1880

# 플로우 임포트
# 1. 메뉴 → Import
# 2. node-red/flows.json 내용 붙여넣기
# 3. Deploy 클릭
```

**완료! 시스템이 작동합니다!** 🎉

---

## 📱 사용 시나리오

### 시나리오 1: 새 센서 추가하기

```
1. 프론트엔드 → 설정 페이지
2. 하우스 선택
3. "센서 추가" 섹션에서:
   - 센서 ID: "ph_001"
   - 이름: "토양 pH"
   - 단위: "pH"
   - 아이콘: "🧪"
4. "센서 추가" 버튼 클릭
5. "저장" 버튼 클릭

→ 라즈베리파이가 다음 수집 시 자동으로 새 센서 포함!
→ 대시보드에 자동으로 새 카드 생성!
```

### 시나리오 2: 수집 주기 변경

```
1. 설정 페이지 → 하우스 선택
2. "수집 주기 (초)" 필드를 60 → 30으로 변경
3. "저장" 클릭

→ 라즈베리파이가 즉시 감지 (다음 수집 시)
→ 30초마다 데이터 전송 시작
```

### 시나리오 3: 하우스 추가

```
1. 설정 페이지
2. "+ 새 하우스 추가" 버튼
3. 자동으로 "house_002" 생성
4. 기본 센서 2개 자동 추가

→ 즉시 대시보드에서 확인 가능
→ 라즈베리파이 설정만 하면 수집 시작
```

---

## 🔧 테스트 방법

### 1. API 테스트 (curl)

```bash
# Health Check
curl http://localhost:3000/health

# 설정 조회
curl http://localhost:3000/api/config/house_001?farmId=farm_001

# 테스트 데이터 전송
curl -X POST http://localhost:3000/api/sensors/collect \
  -H "Content-Type: application/json" \
  -d '{
    "farmId": "farm_001",
    "houseId": "house_001",
    "data": {
      "temp_001": 25.5,
      "humidity_001": 65.2
    }
  }'

# 최신 데이터 조회
curl http://localhost:3000/api/sensors/farm_001/house_001/latest
```

### 2. 프론트엔드 테스트

```
1. http://localhost:5173 접속
2. 대시보드에서 실시간 데이터 확인
3. 설정 페이지에서 센서 추가/삭제
4. 차트에서 데이터 시각화 확인
```

### 3. Node-RED 시뮬레이션

```
Node-RED에서:
1. Inject 노드 수동 클릭
2. Debug 패널에서 로그 확인
3. 백엔드 로그에서 데이터 수신 확인
4. 프론트엔드에서 데이터 표시 확인
```

---

## 📂 프로젝트 구조

```
configurable-smartfarm/
├── backend/                 # Node.js Express 백엔드
│   ├── src/
│   │   ├── models/
│   │   │   ├── Config.js           # 하우스 설정 (동적!)
│   │   │   └── SensorData.js       # 센서 데이터 (Flexible!)
│   │   ├── routes/
│   │   │   ├── config.js           # 설정 API
│   │   │   └── sensors.js          # 센서 API
│   │   ├── utils/
│   │   │   └── logger.js
│   │   └── app.js                  # Express 앱
│   ├── package.json
│   └── .env
│
├── frontend/                # React 프론트엔드
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard/
│   │   │   │   └── DynamicDashboard.jsx    # 동적 대시보드
│   │   │   └── Settings/
│   │   │       └── ConfigurationManager.jsx # 설정 관리
│   │   └── App.jsx
│   ├── package.json
│   └── .env
│
├── node-red/                # Node-RED 플로우
│   └── function-nodes/
│       └── dynamic-collection.js   # 동적 센서 수집
│
└── docs/
    ├── API.md               # API 문서
    └── README.md
```

---

## 🎯 핵심 기능

### ✅ 완전 동적 설정
- 하우스 개수: 무제한 추가
- 센서 종류: 무제한 추가/삭제
- 수집 주기: 10초~1시간 자유 설정

### ✅ 자동 동기화
- 설정 변경 → DB 저장
- 라즈베리파이 자동 감지
- UI 자동 업데이트

### ✅ 유연한 데이터 모델
- Metadata Pattern 사용
- 센서 추가 시 스키마 변경 불필요
- Key-Value 형태로 무제한 확장

### ✅ 확장성
- 1,000개 농장 지원 가능
- 배치 처리 최적화
- 비동기 큐 지원 준비

---

## 🔍 문제 해결

### DB 연결 실패
```bash
# .env 파일 확인
cat backend/.env

# PostgreSQL 연결 정보 확인
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/smartfarm_db
```

### 프론트엔드 API 연결 실패
```bash
# 백엔드가 실행 중인지 확인
curl http://localhost:3000/health

# CORS 설정 확인
# backend/.env 에서 CORS_ORIGIN 설정
```

### Node-RED 데이터 전송 실패
```javascript
// Function 노드에서 서버 URL 확인
const SERVER_URL = 'http://사무실서버IP:3000';

// 네트워크 연결 확인
ping 사무실서버IP
```

---

## 📈 다음 단계

### 1. 실제 센서 연결
```javascript
// Node-RED Function 노드 수정
// 가상 데이터 대신 실제 센서 읽기

function readDHT22Temperature() {
  const sensor = require('node-dht-sensor');
  const result = sensor.read(22, 4);
  return result.temperature;
}
```

### 2. 알람 기능 추가
- 센서 임계값 설정
- 이메일/SMS 알람
- WebSocket 실시간 알람

### 3. 자동 제어 추가
- 온도에 따른 개폐기 자동 제어
- 습도에 따른 관수 자동 제어

### 4. 프로덕션 배포
- PM2로 백엔드 실행
- Nginx 리버스 프록시
- HTTPS 적용

---

## 📞 지원

문제가 있으신가요?

1. API 문서 확인: `docs/API.md`
2. 로그 확인:
   - 백엔드: 콘솔 로그
   - 프론트엔드: 브라우저 개발자 도구
   - Node-RED: Debug 패널

---

## 🎉 축하합니다!

완전히 동적으로 설정 가능한 스마트팜 시스템이 완성되었습니다!

**이제 센서를 마음대로 추가/삭제하고, 수집 주기를 변경하면**
**전체 시스템이 자동으로 반응합니다!** 🚀
