/**
 * 제어 API 클라이언트
 *
 * 제어 경로 (이중화):
 * 1. AWS: Frontend → API Gateway → Lambda → IoT Core MQTT → RPi
 * 2. 로컬: Frontend → RPi Node-RED REST API → GPIO 직접 제어
 *
 * 모드별 동작:
 * - 온라인: AWS 우선, 실패 시 로컬 폴백
 * - 오프라인/로컬: 로컬 제어 직접 사용 (AWS 건너뜀)
 */

import axios from 'axios';
import { getSystemMode, getApiBase, getRpiApiBase } from './apiSwitcher';

const AWS_CONTROL_ENDPOINT = import.meta.env.VITE_AWS_CONTROL_ENDPOINT;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const TIMEOUT = 10000;
const RETRY_ATTEMPTS = 2;

/**
 * 제어 명령 전송 + 이력 자동 저장
 * 모드에 따라 AWS 또는 로컬 경로를 자동 선택
 *
 * @param {string} houseId - 제어용 하우스 ID (예: 'house1')
 * @param {string} deviceId - 장치 ID (예: 'window1', 'fan1')
 * @param {string} command - 명령 ('open','stop','close','on','off')
 * @param {string} operator - 조작자 식별자
 * @param {object} meta - 추가 메타 정보 { farmId, originalHouseId, deviceType, deviceName, operatorName }
 */
export const sendControlCommand = async (houseId, deviceId, command, operator = 'web_dashboard', meta = {}) => {
  const mode = getSystemMode();

  // 팜로컬 모드 → RPi 로컬 제어 직접 사용 (현장 터치패널, 인터넷 없음)
  if (mode.isFarmLocal) {
    console.log(`🎮 팜로컬 제어: ${houseId}/${deviceId} ${command.toUpperCase()}`);
    const result = await sendLocalControl(houseId, deviceId, command, operator, meta);

    // PC 서버 온라인이면 이력 저장 (비동기)
    if (result.success && mode.serverOnline) {
      saveControlLog({
        farmId: meta.farmId,
        houseId: meta.originalHouseId || houseId,
        controlHouseId: houseId,
        deviceId,
        deviceType: meta.deviceType || guessDeviceType(deviceId),
        deviceName: meta.deviceName || deviceId,
        command,
        success: true,
        operator,
        operatorName: meta.operatorName || null,
      });
    }
    return result;
  }

  // 일반 모드 → AWS 우선, 실패 시 로컬 폴백 (서버 상태 무관)
  const result = await sendAwsControl(houseId, deviceId, command, operator, meta);

  if (!result.success) {
    console.log(`⚠️ AWS 제어 실패, 로컬 폴백 시도...`);
    const localResult = await sendLocalControl(houseId, deviceId, command, operator, meta);
    if (localResult.success) {
      localResult.fallback = true; // 폴백으로 성공했음을 표시
      saveControlLog({
        farmId: meta.farmId,
        houseId: meta.originalHouseId || houseId,
        controlHouseId: houseId,
        deviceId,
        deviceType: meta.deviceType || guessDeviceType(deviceId),
        deviceName: meta.deviceName || deviceId,
        command,
        success: true,
        operator,
        operatorName: meta.operatorName || null,
      });
      return localResult;
    }
    // 로컬도 실패하면 AWS 결과 반환
  }

  // 이력 자동 저장 (서버 온라인 시만, 비동기)
  if (result.success) {
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
      requestId: result.requestId,
      operator,
      operatorName: meta.operatorName || null,
      lambdaResponse: result.lambdaResponse || null,
    });
  }

  return result;
};

/**
 * AWS IoT Core를 통한 제어
 */
