/**
 * 일일 집계 라우트
 * 일일 요약 및 밸브별 유량 데이터 조회
 */
const router = require('express').Router();
const { DailySummary, DailyValveFlow } = require('../models');

/**
 * GET /api/daily-summary
 * 특정 날짜의 일일 집계 데이터 조회
 * 쿼리 파라미터: date (필수, YYYY-MM-DD 형식)
 */
router.get('/', (req, res) => {
  try {
    const { date } = req.query;

    // 날짜 파라미터 검증
    if (!date) {
      return res.status(400).json({ success: false, message: '날짜(date) 파라미터가 필요합니다. (YYYY-MM-DD)' });
    }

    // 일일 요약 데이터 조회
    const summaries = DailySummary.getByDate(date);

    // 밸브별 유량 데이터 조회
    const valveFlows = DailyValveFlow.getByDate(date);

    res.json({
      success: true,
      data: {
        summaries,
        valveFlows
      }
    });
  } catch (error) {
    console.error('일일 집계 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '일일 집계 조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
