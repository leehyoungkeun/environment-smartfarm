-- 표준·비표준 저장 정책 통일 (2026-09-19): 1분 시계열 표는 모두 sensor_data 와 같게 "7일 뒤 압축, 삭제 없음".
--   sensor_data       — 이미 7일 압축 (segmentby farm_id, house_id)
--   actuator_status   — 구동기 1분 스냅샷 (표준 ks3267d + 비표준 vendor). 압축이 없었다
--   ks_sensor_status  — 표준 센서 관측치·상태 1분. 압축이 없었다 (하루 약 4만 행)
-- 삭제(retention) 정책은 세 표 모두 두지 않는다 — 운영 기록은 계속 보관, 압축으로 용량만 줄인다.
--
-- TimescaleDB 규칙: 고유키(PK)의 시간 외 열은 segmentby 에 있어야 압축 청크에서도 ON CONFLICT(멱등 재전송)가 동작한다.
--   actuator_status  PK (timestamp, farm_id, house_id, device_id) → segmentby farm_id, house_id, device_id
--   ks_sensor_status PK (timestamp, farm_id, unit, idx)            → segmentby farm_id, unit, idx
-- 여러 번 실행해도 된다 (정책은 if_not_exists, 설정은 같은 값으로 다시 적용).
-- 적용: docker exec -i postgres17 psql -U smartfarm -d smartfarm_db < backend/prisma/migration-ks-compression.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'actuator_status') THEN
      ALTER TABLE actuator_status SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'farm_id, house_id, device_id',
        timescaledb.compress_orderby = '"timestamp" DESC');
      PERFORM add_compression_policy('actuator_status', INTERVAL '7 days', if_not_exists => TRUE);
    END IF;
    IF EXISTS (SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = 'ks_sensor_status') THEN
      ALTER TABLE ks_sensor_status SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'farm_id, unit, idx',
        timescaledb.compress_orderby = '"timestamp" DESC');
      PERFORM add_compression_policy('ks_sensor_status', INTERVAL '7 days', if_not_exists => TRUE);
    END IF;
  END IF;
END $$;
