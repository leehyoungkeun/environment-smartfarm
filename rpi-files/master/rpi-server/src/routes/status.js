/**
 * 현재 상태 라우트
 * 시스템 설정, 센서 데이터, MQTT 연결 상태, 활성 경보 종합 조회
 */
const router = require('express').Router();
const { SystemConfig, AlarmLog } = require('../models');
const sensorCache = require('../services/sensorCache');
const { getConnectionStatus } = require('../services/mqttService');

/**
 * GET /api/status
 * 시스템 종합 상태 조회
 */
router.get('/', (req, res) => {
  try {
    // 시스템 설정 조회
    const config = SystemConfig.get();

    // 최신 센서 데이터 (캐시에서 조회)
    const latestSensors = sensorCache.getLatest();

    // MQTT 연결 상태 확인
    const mqttConnected = getConnectionStatus();

    // 활성 경보 목록 조회
    const activeAlarms = AlarmLog.getActive();

    res.json({
      success: true,
      data: {
        config,
        latestSensors,
        mqttConnected,
        activeAlarms
      }
    });
  } catch (error) {
    console.error('시스템 상태 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '시스템 상태 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
