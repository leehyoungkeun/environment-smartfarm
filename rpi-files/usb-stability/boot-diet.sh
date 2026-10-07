#!/bin/bash
# 제어기 부팅 다이어트 (2026-10-07) — 멱등, 재실행 안전.
#
# 왜: 전원을 켜면 데스크톱 OS 가 통째로 SD 카드를 콜드 로드한다. 12:08 부팅 실측으로
#   iowait 가 27초간 평균 2.6 CPU 분(4코어)이었고, 그 폭풍 안에 들어간 pm2 는 4초 대신
#   16~39초 걸려 타임아웃까지 갔다. 제어기에 없어도 되는 것들을 부팅에서 뺀다.
#   각 항목은 systemctl 한 줄이라 되돌리기 쉽다.
#
# 그대로 두는 것: ModemManager(LTE 백업 계획)·VNC·avahi·bluetooth·udisks2.
set -u

say() { echo "  $*"; }

echo "==> packagekit mask — 키오스크 세션의 업데이트 플러그인이 깨워 부팅마다 82% CPU 1분 (apt 는 그대로)"
sudo systemctl disable --now packagekit.service 2>/dev/null || true
sudo systemctl mask packagekit.service 2>/dev/null && say "masked"

echo "==> cloud-init 비활성 — 첫 부팅 전용인데 매 부팅 7유닛 python"
if cloud-init status 2>/dev/null | grep -q "done"; then
    sudo touch /etc/cloud/cloud-init.disabled && say "/etc/cloud/cloud-init.disabled"
else
    say "cloud-init 이 done 이 아니다 — 건너뜀 (첫 부팅 설정이 아직일 수 있음)"
fi

echo "==> prometheus-node-exporter-apt.timer — 부팅 직후(OnBootSec=0) apt 캐시 20초 → 10분 뒤로"
sudo mkdir -p /etc/systemd/system/prometheus-node-exporter-apt.timer.d
sudo tee /etc/systemd/system/prometheus-node-exporter-apt.timer.d/override.conf >/dev/null <<'EOF'
# 2026-10-07: 부팅 폭풍(SD 콜드 로드) 밖으로. 지표 갱신은 15분 주기 그대로.
[Timer]
OnBootSec=
OnBootSec=10min
EOF
say "OnBootSec=10min"

echo "==> e2scrub_reap 비활성 — LVM 없음, 부팅 때 20초"
sudo systemctl disable e2scrub_reap.service 2>/dev/null && say "disabled"

echo "==> cups 비활성 — 프린터 없음"
sudo systemctl disable --now cups.service cups.socket cups.path cups-browsed.service 2>/dev/null && say "disabled"

sudo systemctl daemon-reload
echo "==> 확인"
printf '  packagekit: %s\n' "$(systemctl is-enabled packagekit.service 2>&1)"
printf '  cloud-init: %s\n' "$([ -f /etc/cloud/cloud-init.disabled ] && echo disabled-file || echo active)"
printf '  apt timer OnBoot: %s\n' "$(systemctl show prometheus-node-exporter-apt.timer -p TimersMonotonic --value | grep -o 'OnBoot[A-Za-z]*=[^ ;]*' | head -1)"
printf '  e2scrub_reap: %s\n' "$(systemctl is-enabled e2scrub_reap.service 2>&1)"
printf '  cups: %s / cups-browsed: %s\n' "$(systemctl is-enabled cups.service 2>&1)" "$(systemctl is-enabled cups-browsed.service 2>&1)"
