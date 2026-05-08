/**
 * SQLite 데이터베이스 초기화 스크립트
 * better-sqlite3 동기 API를 사용하여 스마트팜 데이터베이스를 생성하고 초기화한다.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 상위 디렉토리의 .env 파일 로드
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 데이터베이스 파일 경로 설정 (환경변수 또는 기본값 사용)
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'smartfarm.db');

// 데이터베이스 디렉토리가 없으면 생성
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// better-sqlite3 데이터베이스 인스턴스 생성
const db = new Database(dbPath);

// WAL 모드 활성화 (동시 읽기 성능 향상)
db.pragma('journal_mode = WAL');

// ──────────────────────────────────────────────
// 테이블 생성
// ──────────────────────────────────────────────

// 시스템 전역 설정 테이블 (1행만 유지)
db.exec(`
  CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    operating_state TEXT DEFAULT 'STOPPED',
    current_program INTEGER DEFAULT 0,
    emergency_stop INTEGER DEFAULT 0,
    irrigation_pump INTEGER DEFAULT 0,
    drain_pump INTEGER DEFAULT 0,
    mixer_motor INTEGER DEFAULT 0,
    supply_flow REAL DEFAULT 0,
    drain_flow REAL DEFAULT 0,
    daily_total_supply REAL DEFAULT 0,
    daily_total_drain REAL DEFAULT 0,
    outdoor_temp REAL DEFAULT 0,
    indoor_temp REAL DEFAULT 0,
    substrate_temp REAL DEFAULT 0,
    current_ec REAL DEFAULT 0,
    current_ph REAL DEFAULT 0,
    set_ec REAL DEFAULT 2.0,
    set_ph REAL DEFAULT 5.8,
    solar_radiation REAL DEFAULT 0,
    co2_level REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// HydroControl PRO UI 추가 센서 컬럼 (기존 DB 호환)
const addColumn = (table, col, type, def) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} DEFAULT ${def}`); }
  catch (e) { /* 이미 존재하면 무시 */ }
};
addColumn('system_config', 'co2_level', 'REAL', '0');
addColumn('system_config', 'drain_ec', 'REAL', '0');
addColumn('system_config', 'drain_ph', 'REAL', '0');
addColumn('system_config', 'humidity', 'REAL', '0');
addColumn('system_config', 'water_temp', 'REAL', '0');
addColumn('system_config', 'dissolved_oxygen', 'REAL', '0');
addColumn('system_config', 'current_valve', 'INTEGER', '0');
addColumn('system_config', 'raw_water_pump', 'INTEGER', '0');

// 경보 임계값 컬럼
addColumn('system_config', 'alarm_ec_upper', 'REAL', '3.5');
addColumn('system_config', 'alarm_ec_lower', 'REAL', '0.3');
addColumn('system_config', 'alarm_ph_upper', 'REAL', '8.5');
addColumn('system_config', 'alarm_ph_lower', 'REAL', '4.5');
addColumn('system_config', 'alarm_temp_upper', 'REAL', '40');
addColumn('system_config', 'alarm_temp_lower', 'REAL', '5');

// 관수 프로그램 테이블 (6개 프로그램)
db.exec(`
  CREATE TABLE IF NOT EXISTS irrigation_program (
    id INTEGER PRIMARY KEY,
    program_number INTEGER UNIQUE NOT NULL,
    is_active INTEGER DEFAULT 0,
    trigger_type TEXT DEFAULT 'solar',
    solar_threshold REAL DEFAULT 100,
    interval_minutes INTEGER DEFAULT 60,
    schedule_times TEXT DEFAULT '[]',
    set_ec REAL DEFAULT 2.0,
    set_ph REAL DEFAULT 5.8,
    tank_a_ratio REAL DEFAULT 1.0,
    tank_b_ratio REAL DEFAULT 1.0,
    tank_c_ratio REAL DEFAULT 0,
    tank_d_ratio REAL DEFAULT 0,
    tank_e_ratio REAL DEFAULT 0,
    tank_f_ratio REAL DEFAULT 0,
    acid_ratio REAL DEFAULT 0.5,
    day_of_week TEXT DEFAULT '1111111',
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 밸브 설정 테이블 (6 프로그램 x 14 밸브 = 84행)
db.exec(`
  CREATE TABLE IF NOT EXISTS valve_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES irrigation_program(id),
    valve_number INTEGER NOT NULL,
    is_active INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 300,
    flow_target_liters REAL DEFAULT 0,
    UNIQUE(program_id, valve_number)
  );
