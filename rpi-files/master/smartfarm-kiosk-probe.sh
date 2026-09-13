#!/bin/bash
# smartfarm-kiosk-probe.sh — 키오스크가 실제로 쓰는 경로를 그대로 찔러 본다 (매분, root cron)
#
# 2026-09-13 사고: nginx → Node-RED 구간이 502 로 죽었는데 클라우드 지표는 전부 초록이었다.
#   센서 수집·동기화·하트비트·MQTT 는 NR 이 **바깥으로** 나가는 길이라 멀쩡했고,
#   키오스크가 **안으로** 들어오는 길(localhost → nginx → NR)만 끊겨 패널의 제어가 통째로 실패했다.
#   클라우드에서 보는 경로와 키오스크가 쓰는 경로가 서로 다르다 — 그래서 끝(키오스크)에서부터 확인한다.
#
# 판정: HTTP 200 + 본문이 JSON 이어야 정상. nginx 가 502 HTML 을 줄 때 200 으로 오판하지 않는다.
BASE=http://127.0.0.1        # 키오스크 브라우저가 보는 것과 같은 곳 (nginx :80)
OUT=/var/lib/prometheus/node-exporter/smartfarm_kiosk.prom
FARM_ID=$(grep -soP '(?<=^FARM_ID=)[A-Za-z0-9_]+' /home/lhk/smartfarm/.env 2>/dev/null | head -1)
FARM_ID=${FARM_ID:-farm_0001}

probe() {  # path label → "code ok"
  local body code ok
  body=$(mktemp)
  code=$(curl -s -m 8 -o "$body" -w '%{http_code}' "$BASE$1" 2>/dev/null)
  # 200 이면서 JSON 본문일 때만 정상. (nginx 502 는 HTML, NR 미기동은 빈 응답)
  if [ "$code" = 200 ] && head -c 1 "$body" | grep -qE '[{[]'; then ok=1; else ok=0; fi
  rm -f "$body"
  echo "$code $ok"
}

TMP="$OUT.tmp"
{
  echo '# HELP smartfarm_kiosk_api_up 1 if the kiosk-local API path (nginx -> Node-RED) answers with JSON'
  echo '# TYPE smartfarm_kiosk_api_up gauge'
  echo '# HELP smartfarm_kiosk_api_code last HTTP status of the kiosk-local API path'
  echo '# TYPE smartfarm_kiosk_api_code gauge'
  # 키오스크가 기동·제어 때 반드시 쓰는 두 경로 (둘 다 nginx → Node-RED)
  # GET 이고 루프백이면 무인증으로 JSON 200 이 보장되는 경로만 쓴다 (제어는 POST 라 찌르지 않는다 —
  # 장비가 실제로 움직이면 안 되므로. 같은 upstream(nginx→NR)이 죽으면 아래 둘이 같이 0 이 된다.)
  for spec in "config:/api/config/farm/$FARM_ID" "sync:/api/sync/status"; do
    name=${spec%%:*}; path=${spec#*:}
    read -r code ok <<<"$(probe "$path")"
    echo "smartfarm_kiosk_api_up{path=\"$name\"} $ok"
    echo "smartfarm_kiosk_api_code{path=\"$name\"} $code"
  done
} > "$TMP" && mv -f "$TMP" "$OUT"
