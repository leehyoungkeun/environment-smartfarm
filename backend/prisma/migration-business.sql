-- 사업구분 기능 스키마 마이그레이션
-- 실행: psql -U postgres -d smartfarm_db -f prisma/migration-business.sql

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 사업 마스터 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS business_projects (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'self',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Farm 테이블에 사업 관련 컬럼 추가
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE farms ADD COLUMN IF NOT EXISTS business_project_id TEXT REFERENCES business_projects(id) ON DELETE SET NULL;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS total_cost BIGINT;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS subsidy_amount BIGINT;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS self_funding BIGINT;

CREATE INDEX IF NOT EXISTS idx_farms_business_project ON farms (business_project_id) WHERE business_project_id IS NOT NULL;
