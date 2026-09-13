#!/bin/bash
# LED 전광판의 네트워크 계층을 켜고 끈다. 설정 화면의 「사용」 한 칸이 여기까지 내려온다.
#
# 왜 필요한가 (2026-09-14)
#   전광판은 농장마다 있기도 하고 없기도 한데, 전광판 전용 DHCP 서버(dnsmasq)와
#   이더넷 고정주소 프로필(eth0-d16)은 설정과 무관하게 항상 켜져 있었다. 그래서
#     (1) 랜선이 없는 농장에서는 dnsmasq 가 매 부팅 "unknown interface eth0" 로 죽고,
#     (2) 그 랜포트를 농장 공유기에 꽂으면 제어기가 169.254 주소를 뿌려
#         농장 네트워크의 DHCP 를 망가뜨릴 수 있었다.
#   앱 설정은 파이썬 데몬까지만 닿았고 이 두 계층에는 닿지 않았다.
#   사용하지 않는 농장에서는 두 계층 모두 완전히 내려가야 한다.
#
# 사용:  smartfarm-d16-net {on|off|status}
#   결과는 항상 JSON 한 줄. 호출한 rpi-server 가 그대로 화면에 돌려준다.
#   여러 번 실행해도 같은 결과가 되도록(멱등) 만들었다. 부팅 때마다 호출해도 안전하다.
set -u

ACTION="${1:-status}"
UNIT="dnsmasq"
CON="eth0-d16"

have_unit()    { systemctl list-unit-files "${UNIT}.service" --no-legend 2>/dev/null | grep -q .; }
have_profile() { nmcli -t -f NAME con show 2>/dev/null | grep -qx "$CON"; }

# 상태를 JSON 으로 찍고 끝낸다. 실패해도 값이 비지 않게 기본값을 둔다.
emit() {
  local applied="$1" note="$2"
  local active enabled auto carrier
  active=$(systemctl is-active  "$UNIT" 2>/dev/null || true);  active=${active:-unknown}
  enabled=$(systemctl is-enabled "$UNIT" 2>/dev/null || true); enabled=${enabled:-unknown}
  if have_profile; then
    auto=$(nmcli -g connection.autoconnect con show "$CON" 2>/dev/null || true)
  else
    auto="absent"
  fi
  auto=${auto:-unknown}
  carrier=$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo 0)
  printf '{"applied":"%s","dhcp":{"active":"%s","enabled":"%s"},"eth0":{"autoconnect":"%s","carrier":%s},"note":"%s"}\n' \
    "$applied" "$active" "$enabled" "$auto" "${carrier:-0}" "$note"
}

case "$ACTION" in
  on)
    note=""
    if have_profile; then
      nmcli con mod "$CON" connection.autoconnect yes >/dev/null 2>&1 || note="eth0 프로필 수정 실패"
      # 랜선이 꽂혀 있을 때만 올린다. 없으면 autoconnect 가 나중에 알아서 처리한다.
      if [ "$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo 0)" = "1" ]; then
        nmcli con up "$CON" >/dev/null 2>&1 || true
      fi
    else
      note="eth0-d16 프로필 없음"
    fi
    if have_unit; then
      systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
      systemctl enable "$UNIT"  >/dev/null 2>&1 || true
      # restart 로 설정 변경까지 반영한다. bind-dynamic 이라 랜선이 없어도 뜬다.
      systemctl restart "$UNIT" >/dev/null 2>&1 || note="${note:+$note / }dnsmasq 시작 실패"
    else
      note="${note:+$note / }dnsmasq 미설치"
    fi
    emit on "$note"
    ;;

  off)
    note=""
    if have_unit; then
      systemctl disable "$UNIT" >/dev/null 2>&1 || true
      systemctl stop    "$UNIT" >/dev/null 2>&1 || true
      # 실패 이력을 지운다. 안 지우면 systemctl --failed 에 계속 남아 진짜 장애를 가린다.
      systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
    fi
    if have_profile; then
      nmcli con mod  "$CON" connection.autoconnect no >/dev/null 2>&1 || note="eth0 프로필 수정 실패"
      nmcli con down "$CON" >/dev/null 2>&1 || true
    fi
    emit off "$note"
    ;;

  status)
    emit none ""
    ;;

  *)
    echo '{"error":"usage: smartfarm-d16-net {on|off|status}"}' >&2
    exit 2
    ;;
esac
