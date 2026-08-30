-- 자동제어 엔진 심박 — ② 규칙 평가가 매 분 통과할 때 서버에 보고.
-- 센서는 멀쩡한데 엔진 루프만 죽으면 SensorDataStalled 로는 못 잡는다(작물 직접 피해). 2026-08-30.
CREATE TABLE IF NOT EXISTS automation_heartbeat (
  farm_id     TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL,
  rules_count INTEGER,
  houses      INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
