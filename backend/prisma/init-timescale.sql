-- prisma/init-timescale.sql
-- TimescaleDB 시계열 테이블 + 연속 집계 뷰
-- Prisma migrate 후 수동 실행: psql -U smartfarm -d smartfarm_db -f init-timescale.sql

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TimescaleDB 확장 활성화
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 센서 데이터 (시계열)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS sensor_data (
  timestamp      TIMESTAMPTZ    NOT NULL,
  farm_id        TEXT           NOT NULL,
  house_id       TEXT           NOT NULL,
  data           JSONB          NOT NULL DEFAULT '{}',
  metadata       JSONB          DEFAULT '{}',
  PRIMARY KEY (timestamp, farm_id, house_id)
);

-- 하이퍼테이블 변환 (7일 파티션)
SELECT create_hypertable('sensor_data', 'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sensor_data_farm_house
  ON sensor_data (farm_id, house_id, timestamp DESC);

-- 압축 정책 (7일 이후 자동 압축)
ALTER TABLE sensor_data SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'farm_id, house_id',
  timescaledb.compress_orderby = 'timestamp DESC'
);

SELECT add_compression_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 제어 이력 (시계열)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS control_logs (
  id                  TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  timestamp           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  farm_id             TEXT           NOT NULL,
  house_id            TEXT           NOT NULL,
  control_house_id    TEXT,
  device_id           TEXT           NOT NULL,
  device_type         TEXT           DEFAULT 'unknown',
  device_name         TEXT,
  command             TEXT           NOT NULL,
  success             BOOLEAN        NOT NULL DEFAULT TRUE,
  error               TEXT,
  request_id          TEXT,
  operator            TEXT           DEFAULT 'web_dashboard',
  operator_name       TEXT,
  lambda_response     JSONB,
  is_automatic        BOOLEAN        DEFAULT FALSE,
  automation_rule_id  TEXT,
  automation_reason   TEXT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (timestamp, id)
);

-- 하이퍼테이블 변환 (30일 파티션)
SELECT create_hypertable('control_logs', 'timestamp',
  chunk_time_interval => INTERVAL '30 days',
  if_not_exists => TRUE
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_control_logs_farm_house
  ON control_logs (farm_id, house_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_control_logs_farm_device
  ON control_logs (farm_id, device_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_control_logs_request_id
  ON control_logs (request_id);

-- 압축 정책 (30일 이후)
ALTER TABLE control_logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'farm_id, house_id',
  timescaledb.compress_orderby = 'timestamp DESC'
);

SELECT add_compression_policy('control_logs', INTERVAL '30 days', if_not_exists => TRUE);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 알림 이력 (시계열)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS alerts (
  id             TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  timestamp      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  farm_id        TEXT           NOT NULL,
  house_id       TEXT           NOT NULL,
  sensor_id      TEXT,
  alert_type     TEXT           NOT NULL, -- HIGH, LOW
  severity       TEXT           DEFAULT 'WARNING', -- WARNING, CRITICAL
  message        TEXT,
  value          DOUBLE PRECISION,
  threshold      DOUBLE PRECISION,
  metadata       JSONB          DEFAULT '{}',
  acknowledged   BOOLEAN        DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (timestamp, id)
);

SELECT create_hypertable('alerts', 'timestamp',
  chunk_time_interval => INTERVAL '30 days',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_alerts_farm_house
  ON alerts (farm_id, house_id, timestamp DESC);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 연속 집계 뷰 (자동 갱신)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 시간별 센서 통계는 JSONB 내부 키별로 집계하기 어려우므로
-- 필요 시 애플리케이션 레벨에서 처리하거나,
-- 센서 데이터 구조 변경 후 추가 가능


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 초기화 완료 메시지
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$
BEGIN
  RAISE NOTICE '✅ TimescaleDB 시계열 테이블 초기화 완료';
END $$;
