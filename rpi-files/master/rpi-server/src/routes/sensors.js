/**
 * 센서 데이터 라우트
 * 센서 데이터 범위 조회
 */
const router = require('express').Router();
const { SensorData } = require('../models');

/**
 * GET /api/sensors
 * 센서 데이터 범위 조회
 * 쿼리 파라미터: from, to (ISO 문자열), limit (기본값 1000)
 */
router.get('/', (req, res) => {
  try {
    // 기본값 설정: from = 24시간 전, to = 현재
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const from = req.query.from || twentyFourHoursAgo.toISOString();
    const to = req.query.to || now.toISOString();
    const limit = parseInt(req.query.limit, 10) || 1000;

    // 센서 데이터 범위 조회
    const sensors = SensorData.getRange(from, to, limit);

    res.json({ success: true, data: sensors });
  } catch (error) {
    console.error('센서 데이터 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '센서 데이터 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
