/**
 * 시스템 설정 라우트
 * 시스템 설정 조회 및 업데이트
 */
const router = require('express').Router();
const { SystemConfig } = require('../models');

/**
 * GET /api/config
 * 시스템 설정 조회
 */
router.get('/', (req, res) => {
  try {
    const config = SystemConfig.get();
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('시스템 설정 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '시스템 설정 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * PUT /api/config
 * 시스템 설정 업데이트
 */
router.put('/', (req, res) => {
  try {
    SystemConfig.update(req.body);
    const updatedConfig = SystemConfig.get();
    res.json({ success: true, message: '시스템 설정이 업데이트되었습니다.', data: updatedConfig });
  } catch (error) {
    console.error('시스템 설정 업데이트 중 오류:', error);
    res.status(500).json({ success: false, message: '시스템 설정 업데이트 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
