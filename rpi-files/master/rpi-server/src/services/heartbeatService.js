/**
 * 하트비트 서비스
 * 60초마다 사무실 서버에 생존 신호 전송
 * RPi가 정상 동작 중임을 사무실 서버가 감지할 수 있도록 함
 */
const { publish, getFarmTopics, getConnectionStatus } = require('./mqttService');
const { SystemConfig } = require('../models');

const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60초
let intervalId = null;

/**
 * 하트비트 서비스 시작
 * 즉시 한 번 전송 후 60초 간격으로 반복 전송
 */
function startHeartbeat() {
  try {
    intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    // 시작 직후 즉시 한 번 전송
    sendHeartbeat();
    console.log(`하트비트 서비스 시작 (${HEARTBEAT_INTERVAL_MS / 1000}초 간격)`);
  } catch (error) {
    console.error('하트비트 서비스 시작 오류:', error);
  }
}

/**
 * 하트비트 서비스 중지
 * 타이머를 해제하여 더 이상 하트비트를 전송하지 않음
 */
function stopHeartbeat() {
  try {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('하트비트 서비스 중지');
    }
  } catch (error) {
    console.error('하트비트 서비스 중지 오류:', error);
  }
}

/**
 * 하트비트 메시지 전송
 * 현재 운전 상태, 긴급정지 여부, 업타임 정보를 포함
 */
async function sendHeartbeat() {
  if (!getConnectionStatus()) return;

  try {
    const config = SystemConfig.get();
    const farmTopics = getFarmTopics();

    await publish(farmTopics.status.replace('/status', '/heartbeat'), {
      timestamp: Date.now(),
      operatingState: config.operating_state,
      emergencyStop: config.emergency_stop,
      uptime: process.uptime(),
    });
  } catch (error) {
    console.error('하트비트 전송 오류:', error);
  }
}

module.exports = { startHeartbeat, stopHeartbeat };
