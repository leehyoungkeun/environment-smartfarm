/**
 * 온디맨드 발행 서비스
 * 사무실 서버의 요청이 있을 때만 텔레메트리/상태 데이터를 MQTT로 발행
 * 비용 절약: 아무도 보지 않으면 발행하지 않음
 */
const { publish, getFarmTopics, setPublisherService } = require('./mqttService');
const sensorCache = require('./sensorCache');
const { SystemConfig } = require('../models');

let subscriberCount = 0;
let publishInterval = null;
const PUBLISH_INTERVAL_MS = 3000; // 3초 간격

/**
 * 구독자 추가 (사무실 서버의 request/start 수신 시)
 * 첫 구독자가 추가되면 텔레메트리 발행을 시작
 */
function start() {
  try {
    subscriberCount++;
    console.log(`텔레메트리 발행 구독자 추가 (현재: ${subscriberCount})`);

    if (subscriberCount === 1 && !publishInterval) {
      // 첫 구독자 — 발행 시작
      publishInterval = setInterval(publishTelemetry, PUBLISH_INTERVAL_MS);
      console.log(`텔레메트리 발행 시작 (${PUBLISH_INTERVAL_MS}ms 간격)`);
    }
  } catch (error) {
    console.error('텔레메트리 발행 시작 오류:', error);
  }
}

/**
 * 구독자 제거 (사무실 서버의 request/stop 수신 시)
 * 모든 구독자가 제거되면 텔레메트리 발행을 중단
 */
function stop() {
  try {
    subscriberCount = Math.max(0, subscriberCount - 1);
    console.log(`텔레메트리 발행 구독자 제거 (현재: ${subscriberCount})`);

    if (subscriberCount === 0 && publishInterval) {
      clearInterval(publishInterval);
      publishInterval = null;
      console.log('텔레메트리 발행 중단 (구독자 없음)');
    }
  } catch (error) {
    console.error('텔레메트리 발행 중단 오류:', error);
  }
}

/**
 * 텔레메트리 데이터 발행
 * 센서 캐시와 시스템 설정에서 최신 데이터를 수집하여 MQTT로 발행
 */
async function publishTelemetry() {
  try {
    const farmTopics = getFarmTopics();
    const latest = sensorCache.getLatest();
    const config = SystemConfig.get();

    // 텔레메트리 발행 (센서 측정값)
    await publish(farmTopics.telemetry, {
      timestamp: Date.now(),
      sensors: {
        currentEc: config.current_ec,
        currentPh: config.current_ph,
        outdoorTemp: config.outdoor_temp,
        indoorTemp: config.indoor_temp,
        substrateTemp: config.substrate_temp,
        solarRadiation: config.solar_radiation,
        supplyFlow: config.supply_flow,
        drainFlow: config.drain_flow,
        ...latest,
      },
    });

    // 상태 발행 (운전 상태, 장비 상태 등)
    await publish(farmTopics.status, {
      timestamp: Date.now(),
      operatingState: config.operating_state,
      currentProgram: config.current_program,
      emergencyStop: config.emergency_stop,
      irrigationPump: config.irrigation_pump,
      drainPump: config.drain_pump,
      mixerMotor: config.mixer_motor,
      dailyTotalSupply: config.daily_total_supply,
      dailyTotalDrain: config.daily_total_drain,
    });
  } catch (error) {
    console.error('텔레메트리 발행 오류:', error);
  }
}

/**
 * 현재 구독자 수 조회
 * @returns {number} 구독자 수
 */
function getSubscriberCount() {
  return subscriberCount;
}

/**
 * 텔레메트리 발행 중인지 확인
 * @returns {boolean} 발행 중 여부
 */
function isPublishing() {
  return publishInterval !== null;
}

// mqttService에 자기 자신 등록
setPublisherService({ start, stop });

module.exports = { start, stop, getSubscriberCount, isPublishing };
