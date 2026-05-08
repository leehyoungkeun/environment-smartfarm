/**
 * 내부 API 라우트 (Node-RED용)
 * localhost에서만 접근 가능 (localOnly 미들웨어 적용)
 * 센서 데이터 수신, 상태 업데이트, 경보 등록, 설정/프로그램 조회
 */
const router = require('express').Router();
const { SensorData, SystemConfig, AlarmLog, IrrigationProgram, ValveConfig, DailySummary, DailyValveFlow } = require('../models');
const sensorCache = require('../services/sensorCache');
const alarmService = require('../services/alarmService');

/**
 * POST /internal/sensor-update
 * Node-RED에서 수집된 센서 데이터 수신 및 저장
 */
router.post('/sensor-update', (req, res) => {
  try {
    const sensorData = req.body;

    // 센서 데이터 DB에 저장
    SensorData.insert(sensorData);

    // 센서 캐시 업데이트 (WebSocket 실시간 전송용)
    sensorCache.update(sensorData);

    // 시스템 설정에 현재 센서 값 반영
    const configUpdate = {
      current_ec: sensorData.ec,
      current_ph: sensorData.ph,
      outdoor_temp: sensorData.outdoor_temp,
      indoor_temp: sensorData.indoor_temp,
      substrate_temp: sensorData.substrate_temp,
      solar_radiation: sensorData.solar_radiation,
      supply_flow: sensorData.supply_flow,
      drain_flow: sensorData.drain_flow,
      co2_level: sensorData.co2_level
    };
    // HydroControl PRO 추가 센서 (연결된 경우에만)
    if (sensorData.drain_ec !== undefined) configUpdate.drain_ec = sensorData.drain_ec;
    if (sensorData.drain_ph !== undefined) configUpdate.drain_ph = sensorData.drain_ph;
    if (sensorData.humidity !== undefined) configUpdate.humidity = sensorData.humidity;
    if (sensorData.water_temp !== undefined) configUpdate.water_temp = sensorData.water_temp;
    if (sensorData.dissolved_oxygen !== undefined) configUpdate.dissolved_oxygen = sensorData.dissolved_oxygen;
    SystemConfig.update(configUpdate);

    // 경보 임계값 확인
    alarmService.checkThresholds(sensorData);

    res.json({ success: true });
  } catch (error) {
    console.error('센서 데이터 수신 중 오류:', error);
    res.status(500).json({ success: false, message: '센서 데이터 수신 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /internal/status-update
 * Node-RED에서 시스템 상태 업데이트 수신
 */
router.post('/status-update', (req, res) => {
  try {
    const data = req.body;
    // Node-RED 필드명을 DB 컬럼명으로 매핑
    const updateFields = {};
    if (data.operating_state !== undefined) updateFields.operating_state = data.operating_state;
    if (data.active_program !== undefined) updateFields.current_program = data.active_program;
    if (data.emergency_stop !== undefined) updateFields.emergency_stop = data.emergency_stop;
    // pump_state 객체를 개별 컬럼으로 분리
    if (data.pump_state) {
      updateFields.irrigation_pump = data.pump_state.nutrient_pump ? 1 : 0;
      updateFields.raw_water_pump = data.pump_state.raw_pump ? 1 : 0;
    }
    if (data.mixer_state !== undefined) updateFields.mixer_motor = data.mixer_state ? 1 : 0;
    if (data.current_valve !== undefined) updateFields.current_valve = data.current_valve;

    if (Object.keys(updateFields).length > 0) {
      SystemConfig.update(updateFields);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('상태 업데이트 수신 중 오류:', error);
    res.status(500).json({ success: false, message: '상태 업데이트 수신 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /internal/alarm
 * Node-RED에서 경보 등록
 */
router.post('/alarm', (req, res) => {
  try {
    const { alarm_type, alarm_value, threshold_value, message } = req.body;

    // 경보 데이터 DB에 저장
    AlarmLog.insert({ alarm_type, alarm_value, threshold_value, message });

    res.json({ success: true });
  } catch (error) {
    console.error('경보 등록 중 오류:', error);
    res.status(500).json({ success: false, message: '경보 등록 중 오류가 발생했습니다.' });
  }
});

/**
 * GET /internal/programs
 * 전체 관수 프로그램 목록 조회 (밸브 설정 포함)
 */
router.get('/programs', (req, res) => {
  try {
    const programs = IrrigationProgram.getAll();

    // 각 프로그램에 밸브 설정 첨부
    const programsWithValves = programs.map(program => ({
      ...program,
      valves: ValveConfig.getByProgram(program.id)
    }));

    res.json({ success: true, data: programsWithValves });
  } catch (error) {
    console.error('프로그램 목록 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '프로그램 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * GET /internal/config
 * 시스템 설정 조회
 */
router.get('/config', (req, res) => {
  try {
    const config = SystemConfig.get();
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('시스템 설정 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '시스템 설정 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * GET /internal/daily-summary-data
 * Node-RED 일일집계용 어제 센서 평균 데이터 조회
 */
router.get('/daily-summary-data', (req, res) => {
  try {
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);
    const from = dateStr + ' 00:00:00';
    const to = dateStr + ' 23:59:59';

    // 어제 센서 데이터 평균 계산
    const avgRow = require('../../database/init').prepare(`
      SELECT
        AVG(ec) as avg_ec,
        AVG(ph) as avg_ph,
        AVG(outdoor_temp) as avg_outdoor_temp,
        AVG(indoor_temp) as avg_indoor_temp,
        AVG(substrate_temp) as avg_substrate_temp,
        AVG(solar_radiation) as avg_solar_radiation,
        AVG(supply_flow) as avg_supply_flow,
        AVG(drain_flow) as avg_drain_flow,
        COUNT(*) as sample_count
      FROM sensor_data
      WHERE recorded_at BETWEEN ? AND ?
    `).get(from, to);

    res.json({ success: true, data: { date: dateStr, sensor_averages: avgRow || {} } });
  } catch (error) {
    console.error('일일집계 데이터 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '일일집계 데이터 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * POST /internal/daily-summary
 * Node-RED에서 집계된 일일 운영 실적 저장
 */
router.post('/daily-summary', (req, res) => {
  try {
    const { date, program_stats, total_flow, total_irrigation_count, sensor_averages } = req.body;
    if (!date) {
      return res.status(400).json({ success: false, message: 'date 필드가 필요합니다.' });
    }

    // 프로그램별 요약 저장
    if (program_stats && Array.isArray(program_stats)) {
      for (const stat of program_stats) {
        DailySummary.upsert({
          summary_date: date,
          program_number: stat.program_id || 0,
          run_count: stat.execution_count || 0,
          set_ec: null,
          set_ph: null,
          avg_ec: sensor_averages ? sensor_averages.avg_ec : null,
          avg_ph: sensor_averages ? sensor_averages.avg_ph : null,
          total_supply_liters: stat.total_flow || 0,
          total_drain_liters: 0,
        });
      }
    }

    res.json({ success: true, message: '일일집계 저장 완료' });
  } catch (error) {
    console.error('일일집계 저장 중 오류:', error);
    res.status(500).json({ success: false, message: '일일집계 저장 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
