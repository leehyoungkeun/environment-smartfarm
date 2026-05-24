-- relay_status 테이블 — 농장별 릴레이 모듈 실시간 상태 영구 저장
-- mqttClient._cacheRelayStatus 가 UPSERT, GET /api/relay-status/:farmId 가 조회
-- 양산 표준 sync 구조: NR publish → backend DB persist + WS broadcast → frontend mount GET + WS 구독

CREATE TABLE IF NOT EXISTS relay_status (
  farm_id     TEXT        NOT NULL,
  unit_id     INTEGER     NOT NULL,
  module_type TEXT        NOT NULL DEFAULT 'waveshare',
  coils       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (farm_id, unit_id)
);

-- 조회 최적화 (farmId 단건 조회가 대부분)
CREATE INDEX IF NOT EXISTS idx_relay_status_farm_id ON relay_status (farm_id);
