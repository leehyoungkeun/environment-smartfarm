#!/bin/bash
# → rpi-files/scripts/harden-access.sh  (provision 9c 가 호출; 1호는 2026-08-29 수동 적용)
# S1 — RPi 접근면 축소. SSH 키 전용 · VNC 소스 제한 · rpcbind 끔. 되돌리기: 아래 각 항목의 파일 삭제 + 서비스 재시작.
set -u
echo "━━ 1. SSH 키 전용 ━━"
echo "  cloud-init drop-in: $(grep -vE '^\s*#|^\s*$' /etc/ssh/sshd_config.d/50-cloud-init.conf 2>/dev/null | tr '\n' ' ')"
printf '%s\n' '# smartfarm (2026-08-29): 비밀번호 로그인 금지 — 키 인증만. 농가 현장에서 lhk 비밀번호가 곧 제어 권한이 되지 않게.' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' | sudo -n tee /etc/ssh/sshd_config.d/60-smartfarm.conf >/dev/null
if sudo -n sshd -t; then sudo -n systemctl reload ssh 2>/dev/null || sudo -n systemctl reload sshd; echo "  적용: $(sudo -n sshd -T | grep -E '^passwordauthentication')"; else echo "  ⚠ sshd -t 실패 — 되돌림"; sudo -n rm /etc/ssh/sshd_config.d/60-smartfarm.conf; fi

echo "━━ 2. rpcbind 끔 ━━"
sudo -n systemctl disable --now rpcbind.socket rpcbind.service >/dev/null 2>&1; sudo -n systemctl mask rpcbind.socket rpcbind.service >/dev/null 2>&1
echo "  111 리슨: $(ss -ltn | grep -c ':111 ')개 (0 이어야)"

echo "━━ 3. VNC(5900) 소스 제한 — LAN 사설망 + Tailscale 만 ━━"
sudo -n mkdir -p /etc/smartfarm
sudo -n tee /etc/smartfarm/firewall.nft >/dev/null <<'NFT'
# smartfarm 방화벽 (2026-08-29). Tailscale 이 관리하는 table ip filter 와 별개의 테이블 — 서로 건드리지 않는다.
# 정책: 5900(VNC) 은 사설망·Tailscale 에서만. 나머지는 기존대로.
table inet smartfarm
delete table inet smartfarm
table inet smartfarm {
  set trusted_v4 {
    type ipv4_addr; flags interval
    elements = { 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 }
  }
  chain input {
    type filter hook input priority filter - 1; policy accept;
    tcp dport 5900 ip saddr @trusted_v4 accept
    tcp dport 5900 ip6 saddr ::1 accept
    tcp dport 5900 counter drop comment "VNC: 사설망·Tailscale 외 차단"
  }
}
NFT
sudo -n tee /etc/systemd/system/smartfarm-firewall.service >/dev/null <<'UNIT'
[Unit]
Description=smartfarm nftables rules (VNC source restriction)
After=network-pre.target
Wants=network-pre.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -f /etc/smartfarm/firewall.nft
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
sudo -n systemctl daemon-reload && sudo -n systemctl enable --now smartfarm-firewall.service >/dev/null 2>&1
echo "  서비스: $(systemctl is-active smartfarm-firewall.service)  규칙: $(sudo -n nft list table inet smartfarm 2>/dev/null | grep -c dport)줄"
echo "  Tailscale 테이블 보존: $(sudo -n nft list ruleset | grep -c 'chain ts-input')"
