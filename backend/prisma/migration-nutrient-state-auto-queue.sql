-- nutrient_states 에 auto_queue 컬럼 추가 (자동 모드 큐 진행 상태)
-- {itemIdx, repeatDone, startedAt}

ALTER TABLE nutrient_states
  ADD COLUMN IF NOT EXISTS auto_queue JSONB NOT NULL DEFAULT '{}';
