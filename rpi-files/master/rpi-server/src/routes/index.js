/**
 * RPi API 라우트 집합
 * 모든 API 라우트를 하나로 통합
 */
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

// 인증 라우트 (공개)
router.use('/auth', require('./auth'));

// 인증 필요 라우트
router.use(authenticate);
router.use('/config', require('./config'));
router.use('/programs', require('./programs'));
router.use('/status', require('./status'));
router.use('/sensors', require('./sensors'));
router.use('/control', require('./control'));
router.use('/daily-summary', require('./dailySummary'));
router.use('/alarms', require('./alarms'));

module.exports = router;
