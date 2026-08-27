# GlitchTip 업타임 모니터 등록 (2026-08-27)
#
# 왜 필요한가 — Prometheus 가 죽는 것은 Prometheus 규칙으로 못 잡는다(자기참조).
# GlitchTip 은 별도 컨테이너·별도 워커라 감시 장치의 감시자 역할을 한다.
# 외부 도메인은 터널·Cloudflare·인증서까지 포함해 "사용자가 보는 그대로" 를 본다.
#
# 실행 (서버에서, 이름 기준 idempotent — 여러 번 돌려도 8개):
#   docker cp monitoring/glitchtip-uptime-monitors.py glitchtip-web:/tmp/m.py
#   docker exec glitchtip-web sh -c "cd /code && python manage.py shell < /tmp/m.py"
#
# 알림 경로: 모니터 → backend 프로젝트 알림 규칙(uptime=True)
#           → 수신처 recipient_type='discord' (GlitchTip 네이티브, 백엔드 중계 없음)
#           tags_to_add={service,farm_id} 로 어느 서비스·농장인지 embed 에 실린다
# 체커 UA 는 "GlitchTip/<버전>" — UA 없는 요청은 Cloudflare 가 403 으로 막는다.
#
# 확인 SQL (-d glitchtip):
#   select m.name, c.is_up, c.response_time from uptime_monitor m
#   join lateral (select * from uptime_monitorcheck where monitor_id=m.id
#                 order by start_check desc limit 1) c on true;
from apps.uptime.models import Monitor, MonitorType
from apps.projects.models import Project
from apps.organizations_ext.models import Organization
from apps.alerts.models import ProjectAlert

print("  MonitorType:", [c[0] for c in MonitorType.choices])
org = Organization.objects.get(slug="smartfarm")
proj = Project.objects.get(name="smartfarm-backend")

# 감시 장치 자신 — Prometheus 가 죽는 것은 Prometheus 로 못 잡는다. 이것이 이 등록의 핵심.
# 외부 도메인 — 터널·인증서·Cloudflare 까지 포함한 "사용자가 보는 그대로".
SPEC = [
  ("Prometheus",                    "http://prometheus:9090/-/healthy",       60,  ""),
  ("Alertmanager",                  "http://alertmanager:9093/-/healthy",     60,  ""),
  ("Loki",                          "http://loki:3100/ready",                 60,  ""),
  ("Grafana",                       "http://grafana:3000/api/health",         60,  ""),
  ("백엔드 API (터널 경유)",          "https://api.smartgreen.kr/health",      60,  "success"),
  ("프론트 smartgreen.kr",           "https://smartgreen.kr/",                300, ""),
  ("CCTV cctv.smartgreen.kr",        "https://cctv.smartgreen.kr/",           300, ""),
  ("RPi 1호 Node-RED (Tailscale)",   "http://100.104.177.84:1880/api/health", 60,  ""),
]
created = updated = 0
for name, url, interval, body in SPEC:
    m, is_new = Monitor.objects.update_or_create(
        organization=org, name=name,
        defaults=dict(monitor_type=MonitorType.GET, url=url, interval=interval,
                      timeout=15, expected_status=200, expected_body=body, project=proj))
    created += is_new; updated += (not is_new)
print(f"  모니터 생성 {created} / 갱신 {updated} / 총 {Monitor.objects.filter(organization=org).count()}")

# 업타임 알림을 backend 프로젝트 규칙(→ Discord webhook)에 태운다
n = ProjectAlert.objects.filter(project=proj).update(uptime=True)
print(f"  backend 프로젝트 알림 규칙 uptime=True: {n}건")
