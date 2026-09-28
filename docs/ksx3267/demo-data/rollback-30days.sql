-- 기능시험용 채움 되돌리기 (2026-09-28)
-- simulated 로 표시된 행만 지운다 — 실측 행은 어떤 경우에도 지우지 않는다.
-- 실행: docker exec -i postgres17 psql -U smartfarm -d smartfarm_db -v farm=farm_0001 -v house=house_0003 -f -

\set ON_ERROR_STOP on
\timing on

BEGIN;

DELETE FROM sensor_data
 WHERE farm_id = :'farm' AND house_id = :'house'
   AND metadata->>'quality' = 'simulated';

DELETE FROM ks_sensor_status
 WHERE farm_id = :'farm' AND source = 'simulated';

DELETE FROM actuator_status
 WHERE farm_id = :'farm' AND house_id = :'house' AND source = 'simulated';

COMMIT;

SELECT 'sensor_data' AS 표, count(*) AS 남은_simulated FROM sensor_data
 WHERE farm_id = :'farm' AND metadata->>'quality' = 'simulated'
UNION ALL SELECT 'ks_sensor_status', count(*) FROM ks_sensor_status WHERE farm_id = :'farm' AND source = 'simulated'
UNION ALL SELECT 'actuator_status', count(*) FROM actuator_status WHERE farm_id = :'farm' AND source = 'simulated';
