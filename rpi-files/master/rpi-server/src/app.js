/**
 * RPi Express 앱 설정
 * 터치패널 + 원격 API 서빙
 */
require('dotenv').config();
const Sentry = require('@sentry/node');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const routes = require('./routes');
const internalRoutes = require('./routes/internal');
const { localOnly } = require('./middleware/localOnly');

const app = express();

// 미들웨어
app.use(helmet());
app.use(cors());
app.use(morgan('short'));
app.use(express.json());

// 정적 파일 서빙 (터치패널용 프론트엔드)
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// API 라우트
app.use('/api', routes);

// 내부 API (localhost만 접근 가능 — Node-RED 등)
app.use('/internal', localOnly, internalRoutes);

// 헬스 체크
// 초기 설정 페이지
const setupRoutes = require("./routes/setup");
app.use("/setup", setupRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// SPA 폴백 (터치패널)
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// 404 처리 — 등록되지 않은 경로 (POST/PUT/DELETE 등)
app.use((req, res) => {
  res.status(404).json({ success: false, message: '요청한 리소스를 찾을 수 없습니다.' });
});

// Sentry 자동 캡처 (커스텀 에러 핸들러 전)
Sentry.setupExpressErrorHandler(app);

// 전역 에러 핸들러
app.use((err, req, res, next) => {
  console.error('서버 오류:', err);
  res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
});

module.exports = app;
