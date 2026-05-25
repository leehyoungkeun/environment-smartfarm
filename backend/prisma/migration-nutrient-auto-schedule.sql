-- nutrient_configs 에 auto_schedule 컬럼 추가 (자동 모드 시나리오 플레이리스트)
-- {items: [{scenarioId, repeat, enabled}], loop: boolean}

ALTER TABLE nutrient_configs
  ADD COLUMN IF NOT EXISTS auto_schedule JSONB NOT NULL DEFAULT '{"items":[],"loop":true}';
