#!/bin/bash
# smartfarm-camera-setup.sh — 농장 카메라 설치를 한 번의 명령으로.
#
# 2026-08-28 사고에서 배운 절차를 고정한 것: 카메라는 공유기 DHCP 를 받으므로 IP 가 바뀐다.
# ① MAC 으로 카메라를 찾고 ② go2rtc 에 등록하고 ③ 실제 프레임까지 확인하고
# ④ 매분 프로브가 지켜볼 수 있게 MAC 을 등록하고 ⑤ 공유기 예약 정보를 출력한다.
#
# 사용 (RPi 에서):
#   smartfarm-camera-setup.sh list                          # LAN 의 ONVIF 카메라 목록 (IP·MAC·모델)
#   smartfarm-camera-setup.sh add cam1 <MAC> <user> <pass>  # 등록 + 검증 (기존 이름이면 갱신)
#   smartfarm-camera-setup.sh check                         # 등록된 카메라 전부 재검증
#   smartfarm-camera-setup.sh remove cam1
#
# Tapo 함정: RTSP 는 앱 "고급 설정 → 카메라 계정" 을 만들어야 열린다. 유저명 8~32자.
set -u
GO2RTC_YAML=/home/lhk/smartfarm/go2rtc.yaml
CAMS_CONF=/etc/smartfarm/cameras.conf          # 프로브가 읽는다:  name mac
API=http://localhost:1984
RTSP_PATH="${RTSP_PATH:-/stream1}"
DISCOVER_PY=/usr/local/lib/smartfarm/onvif-discover.py

discover() { python3 "$DISCOVER_PY"; }          # stdout: ip mac model
ip_of_mac() { discover | awk -v m="$(echo "$1" | tr 'A-Z' 'a-z')" '$2==m{print $1; exit}'; }

frame_ok() {  # go2rtc 가 실제로 JPEG 을 내주는가 (end-to-end)
  local code sz
  code=$(curl -s -m 15 -o /tmp/.camframe -w '%{http_code}' "$API/api/frame.jpeg?src=$1")
  sz=$(stat -c %s /tmp/.camframe 2>/dev/null || echo 0); rm -f /tmp/.camframe
  if [ "$code" = 200 ] && [ "$sz" -gt 1000 ]; then echo "  ✓ 프레임 수신 (${sz}B)"; return 0; fi
  echo "  ✗ 프레임 없음 (HTTP $code)"; return 1
}

yaml_set_stream() {  # name url — streams.<name> 을 넣거나 바꾼다 (다른 키 보존)
  python3 - "$GO2RTC_YAML" "$1" "$2" <<'PY'
import sys, yaml, os
p, name, url = sys.argv[1:]
d = (yaml.safe_load(open(p)) if os.path.exists(p) else None) or {}
d.setdefault("streams", {})[name] = [url]
d.setdefault("api", {"listen": ":1984"}); d.setdefault("rtsp", {"listen": ":8554"}); d.setdefault("webrtc", {"listen": ":8555"})
yaml.safe_dump(d, open(p, "w"), allow_unicode=True, sort_keys=False)
PY
}
yaml_del_stream() {
  python3 - "$GO2RTC_YAML" "$1" <<'PY'
import sys, yaml
p, name = sys.argv[1:]; d = yaml.safe_load(open(p)) or {}
d.get("streams", {}).pop(name, None); yaml.safe_dump(d, open(p, "w"), allow_unicode=True, sort_keys=False)
PY
}
cfg_ip() { python3 -c "import yaml,re;d=yaml.safe_load(open('$GO2RTC_YAML'));print(re.search(r'@([0-9.]+):',d['streams']['$1'][0]).group(1))" 2>/dev/null; }

conf_set() {  # name mac
  sudo -n mkdir -p "$(dirname "$CAMS_CONF")"; sudo -n touch "$CAMS_CONF"
  { grep -vE "^$1 " "$CAMS_CONF"; echo "$1 $2"; } | sudo -n tee "$CAMS_CONF.tmp" >/dev/null && sudo -n mv "$CAMS_CONF.tmp" "$CAMS_CONF"
}

