/**
 * 제어 서비스
 * 터치패널/원격 명령을 통합 처리
 * 밸브 제어, 펌프 제어, 긴급정지 등
 */
const { SystemConfig, AlarmLog } = require('../models');
const { setControlService } = require('./mqttService');

/**
 * 명령 실행
 * 터치패널 또는 원격(웹) 명령을 수신하여 시스템 상태를 변경
 * @param {object} command - { type, source, valveNumber, action, ... }
 * @returns {boolean} 성공 여부
 */
function executeCommand(command) {
  try {
    const { type, source } = command;
    console.log(`명령 실행: ${type} (출처: ${source})`);

    switch (type) {
      case 'EMERGENCY_STOP':
        // 긴급 정지: 모든 장비 정지 및 긴급 상태 전환
        SystemConfig.update({
          emergency_stop: 1,
          operating_state: 'EMERGENCY',
          irrigation_pump: 0,
          drain_pump: 0,
          mixer_motor: 0,
        });
        AlarmLog.insert({
          alarm_type: 'EMERGENCY_STOP',
          message: `긴급 정지 실행 (출처: ${source})`,
        });
        break;

      case 'START':
        // 시스템 시작: 운전 상태를 RUNNING으로 전환
        SystemConfig.update({
          operating_state: 'RUNNING',
          emergency_stop: 0,
        });
        break;

      case 'STOP':
        // 시스템 정지: 모든 장비 정지 및 STOPPED 상태 전환
        SystemConfig.update({
          operating_state: 'STOPPED',
          irrigation_pump: 0,
          drain_pump: 0,
          mixer_motor: 0,
        });
        break;

      case 'MANUAL':
        // 수동 제어 명령 처리
        handleManualCommand(command);
        break;

      case 'UPDATE_PROGRAM':
        // 프로그램 업데이트는 mqttService에서 직접 처리
        break;

      default:
        console.warn(`알 수 없는 명령: ${type}`);
        return false;
    }

    return true;
  } catch (error) {
    console.error('명령 실행 오류:', error);
    return false;
  }
}

/**
 * 수동 제어 명령 처리
 * 밸브 열기/닫기, 펌프 가동/정지 등 개별 장비 제어
 * @param {object} command - { action, valveNumber, ... }
 */
function handleManualCommand(command) {
  try {
    const { action, valveNumber } = command;

    switch (action) {
      case 'valve_on':
        // 실제 하드웨어 제어는 Node-RED에서 수행
        console.log(`밸브 ${valveNumber} 열기`);
        break;
      case 'valve_off':
        console.log(`밸브 ${valveNumber} 닫기`);
        break;
      case 'pump_on':
        SystemConfig.update({ irrigation_pump: 1 });
        break;
      case 'pump_off':
        SystemConfig.update({ irrigation_pump: 0 });
        break;
      default:
        console.warn(`알 수 없는 수동 명령: ${action}`);
    }
  } catch (error) {
    console.error('수동 제어 명령 처리 오류:', error);
  }
}

// mqttService에 제어 서비스 등록
setControlService({ executeCommand });

module.exports = { executeCommand };