`);

// 시계열 센서 데이터 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS sensor_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    ec REAL,
    ph REAL,
    outdoor_temp REAL,
    indoor_temp REAL,
    substrate_temp REAL,
    solar_radiation REAL,
    supply_flow REAL,
    drain_flow REAL,
    co2_level REAL
  );
  CREATE INDEX IF NOT EXISTS idx_sensor_time ON sensor_data(recorded_at);
`);

// sensor_data 추가 컬럼
addColumn('sensor_data', 'drain_ec', 'REAL', 'NULL');
addColumn('sensor_data', 'drain_ph', 'REAL', 'NULL');
addColumn('sensor_data', 'humidity', 'REAL', 'NULL');
addColumn('sensor_data', 'water_temp', 'REAL', 'NULL');
addColumn('sensor_data', 'dissolved_oxygen', 'REAL', 'NULL');

// 일일 요약 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summary_date TEXT NOT NULL,
    program_number INTEGER NOT NULL,
    run_count INTEGER DEFAULT 0,
    set_ec REAL,
    set_ph REAL,
    avg_ec REAL,
    avg_ph REAL,
    total_supply_liters REAL DEFAULT 0,
    total_drain_liters REAL DEFAULT 0,
    UNIQUE(summary_date, program_number)
  );
`);

// 일일 밸브별 유량 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS daily_valve_flow (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summary_date TEXT NOT NULL,
    program_number INTEGER NOT NULL,
    valve_number INTEGER NOT NULL,
    total_flow_liters REAL DEFAULT 0,
    run_count INTEGER DEFAULT 0,
    UNIQUE(summary_date, program_number, valve_number)
  );
`);

// 알람 로그 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS alarm_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    alarm_type TEXT NOT NULL,
    alarm_value REAL,
    threshold_value REAL,
    resolved_at TEXT,
    message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alarm_time ON alarm_log(occurred_at);
`);

// 로컬 인증용 사용자 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS local_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL DEFAULT 'admin',
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// ──────────────────────────────────────────────
// 기본 데이터 삽입
// ──────────────────────────────────────────────

// 시스템 설정 기본 행 삽입 (id=1, 이미 존재하면 무시)
db.prepare('INSERT OR IGNORE INTO system_config (id) VALUES (1)').run();

// 관수 프로그램 6개 기본 삽입
const insertProgram = db.prepare(
  'INSERT OR IGNORE INTO irrigation_program (program_number) VALUES (@program_number)'
);
const insertProgramsTransaction = db.transaction(() => {
  for (let i = 1; i <= 6; i++) {
    insertProgram.run({ program_number: i });
  }
});
insertProgramsTransaction();

// 밸브 설정 84행 기본 삽입 (6 프로그램 x 14 밸브)
const insertValve = db.prepare(
  'INSERT OR IGNORE INTO valve_config (program_id, valve_number) VALUES (@program_id, @valve_number)'
);
const insertValvesTransaction = db.transaction(() => {
  // 프로그램 ID 목록 조회
  const programs = db.prepare('SELECT id FROM irrigation_program ORDER BY program_number').all();
  for (const program of programs) {
    for (let v = 1; v <= 14; v++) {
      insertValve.run({ program_id: program.id, valve_number: v });
    }
  }
});
insertValvesTransaction();

// 기본 관리자 계정 삽입 (비밀번호: admin1234)
db.prepare(
  `INSERT OR IGNORE INTO local_users (username, password_hash)
   VALUES ('admin', '$2b$10$fhbKs45HaR8baHC8OtLmZ.QLVjvSPO4Af3ahX6Nmu0nTqZc.7D83G')`
).run();

console.log(`[DB] 스마트팜 데이터베이스 초기화 완료: ${dbPath}`);

module.exports = db;
