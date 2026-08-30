-- 제어이력 동기화 상태 — RPi 가 5분마다 미동기화 백로그를 보고.
-- 로컬 10,106건이 전부 미전송이던 사고(1,474건 유실) 재발 방지. 2026-08-30.
CREATE TABLE IF NOT EXISTS control_sync_status (
  farm_id             TEXT PRIMARY KEY,
  reported_at         TIMESTAMPTZ NOT NULL,
  unsynced_count      INTEGER NOT NULL DEFAULT 0,
  oldest_unsynced_sec INTEGER,        -- 가장 오래된 미동기화 제어이력의 나이(초). 크면 동기화가 밀림
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
