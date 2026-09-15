-- ks_sensor_status — 표준(KS X 3267) 센서 노드의 1분 관측치·상태코드 스냅샷
-- 2026-09-15 신설. SPS-7466 §5.4.4 c) "관측치가 저장주기대로", d) "센서 상태가 저장주기대로" + KOAT 116 센서 상태정보 저장.
--
-- 왜 sensor_data 와 따로 두나: 운영 파이프라인(sensor_data)은 상태 101~103(점검 필요) 인 값을 일부러 생략한다(자동화·경보가
-- 믿을 수 없는 값을 쓰지 않도록). 표준 시험은 상태가 무엇이든 관측치와 상태를 매 저장주기마다 남겨야 하므로 별도 표에 전부 기록한다.
-- 생산: ks3267d → NR(표준 상태 반영, global.ks3267State) → NR 1분 스냅샷(sensorRows) → POST /internal/actuator-status
-- 소비: GET /api/sensor-status/:farmId (1분 행), /export (csv/txt), 표준노드 탭 「§5.4.4 데이터 저장 확인」, 보고서 › 데이터 조회·추출
-- 키: 탐색된 표준 센서 전부 (unit, idx) — 하우스 매핑이 없어도 기록한다. house_id/sensor_id 는 매핑이 있을 때만.

CREATE TABLE IF NOT EXISTS ks_sensor_status (
  "timestamp"  TIMESTAMPTZ NOT NULL,
  farm_id      TEXT        NOT NULL,
  unit         INTEGER     NOT NULL,       -- 노드 주소
  idx          INTEGER     NOT NULL,       -- 디폴트맵 센서 순번 1~30
  code         INTEGER,                    -- 장치코드 (1 온도, 2 습도, 11 CO2 …)
  name         TEXT,
  value        DOUBLE PRECISION,           -- 관측치 (CDAB float)
  status       INTEGER     NOT NULL,       -- KS X 3267 센서 상태코드 (0 READY, 101~103 점검군, 1~6 오류군 …)
  status_name  TEXT,
  house_id     TEXT,                       -- 하우스 매핑이 있으면
  sensor_id    TEXT,
  source       TEXT        DEFAULT 'ks3267d',
  PRIMARY KEY ("timestamp", farm_id, unit, idx)
);

CREATE INDEX IF NOT EXISTS idx_ks_sensor_status_farm_unit ON ks_sensor_status (farm_id, unit, idx, "timestamp" DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('ks_sensor_status', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;
END $$;
