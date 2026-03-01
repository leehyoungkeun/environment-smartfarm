-- user_farms 테이블에 누락된 사용자-농장 연결 추가
-- users.farm_id를 기반으로 farms 테이블에서 매칭

INSERT INTO user_farms (user_id, farm_id, role)
SELECT u.id, f.id,
  CASE u.role
    WHEN 'superadmin' THEN 'admin'
    WHEN 'manager' THEN 'admin'
    WHEN 'owner' THEN 'admin'
    ELSE 'viewer'
  END
FROM users u
JOIN farms f ON f.farm_id = u.farm_id
WHERE NOT EXISTS (
  SELECT 1 FROM user_farms uf WHERE uf.user_id = u.id AND uf.farm_id = f.id
);

-- Verify
SELECT u.username, u.name, u.role, u.farm_id, f.name as farm_name
FROM users u
JOIN user_farms uf ON u.id = uf.user_id
JOIN farms f ON uf.farm_id = f.id
ORDER BY u.username;
