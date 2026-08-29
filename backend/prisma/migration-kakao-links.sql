-- kakao_links — 카카오 봇 사용자 ↔ 농장 연동 (2026-08-30, 카톡 AS 상담 2단계)
-- 오픈빌더가 주는 userRequest.user.id (봇 사용자 고유키)를 farm 에 매핑한다.
-- 사용자당 농장 1개 (PK) — 여러 사람이 같은 농장에 연동하는 것은 허용.

CREATE TABLE IF NOT EXISTS kakao_links (
  kakao_user_id TEXT        PRIMARY KEY,
  farm_id       TEXT        NOT NULL,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kakao_links_farm ON kakao_links (farm_id);

-- 농장별 등록 코드 — 사장님이 고객에게 알려주는 6자리 (hex).
-- api_key 와 별개다: api_key 는 장비 비밀, 이 코드는 사람에게 불러주는 용도.
ALTER TABLE farms ADD COLUMN IF NOT EXISTS kakao_link_code TEXT;
UPDATE farms SET kakao_link_code = upper(substr(md5(random()::text || farm_id), 1, 6))
 WHERE kakao_link_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_kakao_link_code ON farms (kakao_link_code);
