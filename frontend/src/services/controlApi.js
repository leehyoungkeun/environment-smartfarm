/**
 * 제어 API 클라이언트
 *
 * 1. AWS API Gateway → Lambda → AWS IoT → 라즈베리파이 제어
 * 2. 제어 후 자동으로 DB에 이력 저장
 */

import axios from 'axios';

const AWS_CONTROL_ENDPOINT = import.meta.env.VITE_AWS_CONTROL_ENDPOINT;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const TIMEOUT = 10000;
const RETRY_ATTEMPTS = 2;

/**
 * 제어 명령 전송 + 이력 자동 저장
 * 
 * @param {string} houseId - 제어용 하우스 ID (예: 'house1')
 * @param {string} deviceId - 장치 ID (예: 'window1', 'fan1')
 * @param {string} command - 명령 ('open','stop','close','on','off')
 * @param {string} operator - 조작자 식별자
 * @param {object} meta - 추가 메타 정보 { farmId, originalHouseId, deviceType, deviceName, operatorName }
 */
export const sendControlCommand = async (houseId, deviceId, command, operator = 'web_dashboard', meta = {}) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  const timestamp = new Date().toISOString();

  const payload = {
    house_id: houseId,
    window_id: deviceId,
    command: command.toLowerCase(),
    operator,
    request_id: requestId,
    timestamp,
  };

  console.log(`🎛️ 제어 명령 전송: ${houseId}/${deviceId} ${command.toUpperCase()}`);

  if (!AWS_CONTROL_ENDPOINT) {
    console.error('❌ VITE_AWS_CONTROL_ENDPOINT 환경변수가 설정되지 않았습니다.');
    return { success: false, requestId, houseId, deviceId, command, error: 'AWS 제어 엔드포인트 미설정', timestamp };
  }

  let result;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(AWS_CONTROL_ENDPOINT, payload, {
        timeout: TIMEOUT,
        headers: { 'Content-Type': 'application/json' },
      });

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const lambdaResult = data.body ? (typeof data.body === 'string' ? JSON.parse(data.body) : data.body) : data;

      console.log(`✅ 제어 명령 전송 성공:`, lambdaResult);

      result = {
        success: true,
        requestId,
        houseId,
        deviceId,
        command,
        timestamp,
        lambdaResponse: lambdaResult,
      };
      break;

    } catch (error) {
      console.error(`❌ 제어 명령 실패 (시도 ${attempt}/${RETRY_ATTEMPTS}):`, error.message);
      if (attempt === RETRY_ATTEMPTS) {
        result = {
          success: false,
          requestId,
          houseId,
          deviceId,
          command,
          error: error.message,
          timestamp,
        };
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  // 이력 자동 저장 (비동기, 실패해도 무시)
  saveControlLog({
    farmId: meta.farmId,
    houseId: meta.originalHouseId || houseId,
    controlHouseId: houseId,
    deviceId,
    deviceType: meta.deviceType || guessDeviceType(deviceId),
    deviceName: meta.deviceName || deviceId,
    command,
    success: result.success,
    error: result.error || null,
    requestId,
    operator,
    operatorName: meta.operatorName || null,
    lambdaResponse: result.lambdaResponse || null,
  });

  return result;
};

/**
 * 장치 ID로 유형 추측
 */
const guessDeviceType = (deviceId) => {
  if (deviceId.startsWith('window')) return 'window';
  if (deviceId.startsWith('fan')) return 'fan';
  if (deviceId.startsWith('heater')) return 'heater';
  if (deviceId.startsWith('valve')) return 'valve';
  return 'unknown';
};

/**
 * 제어 이력 저장 (SmartFarm 백엔드 → TimescaleDB)
 */
const saveControlLog = async (logData) => {
  try {
    await axios.post(`${API_BASE_URL}/control-logs`, logData, { timeout: 5000 });
    console.log(`📝 이력 저장 완료: ${logData.deviceId} ${logData.command}`);
  } catch (error) {
    console.warn('⚠️ 이력 저장 실패 (무시):', error.message);
  }
};

/**
 * 제어 이력 조회
 */
export const getControlLogs = async (farmId, options = {}) => {
  try {
    const params = new URLSearchParams();
    if (options.houseId) params.set('houseId', options.houseId);
    if (options.deviceId) params.set('deviceId', options.deviceId);
    if (options.deviceType) params.set('deviceType', options.deviceType);
    if (options.limit) params.set('limit', options.limit);
    if (options.page) params.set('page', options.page);

    const response = await axios.get(`${API_BASE_URL}/control-logs/${farmId}?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('이력 조회 실패:', error.message);
    return { success: false, data: [], pagination: {} };
  }
};

/**
 * 제어 통계 조회
 */
export const getControlStats = async (farmId, options = {}) => {
  try {
    const params = new URLSearchParams();
    if (options.houseId) params.set('houseId', options.houseId);
    if (options.period) params.set('period', options.period);

    const response = await axios.get(`${API_BASE_URL}/control-logs/${farmId}/stats?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error('통계 조회 실패:', error.message);
    return { success: false, data: {} };
  }
};

export default {
  sendControlCommand,
  getControlLogs,
  getControlStats,
};
