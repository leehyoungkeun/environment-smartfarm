-- actuator_status — 표준(KS X 3267) 구동기 노드의 1분 상태 스냅샷 (상태코드·남은 동작시간·opid)
-- 2026-08-30 신설. KOAT 검정기준 116 「통합제어기」 4.가.2) 구동기 상태정보 저장·시각화·1분 조회·추출 요구.
--
-- 생산: RPi ks3267d 데몬 → NR(표준 상태 반영, global.ks3267State) → NR 1분 스냅샷 → POST /internal/actuator-status
-- 소비: GET /api/actuator-status/:farmId (1분 행), /export (csv/txt), 제어판·보고서 화면
-- Prisma 스키마 밖(복합 PK + 대량 INSERT ... ON CONFLICT DO NOTHING) — device_positions 와 같은 이유.

CREATE TABLE IF NOT EXISTS actuator_status (
  "timestamp"  TIMESTAMPTZ NOT NULL,
  farm_id      TEXT        NOT NULL,
  house_id     TEXT        NOT NULL,
  device_id    TEXT        NOT NULL,
  unit         INTEGER,
  kind         TEXT,                       -- switch | opener
  n            INTEGER,                    -- 디바이스 번호 (스위치 1~16, 개폐기 1~8)
  status       INTEGER     NOT NULL,       -- KS X 3267 상태코드 (0 READY, 201 ON, 301/302 OPENING/CLOSING, 1~6 오류 …)
  status_name  TEXT,
  remain       INTEGER     DEFAULT 0,      -- 남은 동작시간(초)
  opid         INTEGER     DEFAULT 0,
  source       TEXT        DEFAULT 'ks3267d',
  PRIMARY KEY ("timestamp", farm_id, house_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_actuator_status_farm_device ON actuator_status (farm_id, house_id, device_id, "timestamp" DESC);

-- TimescaleDB 가 있으면 하이퍼테이블 (sensor_data 와 같은 운영), 없으면(테스트 DB) 일반 테이블
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('actuator_status', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;
END $$;
