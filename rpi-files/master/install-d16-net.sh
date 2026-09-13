#!/bin/bash
# 전광판 설정이 OS 계층까지 내려가게 하는 설치 스크립트 (2026-09-14)
set -u
P=/tmp/d16pkg
S=/home/lhk/smartfarm
STAMP=$(date +%Y%m%d-%H%M%S)
say() { echo "  $*"; }

echo "=== 1) 루트 래퍼 ==="
sudo install -o root -g root -m 0755 "$P/smartfarm-d16-net" /usr/local/sbin/smartfarm-d16-net && say "설치됨 /usr/local/sbin/smartfarm-d16-net"

echo "=== 2) sudoers (검증 후 배치) ==="
# 점으로 시작하는 이름은 sudo 가 무시하므로 검증 전에는 효력이 없다.
sudo install -o root -g root -m 0440 "$P/sudoers-smartfarm-d16" /etc/sudoers.d/.smartfarm-d16.new
if sudo visudo -cf /etc/sudoers.d/.smartfarm-d16.new >/dev/null 2>&1; then
  sudo mv /etc/sudoers.d/.smartfarm-d16.new /etc/sudoers.d/smartfarm-d16
  say "검증 통과 후 배치됨"
else
  sudo rm -f /etc/sudoers.d/.smartfarm-d16.new
  say "!! 문법 오류 — 배치하지 않음"
fi

echo "=== 3) dnsmasq 설정 (bind-dynamic) ==="
# 백업본은 /etc/dnsmasq.d/ 밖에 둬야 한다. dnsmasq 는 그 폴더의 모든 파일을 읽기 때문에
# 백업을 같은 폴더에 남기면 설정이 두 번 로드되어 "duplicate dhcp-host" 로 시작에 실패한다.
# 2026-09-14 에 실제로 이 함정을 밟았다.
if [ -f /etc/dnsmasq.d/d16-eth0.conf ]; then
  sudo mkdir -p /var/backups/smartfarm
  sudo cp -a /etc/dnsmasq.d/d16-eth0.conf "/var/backups/smartfarm/d16-eth0.conf.bak-$STAMP"
  say "기존본 백업 /var/backups/smartfarm/d16-eth0.conf.bak-$STAMP"
fi
sudo install -o root -g root -m 0644 "$P/dnsmasq-d16-eth0.conf" /etc/dnsmasq.d/d16-eth0.conf && say "교체됨"

echo "=== 4) 앱 파일 ==="
for pair in "local-config.js:$S/rpi-server/src/routes/local-config.js" "server.js:$S/rpi-server/src/server.js" "d16_daemon.py:$S/d16-display/d16_daemon.py"; do
  src="${pair%%:*}"; dst="${pair#*:}"
  [ -f "$dst" ] && cp -a "$dst" "$dst.bak-$STAMP"
  cp "$P/$src" "$dst" && say "갱신됨 $dst"
done
chmod +x "$S/d16-display/d16_daemon.py"

echo "=== 5) 서비스 재시작 ==="
pm2 restart smartfarm-rpi >/dev/null 2>&1 && say "smartfarm-rpi 재시작"
pm2 restart d16-display  >/dev/null 2>&1 && say "d16-display 재시작"
echo "=== 설치 끝 ==="