cmd_list() {
  echo "ONVIF 카메라 (LAN):"; discover | awk '{printf "  %-16s %-18s %s\n",$1,$2,$3}'
  [ -s "$CAMS_CONF" ] && { echo "등록됨 ($CAMS_CONF):"; sed 's/^/  /' "$CAMS_CONF"; }
  return 0
}

cmd_add() {
  local name=$1 mac user=$3 pass=$4 ip
  mac=$(echo "$2" | tr 'A-Z' 'a-z')
  [[ "$mac" =~ ^([0-9a-f]{2}:){5}[0-9a-f]{2}$ ]] || { echo "MAC 형식 오류: $mac"; exit 2; }
  [ ${#user} -ge 8 ] || echo "  ⚠ Tapo 는 유저명 8자 이상이어야 저장된다 ('$user' 는 ${#user}자)"
  echo "① 카메라 탐색 (MAC $mac)"; ip=$(ip_of_mac "$mac")
  [ -z "$ip" ] && { echo "  ✗ 응답 없음 — 카메라 전원·WiFi, 같은 서브넷인지 확인"; exit 3; }
  echo "  → $ip"
  echo "② RTSP 554"
  timeout 3 bash -c "</dev/tcp/$ip/554" 2>/dev/null && echo "  ✓ 열림" || { echo "  ✗ 닫힘 — Tapo 앱에서 '카메라 계정' 을 만들었는가"; exit 4; }
  echo "③ go2rtc 등록"; cp -a "$GO2RTC_YAML" "$GO2RTC_YAML.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null
  yaml_set_stream "$name" "rtsp://$user:$pass@$ip:554$RTSP_PATH#video=copy#audio=off"
  pm2 restart go2rtc --silent 2>/dev/null || pm2 start /usr/local/bin/go2rtc --name go2rtc -- -c "$GO2RTC_YAML" >/dev/null
  sleep 3
  frame_ok "$name" || { echo "  → 계정/비밀번호 또는 경로($RTSP_PATH) 확인. 직접: ffprobe -rtsp_transport tcp rtsp://$user:***@$ip:554$RTSP_PATH"; exit 5; }
  echo "④ 프로브 등록"; conf_set "$name" "$mac"
  sudo -n /usr/local/bin/smartfarm-camera-probe.sh 2>/dev/null && echo "  ✓ $CAMS_CONF + 지표 갱신"
  echo "⑤ 공유기 DHCP 예약 — 이걸 안 하면 IP 가 바뀌어 다시 죽는다:"
  echo "     MAC $mac  →  IP $ip   (공유기 관리자 → DHCP 수동 할당)"
  echo "   예약 전까지는 CameraIpDrift 알림이 표류를 알린다."
}

cmd_check() {
  [ -s "$CAMS_CONF" ] || { echo "등록된 카메라 없음"; exit 0; }
  local name mac cfg act
  while read -r name mac; do
    [ -z "$name" ] && continue
    cfg=$(cfg_ip "$name"); act=$(ip_of_mac "$mac")
    printf "%-6s 설정 %-15s 실제 %-15s %s\n" "$name" "${cfg:-?}" "${act:-없음}" \
      "$([ -n "$cfg" ] && [ "$cfg" = "$act" ] && echo 일치 || echo '⚠ 불일치 → add 로 갱신 + 공유기 예약')"
    frame_ok "$name" | sed 's/^/     /'
  done < "$CAMS_CONF"
}

cmd_remove() { yaml_del_stream "$1"; sudo -n sed -i "/^$1 /d" "$CAMS_CONF" 2>/dev/null; pm2 restart go2rtc --silent; echo "$1 제거"; }

case "${1:-}" in
  list)   cmd_list ;;
  add)    [ $# -eq 5 ] || { echo "사용: $0 add <name> <MAC> <user> <pass>"; exit 1; }; cmd_add "$2" "$3" "$4" "$5" ;;
  check)  cmd_check ;;
  remove) [ -n "${2:-}" ] || exit 1; cmd_remove "$2" ;;
  *)      sed -n '2,14p' "$0"; exit 1 ;;
esac
