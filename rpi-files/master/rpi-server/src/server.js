/**
 * RPi 서버 진입점
 * HTTP 서버 시작, WebSocket, MQTT, 하트비트, 일일동기화 초기화
 */
require('./instrument'); // Sentry: 반드시 다른 require 보다 먼저
const Sentry = require('@sentry/node');
require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initWsService } = require('./services/wsService');
const { initMqttService } = require('./services/mqttService');
const { startHeartbeat, stopHeartbeat } = require('./services/heartbeatService');
const { startDailySync, stopDailySync } = require('./services/dailySyncService');
const { db } = require('./models');

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

async function start() {
  try {
    // 1. WebSocket 서비스 초기화 (터치패널용, 1초 간격)
    initWsService(server);
    console.log('✅ WebSocket 서비스 초기화 완료');

    // 2. MQTT 서비스 초기화 (AWS IoT Core 연결)
    try {
      await initMqttService();
      console.log('✅ MQTT 서비스 초기화 완료');
    } catch (mqttError) {
      console.warn('⚠️  MQTT 초기화 실패 (오프라인 모드):', mqttError.message);
    }

    // 3. 하트비트 서비스 시작 (60초마다)
    startHeartbeat();
    console.log('✅ 하트비트 서비스 시작');

    // 4. 일일 동기화 서비스 시작
    startDailySync();
    console.log('✅ 일일 동기화 서비스 시작');

    // 5. HTTP 서버 시작
    server.listen(PORT, () => {
      console.log(`🚀 RPi 서버 실행 중: http://localhost:${PORT}`);
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { phase: 'startup' } });
    console.error('❌ RPi 서버 시작 실패:', error);
    process.exit(1);
  }
}

start();

process.on('uncaughtException', (err) => {
  Sentry.captureException(err, { tags: { handler: 'uncaughtException' } });
  console.error('UNCAUGHT EXCEPTION:', err);
  Sentry.flush(2000).catch(() => {}).finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    tags: { handler: 'unhandledRejection' },
  });
  console.error('UNHANDLED REJECTION:', reason);
});

/**
 * Graceful Shutdown
 * SIGTERM/SIGINT 수신 시 서비스를 순서대로 정리 후 종료
 */
function shutdown(signal) {
  console.log(`\n${signal} 수신 — 서버 종료 중...`);

  // 1. 스케줄 서비스 중지
  stopHeartbeat();
  stopDailySync();

  // 2. HTTP 서버 종료 (새 연결 거부, 기존 연결 완료 대기)
  server.close(() => {
    console.log('HTTP 서버 종료 완료');

    // 3. SQLite 데이터베이스 닫기
    try {
      db.close();
      console.log('SQLite 데이터베이스 닫기 완료');
    } catch (e) {
      // 이미 닫혔을 수 있음
    }

    console.log('서버 정상 종료');
    process.exit(0);
  });

  // 5초 내 종료되지 않으면 강제 종료
  setTimeout(() => {
    console.error('종료 타임아웃 — 강제 종료');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
