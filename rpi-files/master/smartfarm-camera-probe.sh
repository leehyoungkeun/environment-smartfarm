#!/bin/bash
# smartfarm-camera-probe.sh — 등록된 카메라 전부의 도달성 + IP 표류를 node_exporter 텍스트파일로 (매분, root cron)
#
# 2026-08-28 사고: Tapo C200 이 공유기 DHCP(lease 2h)로 .39→.36 으로 옮겨갔는데 go2rtc.yaml 은
# .39 고정 → 며칠간 "되다 안 되다". 근본 조치는 공유기 DHCP 예약; 이 프로브는 그 전제가 깨지면 즉시 알린다.
# 카메라 목록: /etc/smartfarm/cameras.conf ("name mac" 한 줄씩) — smartfarm-camera-setup.sh 가 관리.
CFG=/home/lhk/smartfarm/go2rtc.yaml
CONF=/etc/smartfarm/cameras.conf
OUT=/var/lib/prometheus/node-exporter/smartfarm_camera.prom
DISCOVER_PY=/usr/local/lib/smartfarm/onvif-discover.py
[ -s "$CONF" ] || { rm -f "$OUT"; exit 0; }

DISC=$(python3 "$DISCOVER_PY" 2>/dev/null)   # 한 번의 탐색으로 LAN 의 카메라 전부: ip mac model

TMP="$OUT.tmp"
{
echo '# HELP smartfarm_camera_ping_up 1 if configured camera IP answers ping'
echo '# TYPE smartfarm_camera_ping_up gauge'
echo '# HELP smartfarm_camera_rtsp_up 1 if TCP 554 open on configured camera IP'
echo '# TYPE smartfarm_camera_rtsp_up gauge'
echo '# HELP smartfarm_camera_frame_up 1 if go2rtc delivered a JPEG frame (end-to-end)'
echo '# TYPE smartfarm_camera_frame_up gauge'
echo '# HELP smartfarm_camera_ip_match 1 if ONVIF-discovered IP (by MAC) equals go2rtc configured IP'
echo '# TYPE smartfarm_camera_ip_match gauge'
echo '# HELP smartfarm_camera_info configured vs discovered IP'
echo '# TYPE smartfarm_camera_info gauge'
while read -r CAM MAC; do
  [ -z "$CAM" ] && continue
  MAC=$(echo "$MAC" | tr 'A-Z' 'a-z')
  IP=$(python3 -c "import yaml,re;d=yaml.safe_load(open('$CFG'));print(re.search(r'@([0-9.]+):',d['streams']['$CAM'][0]).group(1))" 2>/dev/null)
  if [ -z "$IP" ]; then
    echo "smartfarm_camera_info{cam=\"$CAM\",configured_ip=\"none\",discovered_ip=\"none\"} 1"
    continue
  fi
  ping -c1 -W1 "$IP" >/dev/null 2>&1 && P=1 || P=0
  timeout 3 bash -c "</dev/tcp/$IP/554" 2>/dev/null && R=1 || R=0
  [ "$(curl -s -m 12 -o /dev/null -w '%{http_code}' "http://localhost:1984/api/frame.jpeg?src=$CAM")" = 200 ] && F=1 || F=0
  D=$(echo "$DISC" | awk -v m="$MAC" '$2==m{print $1; exit}')
  if [ -n "$D" ] && [ "$D" = "$IP" ]; then M=1; else M=0; fi
  echo "smartfarm_camera_ping_up{cam=\"$CAM\"} $P"
  echo "smartfarm_camera_rtsp_up{cam=\"$CAM\"} $R"
  echo "smartfarm_camera_frame_up{cam=\"$CAM\"} $F"
  echo "smartfarm_camera_ip_match{cam=\"$CAM\"} $M"
  echo "smartfarm_camera_info{cam=\"$CAM\",configured_ip=\"$IP\",discovered_ip=\"${D:-none}\"} 1"
done < "$CONF"
} > "$TMP" && mv -f "$TMP" "$OUT"
