#!/bin/bash
# Prometheus 쿼리 + 타겟 + Grafana 알림 상태 확인 헬퍼
#
# 사용법:
#   PROM_URL=http://127.0.0.1:9090 \
#   GRAFANA_URL=http://127.0.0.1:3030 \
#   GRAFANA_AUTH=admin:<password> \
#   bash check-prom.sh

PROM_URL="${PROM_URL:-http://127.0.0.1:9090}"

echo "=== Prometheus targets ==="
curl -sS "$PROM_URL/api/v1/targets" -o /tmp/targets.json
python3 - <<'PYEOF'
import json
with open('/tmp/targets.json') as f:
    d = json.load(f)
print(f"{'job':25} {'health':10} {'scrape URL'}")
print('-' * 70)
for t in d['data']['activeTargets']:
    print(f"{t['labels']['job']:25} {t['health']:10} {t['scrapeUrl']}")
PYEOF

echo ""
echo "=== 핵심 쿼리 결과 ==="
for q in \
  '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' \
  '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100' \
  '(1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"})) * 100'
do
  echo "Q: $q"
  curl -sS --data-urlencode "query=$q" "$PROM_URL/api/v1/query" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); [print('  result:', r['metric'].get('instance','?'), '=', f\"{float(r['value'][1]):.2f}\") for r in d['data']['result']]"
done

if [ -n "$GRAFANA_URL" ] && [ -n "$GRAFANA_AUTH" ]; then
  echo ""
  echo "=== Grafana 알림 룰 상태 ==="
  curl -sS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/prometheus/grafana/api/v1/rules" \
    | python3 -c "
import json, sys
d = json.load(sys.stdin)
for g in d['data']['groups']:
    print(f\"Group: {g['name']}\")
    for r in g['rules']:
        print(f\"  {r['name']:30} health={r.get('health','?')} state={r.get('state','?')}\")
"
fi
