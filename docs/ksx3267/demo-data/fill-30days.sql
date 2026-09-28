-- KOAT 116 기능시험용 30일 1분 데이터 채우기 (2026-09-28)
--
-- 왜: 116 의 「1분 단위 1/7/30일 조회」는 **기능시험**이다 — 조회가 되는지를 보는 것이지
-- 실측을 증명하는 시험이 아니다(KOAT 안내자료: 30일 데이터는 임의값도 가능).
-- 1호는 이전·정전·시험 조작으로 손실률 3% 를 넘긴 날이 많아 연속 30일이 아직 없다.
--
-- 원칙 (이걸 어기면 farm_0006 사고 — 시뮬레이션 값을 실측처럼 저장 — 와 같아진다):
--   1. **실측 행은 절대 건드리지 않는다.** 비어 있는 분만 채운다 (LEFT JOIN … IS NULL).
--   2. 채운 행은 **simulated 로 표시**한다. sensor_data.metadata.quality='simulated',
--      ks_sensor_status.source / actuator_status.source = 'simulated'.
--      30일 창 지표(smartfarm_ks_data_window_days)는 simulated 를 세지 않으므로
--      "실제 수집이 얼마나 온전한가" 는 이 채움과 무관하게 계속 정직하게 보인다.
--   3. 값은 그럴듯한 일일 곡선 + 결정적 잡음 — 되돌리기 쉽게 한 번에 지울 수 있다.
--
-- 되돌리기: rollback-30days.sql (source/quality = 'simulated' 행만 삭제)
--
-- 실행: docker exec -i postgres17 psql -U smartfarm -d smartfarm_db -v farm=farm_0001 -v house=house_0003 -f -

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- 채울 구간: 어제 자정까지의 31일 (오늘은 아직 쌓이는 중이라 뺀다)
CREATE TEMP TABLE _span AS
SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') - interval '31 days' AS t0,
       date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AS t1;

CREATE TEMP TABLE _minutes AS
SELECT generate_series((SELECT t0 FROM _span), (SELECT t1 FROM _span) - interval '1 minute', interval '1 minute')
         AT TIME ZONE 'Asia/Seoul' AS ts;

-- 그럴듯한 값: 하루 주기 + 분 단위 결정적 잡음(재실행해도 같은 값)
CREATE OR REPLACE FUNCTION pg_temp.sim_temp(ts timestamptz) RETURNS numeric AS $$
  SELECT round((21 + 6 * sin(2 * pi() * (extract(epoch from $1) - 6*3600) / 86400)
              + (abs(hashtext($1::text)) % 100) / 100.0 - 0.5)::numeric, 2);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.sim_humi(ts timestamptz) RETURNS numeric AS $$
  SELECT round((62 - 8 * sin(2 * pi() * (extract(epoch from $1) - 6*3600) / 86400)
              + (abs(hashtext($1::text || 'h')) % 200) / 100.0 - 1)::numeric, 2);
$$ LANGUAGE sql IMMUTABLE;

-- 구동기: 하루 몇 번 켜지는 모습 (스위치는 06~08시·18~20시 ON, 개폐기는 11~13시 열림)
CREATE OR REPLACE FUNCTION pg_temp.sim_switch(ts timestamptz) RETURNS int AS $$
  SELECT CASE WHEN extract(hour from $1 AT TIME ZONE 'Asia/Seoul') IN (6, 7, 18, 19) THEN 201 ELSE 0 END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.sim_opener(ts timestamptz) RETURNS int AS $$
  SELECT CASE WHEN extract(hour from $1 AT TIME ZONE 'Asia/Seoul') IN (11, 12) THEN 301 ELSE 0 END;
$$ LANGUAGE sql IMMUTABLE;

-- ── 1) sensor_data (운영 수집 표) ────────────────────────────────────────────
INSERT INTO sensor_data (timestamp, farm_id, house_id, data, metadata)
SELECT m.ts, :'farm', :'house',
       jsonb_build_object('temp_0001', pg_temp.sim_temp(m.ts), 'humidity_0001', pg_temp.sim_humi(m.ts)),
       jsonb_build_object('quality', 'simulated', 'note', 'KOAT 116 기능시험용 (조회 시연)',
                          'generatedAt', now(), 'collectionMethod', 'sim')
FROM _minutes m
LEFT JOIN sensor_data s
       ON s.farm_id = :'farm' AND s.house_id = :'house'
      AND s.timestamp >= m.ts AND s.timestamp < m.ts + interval '1 minute'
WHERE s.timestamp IS NULL;

-- ── 2) ks_sensor_status (표준 센서 1분 스냅샷, §5.4.4) ───────────────────────
INSERT INTO ks_sensor_status (timestamp, farm_id, unit, idx, code, name, value, status, status_name, house_id, sensor_id, source)
SELECT m.ts, :'farm', 2, d.idx, d.code, d.name,
       CASE WHEN d.idx = 1 THEN pg_temp.sim_temp(m.ts) ELSE pg_temp.sim_humi(m.ts) END,
       0, 'READY', :'house', d.sensor_id, 'simulated'
FROM _minutes m
CROSS JOIN (VALUES (1, 1, '온도1', 'temp_0001'), (4, 2, '습도1', 'humidity_0001')) AS d(idx, code, name, sensor_id)
LEFT JOIN ks_sensor_status k
       ON k.farm_id = :'farm' AND k.unit = 2 AND k.idx = d.idx AND k.timestamp = m.ts
WHERE k.timestamp IS NULL;

-- ── 3) actuator_status (표준 구동기 1분 스냅샷, 116) ─────────────────────────
INSERT INTO actuator_status (timestamp, farm_id, house_id, device_id, unit, kind, n, status, status_name, remain, opid, source)
SELECT m.ts, :'farm', :'house', d.device_id, 1, d.kind, 1,
       CASE WHEN d.kind = 'switch' THEN pg_temp.sim_switch(m.ts) ELSE pg_temp.sim_opener(m.ts) END,
       CASE WHEN d.kind = 'switch' THEN (CASE WHEN pg_temp.sim_switch(m.ts) = 201 THEN 'ON' ELSE 'READY' END)
            ELSE (CASE WHEN pg_temp.sim_opener(m.ts) = 301 THEN 'OPENING' ELSE 'READY' END) END,
       0, 0, 'simulated'
FROM _minutes m
CROSS JOIN (VALUES ('heater1', 'switch'), ('window1', 'opener')) AS d(device_id, kind)
LEFT JOIN actuator_status a
       ON a.farm_id = :'farm' AND a.house_id = :'house' AND a.device_id = d.device_id AND a.timestamp = m.ts
WHERE a.timestamp IS NULL;

COMMIT;

-- 결과 확인 — 하루별 분 수(1440 만점)와 그중 simulated 비율
SELECT to_char(timestamp AT TIME ZONE 'Asia/Seoul', 'MM-DD') AS 날짜,
       count(DISTINCT date_trunc('minute', timestamp)) AS 분,
       count(*) FILTER (WHERE metadata->>'quality' = 'simulated') AS 채움
  FROM sensor_data
 WHERE farm_id = :'farm' AND house_id = :'house'
   AND timestamp >= (SELECT t0 FROM _span) AT TIME ZONE 'Asia/Seoul'
 GROUP BY 1 ORDER BY 1;
