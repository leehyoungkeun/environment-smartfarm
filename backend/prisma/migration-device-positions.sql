-- device_positions — 하우스별 개폐 장치(측창·천창 등)의 현재 위치와 진행 중 동작
-- device-positions.routes.js 가 조회/UPSERT, mqttClient 가 NR 상태 수신 시 갱신
--
-- 2026-08-29: 이 테이블은 운영 DB 에만 손으로 만들어져 있었고 DDL 이 리포에 없었다.
-- 새 서버에 설치하면 위치 저장이 통째로 실패한다. 아래는 운영 DB(smartfarm_db)의
-- 실제 정의를 그대로 옮긴 것이다 — 단 한 곳(house_id 기본값)만 의도적으로 뺐다.
--
-- Prisma 스키마에 없는 이유: 복합 PK + 잦은 UPSERT 라 raw SQL 로만 쓴다.
-- 그래도 DDL 은 리포에 있어야 재해 복구와 신규 서버가 같은 모양으로 선다.

CREATE TABLE IF NOT EXISTS device_positions (
  farm_id         TEXT        NOT NULL,
  device_id       TEXT        NOT NULL,
  position        INTEGER     DEFAULT 0,
  command         TEXT        DEFAULT 'stop',
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  start_position  INTEGER     DEFAULT 0,
  target_position INTEGER     DEFAULT 0,
  duration        INTEGER     DEFAULT 0,
  started_at      TIMESTAMPTZ,
  -- 운영 DB 에는 `DEFAULT 'house_0001'` 이 붙어 있다. 다중 하우스 전환(2026-08-25) 전
  -- 기존 행을 채우려고 넣은 것인데, 그대로 두면 하우스를 빠뜨린 INSERT 가 조용히
  -- 1동으로 기록된다 — 2동 제어가 1동 이력으로 보이는 사고가 된다.
  -- 새로 세우는 서버에는 물려주지 않는다. 값이 없으면 에러가 나야 옳다.
  house_id        TEXT        NOT NULL,
  PRIMARY KEY (farm_id, house_id, device_id)
);

-- 하우스 단위 조회가 대부분
CREATE INDEX IF NOT EXISTS idx_device_positions_farm_house ON device_positions (farm_id, house_id);
