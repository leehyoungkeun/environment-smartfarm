#!/bin/bash
# smartfarm-camera-probe.sh — 등록된 카메라 전부의 도달성 + IP 표류를 node_exporter 텍스트파일로 (매분, root cron)
#
# 2026-08-28 사고: Tapo C200 이 공유기 DHCP(lease 2h)로 .39→.36 으로 옮겨갔는데 go2rtc.yaml 은
# .39 고정 → 며칠간 "되다 안 되다". 근본 조치는 공유기 DHCP 예약; 이 프로브는 그 전제가 깨지면 즉시 알린다.
# 카메라 목록: /etc/smartfarm/cameras.conf ("name mac" 한 줄씩) — smartfarm-camera-setup.sh 가 관리.
CFG=/home/lhk/smartfarm/go2rtc.yaml
CONF=/etc/smartfarm/cameras.conf
# 사용 중단한 카메라 (설정 화면 토글 → 서버 → rpi-server /local-config/camera 가 쓴다, 2026-09-14)
STATE=/home/lhk/smartfarm/cameras-state.json
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
echo '# HELP smartfarm_camera_enabled 1 if camera is in use, 0 if temporarily disabled in settings (not probed)'
echo '# TYPE smartfarm_camera_enabled gauge'
while read -r CAM MAC; do
  [ -z "$CAM" ] && continue
  MAC=$(echo "$MAC" | tr 'A-Z' 'a-z')
  # 사용 중단한 카메라는 점검하지 않고 도달성 지표도 내지 않는다 → Camera* 경보가 풀린다.
  # 카메라를 두고 제어기만 다른 농장에 갔을 때 경보가 매분 울리던 문제 (2026-09-14). 파일·키가 없으면 사용.
  EN=$(python3 -c "import json;print(json.load(open('$STATE')).get('$CAM', True))" 2>/dev/null || echo True)
  if [ "$EN" = "False" ]; then
    echo "smartfarm_camera_enabled{cam=\"$CAM\"} 0"
    continue
  fi
  echo "smartfarm_camera_enabled{cam=\"$CAM\"} 1"
  IP=$(python3 -c "import yaml,re;d=yaml.safe_load(open('$CFG'));print(re.search(r'@([0-9.]+):',d['streams']['$CAM'][0]).group(1))" 2>/dev/null)
  if [ -z "$IP" ]; then
    echo "smartfarm_camera_info{cam=\"$CAM\",configured_ip=\"none\",discovered_ip=\"none\"} 1"
    continue
  fi
  ping -c1 -W1 "$IP" >/dev/null 2>&1 && P=1 || P=0
  timeout 3 bash -c "</dev/tcp/$IP/554" 2>/dev/null && R=1 || R=0
  # 프레임 판정: go2rtc 는 카메라가 끊겨도 **200 + 0 바이트**를 돌려준다(2026-09-13 실측) →
  # 상태코드만 보면 frame_up 이 영원히 1 이라 CameraUnreachable 이 한 번도 울리지 않는다.
  # 실제 JPEG 인지까지 본다: 200 + 비어있지 않음 + JPEG 매직(FFD8FF).
  FJ=$(mktemp)
  FHC=$(curl -s -m 12 -o "$FJ" -w '%{http_code}' "http://localhost:1984/api/frame.jpeg?src=$CAM")
  if [ "$FHC" = 200 ] && [ -s "$FJ" ] && [ "$(od -An -tx1 -N3 "$FJ" 2>/dev/null | tr -d "[:space:]")" = "ffd8ff" ]; then F=1; else F=0; fi
  rm -f "$FJ"
  D=$(echo "$DISC" | awk -v m="$MAC" '$2==m{print $1; exit}')
  if [ -n "$D" ] && [ "$D" = "$IP" ]; then M=1; else M=0; fi
  echo "smartfarm_camera_ping_up{cam=\"$CAM\"} $P"
  echo "smartfarm_camera_rtsp_up{cam=\"$CAM\"} $R"
  echo "smartfarm_camera_frame_up{cam=\"$CAM\"} $F"
  echo "smartfarm_camera_ip_match{cam=\"$CAM\"} $M"
  echo "smartfarm_camera_info{cam=\"$CAM\",configured_ip=\"$IP\",discovered_ip=\"${D:-none}\"} 1"
done < "$CONF"
} > "$TMP" && mv -f "$TMP" "$OUT"
