/**
 * 제어 명령 라우트
 * 긴급 정지, 시작, 중지, 수동 제어 처리
 */
const router = require('express').Router();
const { SystemConfig, AlarmLog } = require('../models');
const controlService = require('../services/controlService');

/**
 * POST /api/control/emergency-stop
 * 긴급 정지 실행
 */
router.post('/emergency-stop', (req, res) => {
  try {
    // 시스템 상태를 긴급 정지로 변경
    SystemConfig.update({ emergency_stop: 1, operating_state: 'EMERGENCY' });

    // 긴급 정지 경보 기록
    AlarmLog.insert({ alarm_type: 'EMERGENCY_STOP', message: '긴급 정지 실행' });

    // 제어 서비스에 긴급 정지 명령 전달
    controlService.executeCommand({ type: 'EMERGENCY_STOP', source: 'touchpanel' });

    res.json({ success: true, message: '긴급 정지가 실행되었습니다.' });
  } catch (error) {
    console.error('긴급 정지 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '긴급 정지 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/control/start
 * 시스템 운전 시작
 */
router.post('/start', (req, res) => {
  try {
    // 운전 상태로 변경 및 긴급 정지 해제
    SystemConfig.update({ operating_state: 'RUNNING', emergency_stop: 0 });

    // 제어 서비스에 시작 명령 전달
    controlService.executeCommand({ type: 'START', source: 'touchpanel' });

    res.json({ success: true, message: '시스템 운전이 시작되었습니다.' });
  } catch (error) {
    console.error('시스템 시작 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '시스템 시작 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/control/stop
 * 시스템 운전 중지
 */
router.post('/stop', (req, res) => {
  try {
    // 운전 중지 상태로 변경
    SystemConfig.update({ operating_state: 'STOPPED' });

    // 제어 서비스에 중지 명령 전달
    controlService.executeCommand({ type: 'STOP', source: 'touchpanel' });

    res.json({ success: true, message: '시스템 운전이 중지되었습니다.' });
  } catch (error) {
    console.error('시스템 중지 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '시스템 중지 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /api/control/manual
 * 수동 제어 명령 실행
 * body: { action, valveNumber, ... }
 */
router.post('/manual', (req, res) => {
  try {
    const { action, valveNumber } = req.body;

    // 필수 필드 검증
    if (!action) {
      return res.status(400).json({ success: false, message: '제어 동작(action)을 지정해주세요.' });
    }

    // 제어 서비스에 수동 명령 전달
    controlService.executeCommand({ type: 'MANUAL', ...req.body, source: 'touchpanel' });

    res.json({ success: true, message: '수동 제어 명령이 실행되었습니다.' });
  } catch (error) {
    console.error('수동 제어 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '수동 제어 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
