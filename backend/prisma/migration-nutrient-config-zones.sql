-- nutrient_configs 에 valve_groups + valves 컬럼 추가 (구역 그룹 + 구역별 품목/식재수)
-- 멱등 (IF NOT EXISTS) — 재실행 안전

ALTER TABLE nutrient_configs
  ADD COLUMN IF NOT EXISTS valve_groups JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS valves       JSONB NOT NULL DEFAULT '[]';
