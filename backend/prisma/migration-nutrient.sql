-- Phase 2 — 양액 관리 (Nutrient Management) 테이블
-- 6개 테이블: nutrient_scenarios, nutrient_configs, nutrient_alerts,
--           nutrient_calibrations, nutrient_counters, nutrient_states
--
-- 적용:
--   psql -d smartfarm_db -f prisma/migration-nutrient.sql
-- 또는 운영 DB:
--   psql -h 192.168.219.114 -U afocus -d smartfarm_db -f prisma/migration-nutrient.sql

BEGIN;

-- 1. 시나리오 (생장기/개화기 등)
CREATE TABLE IF NOT EXISTS nutrient_scenarios (
  id               TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  farm_id          TEXT NOT NULL,
  name             TEXT NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT false,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  ec_target        DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  ph_target        DOUBLE PRECISION NOT NULL DEFAULT 6.0,
  dosing_ratio     JSONB NOT NULL DEFAULT '{}'::jsonb,
  irrigation_mode  TEXT NOT NULL DEFAULT 'timer',
  solar_threshold  DOUBLE PRECISION,
  timer_interval   TEXT,
  timer_start      TEXT,
  timer_end        TEXT,
  schedule_slots   JSONB NOT NULL DEFAULT '[]'::jsonb,
  days             INTEGER[] NOT NULL DEFAULT '{}',
  valves           JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nutrient_scenarios_active ON nutrient_scenarios (farm_id, active);
CREATE INDEX IF NOT EXISTS idx_nutrient_scenarios_order  ON nutrient_scenarios (farm_id, sort_order);

-- 2. 농장별 단일 설정 (탱크 / 밸브수 / 경보한계 / 하드웨어)
CREATE TABLE IF NOT EXISTS nutrient_configs (
  farm_id      TEXT PRIMARY KEY,
  tanks        JSONB NOT NULL DEFAULT '[]'::jsonb,
  valve_count  INTEGER NOT NULL DEFAULT 0,
  alerts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  hardware     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. 경보 이력 (append-only)
CREATE TABLE IF NOT EXISTS nutrient_alerts (
  id           TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  farm_id      TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'warning',
  value        DOUBLE PRECISION,
  threshold    DOUBLE PRECISION,
  message      TEXT NOT NULL,
  action       TEXT,
  resolved     BOOLEAN NOT NULL DEFAULT false,
  resolved_at  TIMESTAMPTZ(6),
  resolved_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_nutrient_alerts_time     ON nutrient_alerts (farm_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_nutrient_alerts_resolved ON nutrient_alerts (farm_id, resolved, occurred_at DESC);

-- 4. 센서 보정 이력 (EC 1-pt, pH 3-pt)
CREATE TABLE IF NOT EXISTS nutrient_calibrations (
  id              TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  farm_id         TEXT NOT NULL,
  sensor_type     TEXT NOT NULL,
  calibrated_at   TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  standard_value  DOUBLE PRECISION,
  measured_value  DOUBLE PRECISION,
  "offset"        DOUBLE PRECISION,
  slope           DOUBLE PRECISION,
  points          JSONB NOT NULL DEFAULT '[]'::jsonb,
  performed_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_nutrient_cal_history ON nutrient_calibrations (farm_id, sensor_type, calibrated_at DESC);

-- 5. 누적 카운터 (농장당 1 row)
CREATE TABLE IF NOT EXISTS nutrient_counters (
  farm_id            TEXT PRIMARY KEY,
  total_dose_l       DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_irrigation_l DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_cycles       INTEGER NOT NULL DEFAULT 0,
  pump_runtime_min   INTEGER NOT NULL DEFAULT 0,
  filter_change_at   DATE,
  last_reset_at      TIMESTAMPTZ(6),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 6. 운영 상태 (mode + 1-cycle 정보)
CREATE TABLE IF NOT EXISTS nutrient_states (
  farm_id            TEXT PRIMARY KEY,
  mode               TEXT NOT NULL DEFAULT 'paused',
  active_scenario_id TEXT,
  current_cycle      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ec_current         DOUBLE PRECISION,
  ph_current         DOUBLE PRECISION,
  solar_accumulated  DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMIT;
