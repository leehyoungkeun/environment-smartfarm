SELECT 'users' as tbl, farm_id FROM users WHERE farm_id ~ '^farm_\d{1,3}$'
UNION ALL
SELECT 'farms', farm_id FROM farms WHERE farm_id ~ '^farm_\d{1,3}$'
UNION ALL
SELECT 'audit_logs', farm_id FROM audit_logs WHERE farm_id ~ '^farm_\d{1,3}$' AND farm_id IS NOT NULL;

SELECT 'sensor_data' as tbl, farm_id, COUNT(*) FROM sensor_data WHERE farm_id ~ '^farm_\d{1,3}$' GROUP BY farm_id;
SELECT 'control_logs' as tbl, farm_id, COUNT(*) FROM control_logs WHERE farm_id ~ '^farm_\d{1,3}$' GROUP BY farm_id;
