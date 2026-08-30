-- RPi 유지보수(로컬 데이터 정리) 보고 — 매일 03:00 NR 이 삭제 후 서버에 보고.
-- 안 오면 서버가 '청소가 멈췄다'를 감지해 알림(Prometheus 규칙). 2026-08-30.
CREATE TABLE IF NOT EXISTS maintenance_report (
  farm_id        TEXT PRIMARY KEY,
  last_run_at    TIMESTAMPTZ NOT NULL,
  deleted_rows   INTEGER NOT NULL DEFAULT 0,
  retention_days INTEGER,
  db_rows        INTEGER,           -- 정리 후 로컬 SQLite 총 행수 (증가 추세 감시)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
