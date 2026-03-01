-- Cleanup any remaining farm_001 references
UPDATE control_logs SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';
UPDATE sensor_data SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';
UPDATE alerts SET farm_id = 'farm_0001' WHERE farm_id = 'farm_001';
