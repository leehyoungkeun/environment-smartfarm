/**
 * 경보 이력 라우트
 * 경보 목록 조회, 활성 경보 조회, 경보 해결 처리
 */
const router = require('express').Router();
const { AlarmLog } = require('../models');

/**
 * GET /api/alarms
 * 최근 경보 이력 조회
 * 쿼리 파라미터: limit (기본값 50)
 */
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const alarms = AlarmLog.getRecent(limit);

    res.json({ success: true, data: alarms });
  } catch (error) {
    console.error('경보 이력 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '경보 이력 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * GET /api/alarms/active
 * 현재 활성 경보 목록 조회
 */
router.get('/active', (req, res) => {
  try {
    const alarms = AlarmLog.getActive();
    res.json({ success: true, data: alarms });
  } catch (error) {
    console.error('활성 경보 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '활성 경보 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * PUT /api/alarms/:id/resolve
 * 경보 해결 처리
 */
router.put('/:id/resolve', (req, res) => {
  try {
    AlarmLog.resolve(req.params.id);
    res.json({ success: true, message: '경보가 해결되었습니다.' });
  } catch (error) {
    console.error('경보 해결 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '경보 해결 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
