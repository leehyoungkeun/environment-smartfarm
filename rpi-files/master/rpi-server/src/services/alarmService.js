/**
 * 경보 서비스
 * 센서 데이터의 임계값을 확인하여 경보 생성/해제
 * EC, pH, 온도 등 주요 센서 값의 상한/하한을 모니터링
 */
const { SystemConfig, AlarmLog } = require('../models');
const { publish, getFarmTopics, getConnectionStatus } = require('./mqttService');

// 활성 경보 추적 (중복 경보 방지용)
const activeAlarms = new Map();

// 기본 임계값 정의
const THRESHOLDS = {
  EC_HIGH: { field: 'ec', compare: '>', getThreshold: (config) => config.set_ec + 1.0 },
  EC_LOW: { field: 'ec', compare: '<', getThreshold: (config) => config.set_ec - 1.0 },
  PH_HIGH: { field: 'ph', compare: '>', getThreshold: (config) => config.set_ph + 0.5 },
  PH_LOW: { field: 'ph', compare: '<', getThreshold: (config) => config.set_ph - 0.5 },
  TEMP_HIGH: { field: 'indoor_temp', compare: '>', getThreshold: () => 40 },
  TEMP_LOW: { field: 'indoor_temp', compare: '<', getThreshold: () => 5 },
};

/**
 * 센서 데이터 임계값 확인
 * 각 센서 값을 설정된 임계값과 비교하여 경보 생성 또는 해제
 * @param {object} sensorData - 센서 측정값
 */
function checkThresholds(sensorData) {
  try {
    const config = SystemConfig.get();

    for (const [alarmType, threshold] of Object.entries(THRESHOLDS)) {
      const value = sensorData[threshold.field];
      if (value == null) continue;

      const limit = threshold.getThreshold(config);
      // 비교 방향에 따라 초과 여부 판단
      const isExceeded = threshold.compare === '>'
        ? value > limit
        : value < limit;

      if (isExceeded && !activeAlarms.has(alarmType)) {
        // 새 경보 생성 — 임계값 초과 최초 감지
        try {
          AlarmLog.insert({
            alarm_type: alarmType,
            alarm_value: value,
            threshold_value: limit,
            message: `${alarmType}: 측정값 ${value}, 임계값 ${limit}`,
          });
          activeAlarms.set(alarmType, { value, limit });

          // MQTT로 경보 발행 (사무실 서버에 알림)
          if (getConnectionStatus()) {
            const farmTopics = getFarmTopics();
            publish(farmTopics.alarm, {
              alarmType,
              alarmValue: value,
              thresholdValue: limit,
              message: `${alarmType}: 측정값 ${value}, 임계값 ${limit}`,
              timestamp: Date.now(),
            });
          }
          console.log(`경보 발생: ${alarmType} (값: ${value}, 임계: ${limit})`);
        } catch (insertError) {
          console.error(`경보 생성 오류 (${alarmType}):`, insertError);
        }

      } else if (!isExceeded && activeAlarms.has(alarmType)) {
        // 정상 복귀 — 경보 자동 해제
        try {
          activeAlarms.delete(alarmType);

          // 최근 미해결 경보를 찾아서 해결 처리
          const recentAlarms = AlarmLog.getActive();
          const alarm = recentAlarms.find(a => a.alarm_type === alarmType);
          if (alarm) {
            AlarmLog.resolve(alarm.id);
            console.log(`경보 해제: ${alarmType}`);
          }
        } catch (resolveError) {
          console.error(`경보 해제 오류 (${alarmType}):`, resolveError);
        }
      }
    }
  } catch (error) {
    console.error('임계값 확인 오류:', error);
  }
}

module.exports = { checkThresholds };