const sendAwsControl = async (houseId, deviceId, command, operator, meta = {}) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  const timestamp = new Date().toISOString();

  const payload = {
    house_id: houseId,
    window_id: deviceId,
    command: command.toLowerCase(),
    operator,
    request_id: requestId,
    timestamp,
    modbus: meta.modbus || null,
    duration: meta.duration || 0,
    // 자동 OFF 예약 — schedule-off 명령일 때 NR 가 setTimeout 등록
    ...(meta.delaySec ? { delay_sec: meta.delaySec } : {}),
    // 100농장 표준화: farm_id 추가 → Lambda 가 새 토픽 smartfarm/{farm_id}/{house_id}/{window_id}/control 도 publish
    // (옛 토픽 smartfarm/{house_id}/{window_id}/control 도 호환 유지)
    ...(meta.farmId ? { farm_id: meta.farmId } : {}),
  };

  if (!AWS_CONTROL_ENDPOINT) {
    return { success: false, requestId, houseId, deviceId, command, error: 'AWS 엔드포인트 미설정', timestamp, mode: 'aws' };
  }

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      // 보안: Lambda Authorizer 가 JWT 검증 → token 의 farmId 와 payload.farm_id 일치 검증
      const token = localStorage.getItem('accessToken');
      const response = await axios.post(AWS_CONTROL_ENDPOINT, payload, {
        timeout: TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const lambdaResult = data.body ? (typeof data.body === 'string' ? JSON.parse(data.body) : data.body) : data;

      console.log(`✅ AWS 제어 성공:`, lambdaResult);

      return {
        success: true,
        requestId,
        houseId,
        deviceId,
        command,
        timestamp,
        lambdaResponse: lambdaResult,
        mode: 'aws',
      };
    } catch (error) {
      console.error(`❌ AWS 제어 실패 (${attempt}/${RETRY_ATTEMPTS}):`, error.message);
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  return {
    success: false,
    requestId,
    houseId,
    deviceId,
    command,
    error: 'AWS 제어 실패',
    timestamp,
    mode: 'aws',
  };
};

/**
 * RPi 로컬 REST API를 통한 직접 제어
 */
const sendLocalControl = async (houseId, deviceId, command, operator, meta = {}) => {
  const timestamp = new Date().toISOString();

  try {
    const controlUrl = getRpiApiBase() + '/control/local';
    const response = await axios.post(controlUrl, {
      house_id: houseId,
      device_id: deviceId,
      command: command.toLowerCase(),
      operator: operator || 'local_dashboard',
      // 자동 OFF 예약 — schedule-off 명령일 때 사용
      ...(meta.delaySec ? { delay_sec: meta.delaySec } : {}),
    }, {
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });

    const data = response.data;

    if (data.success) {
      console.log(`✅ 로컬 제어 성공:`, data.data);
      return {
        success: true,
        requestId: data.data.request_id,
        houseId,
        deviceId,
        command,
        timestamp: data.data.executed_at || timestamp,
        mode: 'local',
      };
    }

    return {
      success: false,
      houseId,
      deviceId,
      command,
      error: data.error || '로컬 제어 실패',
      timestamp,
      mode: 'local',
    };
  } catch (error) {
    console.error(`❌ 로컬 제어 실패:`, error.message);
    return {
      success: false,
      houseId,
      deviceId,
      command,
      error: `로컬 제어 실패: ${error.message}`,
      timestamp,
      mode: 'local',
    };
  }
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
export const saveControlLog = async (logData) => {
  try {
    await axios.post(`${API_BASE_URL}/control-logs`, logData, { timeout: 5000 });
    console.log(`📝 이력 저장 완료: ${logData.deviceId} ${logData.command}`);
  } catch (error) {
    console.warn('⚠️ 이력 저장 실패 (무시):', error.message);
  }
};

/**
 * 제어 이력 조회
 * 팜로컬/오프라인 모드: 빈 결과 + 안내 메시지 (PC API 호출 시도조차 안 함 → 네트워크 노이즈 제거)
 */
export const getControlLogs = async (farmId, options = {}) => {
  const mode = getSystemMode();
  if (mode.isFarmLocal || !mode.serverOnline) {
    return {
      success: true,
      data: [],
      pagination: { total: 0 },
      offline: true,
      message: mode.isFarmLocal ? '팜로컬 모드 — 이력은 서버 연동 시에만 표시' : '서버 연결 끊김',
    };
  }
  try {
    const params = new URLSearchParams();
    if (options.houseId) params.set('houseId', options.houseId);
    if (options.deviceId) params.set('deviceId', options.deviceId);
    if (options.deviceType) params.set('deviceType', options.deviceType);
    if (options.limit) params.set('limit', options.limit);
    if (options.page) params.set('page', options.page);

    const response = await axios.get(`${API_BASE_URL}/control-logs/${farmId}?${params.toString()}`, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error('이력 조회 실패:', error.message);
    return { success: false, data: [], pagination: {} };
  }
};

/**
 * 제어 통계 조회
 * 팜로컬/오프라인: 빈 결과 + 안내
 */
export const getControlStats = async (farmId, options = {}) => {
  const mode = getSystemMode();
  if (mode.isFarmLocal || !mode.serverOnline) {
    return {
      success: true,
      data: {},
      offline: true,
      message: mode.isFarmLocal ? '팜로컬 모드 — 통계는 서버 연동 시에만 표시' : '서버 연결 끊김',
    };
  }
  try {
    const params = new URLSearchParams();
    if (options.houseId) params.set('houseId', options.houseId);
    if (options.period) params.set('period', options.period);

    const response = await axios.get(`${API_BASE_URL}/control-logs/${farmId}/stats?${params.toString()}`, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error('통계 조회 실패:', error.message);
    return { success: false, data: {} };
  }
};

/**
 * 릴레이 실제 상태 조회 (Modbus FC1 Read Coils)
 * RPi Node-RED를 통해 실제 릴레이 코일 상태를 읽어옴
 *
 * @param {number} unitId - Modbus Unit ID (기본 1)
 * @param {number} quantity - 읽을 코일 수 (기본 8)
 * @returns {{ success: boolean, data?: { unitId, coils: {[ch]: boolean}, raw: boolean[], timestamp } }}
 */
export const getRelayStatus = async (unitId = 1, quantity = 8) => {
  try {
    const rpiBase = getRpiApiBase();
    const res = await axios.get(`${rpiBase}/relay/status`, {
      params: { unitId, quantity },
      timeout: 5000,
    });
    return res.data;
  } catch (error) {
    console.warn('릴레이 상태 조회 실패:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * 릴레이 상태 조회 - Eletechsup (Modbus FC03 Read Holding Registers)
 * 레지스터 값을 비트맵으로 해석하여 coils 형태로 반환
 */
export const getRelayRegStatus = async (unitId = 2, register = 0, quantity = 1) => {
  try {
    const rpiBase = getRpiApiBase();
    const res = await axios.get(`${rpiBase}/relay/reg-status`, {
      params: { unitId, register, quantity },
      timeout: 5000,
    });
    return res.data;
  } catch (error) {
    console.warn('레지스터 상태 조회 실패:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Lambda 워밍업 (콜드 스타트 방지)
 * 빈 ping 요청으로 Lambda 컨테이너를 미리 깨움
 */
export const warmupLambda = async () => {
  if (!AWS_CONTROL_ENDPOINT) return;
  try {
    await axios.post(AWS_CONTROL_ENDPOINT, {
      command: 'ping',
      house_id: 'warmup',
      window_id: 'warmup',
      operator: 'warmup',
      request_id: 'warmup',
    }, { timeout: 10000, headers: { 'Content-Type': 'application/json' } });
    console.log('🔥 Lambda 워밍업 완료');
  } catch (e) {
    // 워밍업 실패는 무시
  }
};

/**
 * Waveshare 릴레이 코일 직접 쓰기 (Modbus FC15 Write Multiple Coils)
 * 채널 테스트용 — 특정 코일을 ON/OFF
 */
export const writeRelayCoil = async (unitId = 1, address = 0, value = false) => {
  try {
    const rpiBase = getRpiApiBase();
    const res = await axios.post(`${rpiBase}/relay/coil-write`, { unitId, address, value }, { timeout: 5000 });
    return res.data;
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Eletechsup 릴레이 레지스터 쓰기 (Modbus FC06 Write Single Register)
 * 채널 테스트용 — 특정 채널 ON/OFF
 */
export const writeRelayRegister = async (unitId = 2, register = 1, value = 256) => {
  try {
    const rpiBase = getRpiApiBase();
    const res = await axios.post(`${rpiBase}/relay/reg-write`, { unitId, register, value }, { timeout: 5000 });
    return res.data;
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export default {
  sendControlCommand,
  getControlLogs,
  getControlStats,
  getRelayStatus,
  getRelayRegStatus,
  writeRelayCoil,
  writeRelayRegister,
  warmupLambda,
};
