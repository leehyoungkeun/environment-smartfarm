-- Check all users and their farm assignments
SELECT u.username, u.name, u.role, u.farm_id as user_farm_id,
       uf.farm_id as uf_farm_id, f.name as farm_name, f.farm_id as actual_farm_id
FROM users u
LEFT JOIN user_farms uf ON u.id = uf.user_id
LEFT JOIN farms f ON uf.farm_id = f.id
ORDER BY u.username;
