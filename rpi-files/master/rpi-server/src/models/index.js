/**
 * 모델 통합 모듈
 * 데이터베이스 인스턴스를 로드하고 모든 모델을 초기화하여 내보낸다.
 */

const db = require('../../database/init');

const SystemConfig = require('./SystemConfig')(db);
const IrrigationProgram = require('./IrrigationProgram')(db);
const ValveConfig = require('./ValveConfig')(db);
const SensorData = require('./SensorData')(db);
const DailySummary = require('./DailySummary')(db);
const DailyValveFlow = require('./DailyValveFlow')(db);
const AlarmLog = require('./AlarmLog')(db);
const LocalUser = require('./LocalUser')(db);

module.exports = {
  db,
  SystemConfig,
  IrrigationProgram,
  ValveConfig,
  SensorData,
  DailySummary,
  DailyValveFlow,
  AlarmLog,
  LocalUser,
};
