/**
 * WebSocket 서비스 (터치패널용)
 * 1초 간격으로 시스템 상태를 로컬 클라이언트에 브로드캐스트
 */
const WebSocket = require('ws');
const { SystemConfig, AlarmLog } = require('../models');
const sensorCache = require('./sensorCache');

let wss = null;
let broadcastInterval = null;
const BROADCAST_INTERVAL_MS = 1000; // 1초 간격

/**
 * WebSocket 서비스 초기화
 * HTTP 서버에 WebSocket 서버를 연결하고 브로드캐스트 시작
 * @param {object} server - HTTP 서버 인스턴스
 */
function initWsService(server) {
  try {
    wss = new WebSocket.Server({ server, path: '/ws/status' });

    // 클라이언트 연결 이벤트
    wss.on('connection', (ws) => {
      console.log('터치패널 WebSocket 연결');

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('close', () => {
        console.log('터치패널 WebSocket 해제');
      });

      ws.on('error', (error) => {
        console.error('WebSocket 클라이언트 오류:', error);
      });
    });

    // 1초마다 상태 브로드캐스트
    broadcastInterval = setInterval(broadcastStatus, BROADCAST_INTERVAL_MS);

    // 30초 핑/퐁 — 비활성 연결 감지 및 종료
    setInterval(() => {
      try {
        wss.clients.forEach((ws) => {
          if (!ws.isAlive) return ws.terminate();
          ws.isAlive = false;
          ws.ping();
        });
      } catch (error) {
        console.error('WebSocket 핑/퐁 처리 오류:', error);
      }
    }, 30000);

    console.log('터치패널 WebSocket 서비스 초기화 (/ws/status)');
  } catch (error) {
    console.error('WebSocket 서비스 초기화 오류:', error);
    throw error;
  }
}

/**
 * 시스템 상태 브로드캐스트
 * 연결된 모든 터치패널 클라이언트에 최신 상태 전송
 */
function broadcastStatus() {
  if (!wss || wss.clients.size === 0) return;

  try {
    const config = SystemConfig.get();
    const latest = sensorCache.getLatest();
    const activeAlarms = AlarmLog.getActive();

    const message = JSON.stringify({
      type: 'status',
      data: {
        ...config,
        latestSensors: latest,
        activeAlarms,
      },
    });

    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  } catch (error) {
    console.error('WebSocket 브로드캐스트 오류:', error);
  }
}

/**
 * 현재 연결된 WebSocket 클라이언트 수 조회
 * @returns {number} 클라이언트 수
 */
function getClientCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = { initWsService, getClientCount };
