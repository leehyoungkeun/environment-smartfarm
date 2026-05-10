#!/bin/bash
# ─────────────────────────────────────────────────────────
# Grafana 알림 시스템 셋업 (Contact Point + Rules + Template)
# ─────────────────────────────────────────────────────────
# 사용법:
#   GRAFANA_URL=http://127.0.0.1:3030 \
#   GRAFANA_AUTH=admin:<password> \
#   SLACK_WEBHOOK=https://hooks.slack.com/services/... \
#   bash grafana-alerts-setup.sh
#
# 필요한 사전 조건:
#   - Grafana 컨테이너 실행 중
#   - Prometheus 데이터소스 등록됨 (이름: "Prometheus")
#   - node-exporter 메트릭 수집 중
# ─────────────────────────────────────────────────────────

set -e

: "${GRAFANA_URL:?need to set GRAFANA_URL}"
: "${GRAFANA_AUTH:?need to set GRAFANA_AUTH (user:password)}"
: "${SLACK_WEBHOOK:?need to set SLACK_WEBHOOK}"

PROM_UID=$(curl -sS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/datasources/name/Prometheus" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["uid"])')
echo "Prometheus UID: $PROM_UID"

# ─── 1. Folder ─────────────────────────────────────────
curl -sS -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/folders" \
  -H "Content-Type: application/json" \
  -d '{"title":"SmartFarm Alerts","uid":"smartfarm-alerts"}' > /dev/null 2>&1 || true

# ─── 2. Slack Contact Point ────────────────────────────
TITLE='{{ if eq .Status "firing" }}🔴{{ else }}🟢{{ end }} {{ .CommonLabels.alertname }}'
TEXT='{{ range .Alerts }}{{ if and (eq .Labels.alertname "DatasourceError") (eq .Status "firing") }}⚠️ *데이터소스 오류* — Grafana 가 Prometheus 메트릭을 평가할 수 없음
• 영향 알림: `{{ .Labels.rulename }}`
• 시작: {{ .StartsAt.Format "01-02 15:04 MST" }}
• 점검: Prometheus·node-exporter 컨테이너 상태 확인 필요{{ else if eq .Status "firing" }}🚨 *발생* — {{ .Annotations.summary }}
• 호스트: `{{ if .Labels.instance }}{{ .Labels.instance }}{{ else }}전체{{ end }}`
• 심각도: {{ .Labels.severity }}
• 시작: {{ .StartsAt.Format "01-02 15:04 MST" }}
{{ if .Annotations.description }}• 상세: {{ .Annotations.description }}
{{ end }}{{ else }}✅ *해소* — {{ .Annotations.summary }}
• 호스트: `{{ if .Labels.instance }}{{ .Labels.instance }}{{ else }}전체{{ end }}`
• 발생: {{ .StartsAt.Format "01-02 15:04 MST" }}
• 해소: {{ .EndsAt.Format "01-02 15:04 MST" }}
{{ end }}{{ end }}'

python3 - <<PYEOF > /tmp/cp.json
import json
print(json.dumps({
    "name": "slack-monitoring",
    "type": "slack",
    "settings": {"url": "${SLACK_WEBHOOK}", "title": '''${TITLE}''', "text": '''${TEXT}'''}
}, ensure_ascii=False))
PYEOF

# 기존 contact point 있으면 update, 없으면 create
CP_UID=$(curl -sS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/v1/provisioning/contact-points" \
  | python3 -c 'import json,sys; cps=json.load(sys.stdin); print(next((c["uid"] for c in cps if c["name"]=="slack-monitoring"), ""))')

if [ -z "$CP_UID" ]; then
  curl -sS -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/v1/provisioning/contact-points" \
    -H "Content-Type: application/json" -H "X-Disable-Provenance: true" \
    -d @/tmp/cp.json | python3 -c 'import json,sys; print("CP created:", json.load(sys.stdin).get("uid"))'
else
  curl -sS -u "$GRAFANA_AUTH" -X PUT "$GRAFANA_URL/api/v1/provisioning/contact-points/${CP_UID}" \
    -H "Content-Type: application/json" -H "X-Disable-Provenance: true" \
    -d @/tmp/cp.json > /dev/null
  echo "CP updated: $CP_UID"
fi

# ─── 3. Notification Policy (slack 으로 라우팅) ────────
curl -sS -u "$GRAFANA_AUTH" -X PUT "$GRAFANA_URL/api/v1/provisioning/policies" \
  -H "Content-Type: application/json" -H "X-Disable-Provenance: true" \
  -d '{"receiver":"slack-monitoring","group_by":["alertname"],"group_wait":"10s","group_interval":"5m","repeat_interval":"4h"}' \
  > /dev/null
echo "Policy: -> slack-monitoring"

# ─── 4. Alert Rules (A: query → B: reduce → C: threshold) ──
create_rule() {
    local uid="$1"
    local title="$2"
    local threshold="$3"
    local summary="$4"
    local desc="$5"
    local severity="$6"
    local prom_query="$7"

    cat > /tmp/rule.json <<JSON
{
  "uid": "${uid}",
  "title": "${title}",
  "ruleGroup": "system-resources",
  "folderUID": "smartfarm-alerts",
  "for": "5m",
  "noDataState": "OK",
  "execErrState": "Error",
  "condition": "C",
  "annotations": {
    "summary": "${summary}",
    "description": "${desc}"
  },
  "labels": {"severity": "${severity}"},
  "data": [
    {
      "refId": "A",
      "datasourceUid": "${PROM_UID}",
      "relativeTimeRange": {"from": 600, "to": 0},
      "model": {
        "expr": "${prom_query}",
        "intervalMs": 30000,
        "maxDataPoints": 43200,
        "refId": "A"
      }
    },
    {
      "refId": "B",
      "datasourceUid": "__expr__",
      "relativeTimeRange": {"from": 0, "to": 0},
      "model": {
        "type": "reduce",
        "reducer": "last",
        "expression": "A",
        "refId": "B"
      }
    },
    {
      "refId": "C",
      "datasourceUid": "__expr__",
      "relativeTimeRange": {"from": 0, "to": 0},
      "model": {
        "type": "threshold",
        "expression": "B",
        "conditions": [{"evaluator": {"params": [${threshold}], "type": "gt"}, "operator": {"type": "and"}, "query": {"params": ["B"]}, "reducer": {"params": [], "type": "last"}, "type": "query"}],
        "refId": "C"
      }
    }
  ]
}
JSON

    # 기존 있으면 update, 없으면 create
    if curl -sS -u "$GRAFANA_AUTH" "$GRAFANA_URL/api/v1/provisioning/alert-rules/${uid}" -o /dev/null -w "%{http_code}" | grep -q 200; then
        curl -sS -u "$GRAFANA_AUTH" -X PUT "$GRAFANA_URL/api/v1/provisioning/alert-rules/${uid}" \
            -H "Content-Type: application/json" -H "X-Disable-Provenance: true" \
            -d @/tmp/rule.json > /dev/null
        echo "  $title — updated"
    else
        curl -sS -u "$GRAFANA_AUTH" -X POST "$GRAFANA_URL/api/v1/provisioning/alert-rules" \
            -H "Content-Type: application/json" -H "X-Disable-Provenance: true" \
            -d @/tmp/rule.json > /dev/null
        echo "  $title — created"
    fi
}

create_rule "alert-cpu-90" "CPU 90% 초과" "90" \
  "CPU 사용률 임계 초과" \
  "5분 평균 CPU 사용률이 90%를 초과했습니다 (현재: {{ printf \\\"%.1f\\\" \$values.B.Value }}%)" \
  "warning" \
  "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\\\"idle\\\"}[5m])) * 100)"

create_rule "alert-ram-85" "메모리 85% 초과" "85" \
  "메모리 사용률 임계 초과" \
  "메모리 사용률이 85%를 초과했습니다 (현재: {{ printf \\\"%.1f\\\" \$values.B.Value }}%)" \
  "warning" \
  "(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100"

create_rule "alert-disk-85" "디스크 85% 초과" "85" \
  "루트 파티션 사용률 임계 초과" \
  "루트 파티션이 85%를 초과했습니다 (현재: {{ printf \\\"%.1f\\\" \$values.B.Value }}%)" \
  "critical" \
  "(1 - (node_filesystem_avail_bytes{mountpoint=\\\"/\\\",fstype!=\\\"tmpfs\\\"} / node_filesystem_size_bytes{mountpoint=\\\"/\\\",fstype!=\\\"tmpfs\\\"})) * 100"

echo ""
echo "Done. 30초 후 상태 확인:"
echo "  curl -sS -u \$GRAFANA_AUTH \$GRAFANA_URL/api/prometheus/grafana/api/v1/rules"
