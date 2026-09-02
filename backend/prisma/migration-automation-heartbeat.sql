-- 자동제어 엔진 심박 — ② 규칙 평가가 매 분 통과할 때 서버에 보고.
-- 센서는 멀쩡한데 엔진 루프만 죽으면 SensorDataStalled 로는 못 잡는다(작물 직접 피해). 2026-08-30.
CREATE TABLE IF NOT EXISTS automation_heartbeat (
  farm_id     TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL,
  rules_count INTEGER,
  houses      INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2026-09-02: RPi AWS IoT MQTT 연결상태 (HTTP 하트비트에 실려 옴, MQTT 와 독립).
-- RelayStatusStalled 는 릴레이상태 부재로 간접 감지하지만, 이 컬럼은 "MQTT 만 끊김" 을 직접·정밀 구분.
ALTER TABLE automation_heartbeat ADD COLUMN IF NOT EXISTS mqtt_connected BOOLEAN;
