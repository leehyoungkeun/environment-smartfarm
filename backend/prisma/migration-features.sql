-- 농장관리 5대 기능 스키마 마이그레이션
-- 실행: psql -U smartfarm -d smartfarm_db -f prisma/migration-features.sql

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Feature: 농장 휴지통 (Soft Delete)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE farms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_farms_deleted_at ON farms (deleted_at) WHERE deleted_at IS NOT NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Feature: 농장 권한 관리
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALTER TABLE user_farms ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Feature: 일정/캘린더
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS farm_schedules (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  farm_id       TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  type          TEXT NOT NULL DEFAULT 'general',
  start_date    DATE NOT NULL,
  end_date      DATE,
  all_day       BOOLEAN NOT NULL DEFAULT TRUE,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  assigned_to   TEXT,
  house_id      TEXT,
  priority      TEXT NOT NULL DEFAULT 'normal',
  color         TEXT,
  recurrence    JSONB,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farm_schedules_farm_date ON farm_schedules (farm_id, start_date);
CREATE INDEX IF NOT EXISTS idx_farm_schedules_completed ON farm_schedules (farm_id, completed, start_date);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Feature: 문서/첨부파일 관리
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS farm_documents (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  farm_id       TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_size     INTEGER NOT NULL DEFAULT 0,
  mime_type     TEXT,
  category      TEXT NOT NULL DEFAULT 'other',
  description   TEXT,
  uploaded_by   TEXT,
  uploader_id   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farm_documents_farm ON farm_documents (farm_id, category);
CREATE INDEX IF NOT EXISTS idx_farm_documents_created ON farm_documents (farm_id, created_at DESC);
