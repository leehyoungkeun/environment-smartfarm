#!/bin/bash
echo "=== GlitchTip 서비스 상태 ==="
docker ps | grep glitchtip
echo ""
echo "=== 전체 이슈 통계 (프로젝트별) ==="
docker exec glitchtip-postgres psql -U postgres -d glitchtip -c "
SELECT
  p.name AS project,
  COUNT(i.id) AS total_issues,
  MAX(i.last_seen) AS latest_event
FROM issue_events_issue i
JOIN projects_project p ON i.project_id = p.id
GROUP BY p.name
ORDER BY p.name;
"
echo "=== 최근 24시간 이벤트 ==="
docker exec glitchtip-postgres psql -U postgres -d glitchtip -c "
SELECT
  p.name, COUNT(*) AS recent
FROM issue_events_issue i
JOIN projects_project p ON i.project_id = p.id
WHERE i.last_seen > NOW() - INTERVAL '24 hours'
GROUP BY p.name;
"
echo "=== 외부 endpoint 도달성 ==="
curl -sS -o /dev/null -w "https://sentry.smartgreen.kr/  HTTP %{http_code}\n" https://sentry.smartgreen.kr/ -m 5
