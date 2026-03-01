-- farm_001 → farm_0001 마이그레이션 (4자리 형식 통일)
-- 모든 farm_id 컬럼을 가진 테이블 일괄 업데이트

BEGIN;

-- 1. farms (메인 테이블)
UPDATE farms SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 2. users (farm_id 컬럼)
UPDATE users SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 3. user_farms
UPDATE user_farms SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 4. house_configs
UPDATE house_configs SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 5. alerts (TimescaleDB hypertable)
UPDATE alerts SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 6. sensor_data (TimescaleDB hypertable - 대량 데이터)
UPDATE sensor_data SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 7. audit_logs
UPDATE audit_logs SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 8. automation_rules
UPDATE automation_rules SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 9. control_logs
UPDATE control_logs SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 10. farm_documents
UPDATE farm_documents SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 11. farm_journals
UPDATE farm_journals SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 12. farm_notes
UPDATE farm_notes SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 13. farm_schedules
UPDATE farm_schedules SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 14. harvest_records
UPDATE harvest_records SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 15. input_records
UPDATE input_records SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 16. maintenance_logs
UPDATE maintenance_logs SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- 17. system_settings
UPDATE system_settings SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';

-- audit_logs의 target_id도 업데이트 (농장 관련 감사 로그)
UPDATE audit_logs SET target_id = 'farm_0001' WHERE target_id = 'farm_001' AND target_type = 'farm';

-- audit_logs의 details에 farmId가 포함된 경우도 업데이트
UPDATE audit_logs SET details = jsonb_set(details, '{farmId}', '"farm_0001"')
WHERE details->>'farmId' = 'farm_001';

COMMIT;
