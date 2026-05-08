#!/bin/bash
# rpi-files/usb-stability/install.sh
# RPi 1호에서 실행하여 USB 안정화 설정 일괄 적용.
#
# 사전 조건:
#   - 이 디렉토리 (rpi-files/usb-stability/) 가 RPi에 scp 로 복사되어 있어야 함
#   - sudo 권한 필요
#
# 멱등성: 재실행해도 안전함.

set -e

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="/home/lhk/smartfarm/logs"

echo "==> SmartFarm USB 안정화 설치"
echo "    소스: $SRC_DIR"

# 0) 로그/farm-id 디렉토리 보장
mkdir -p "$LOG_DIR"
if [ ! -f /home/lhk/smartfarm/.farm-id ]; then
    echo "farm_0001" > /home/lhk/smartfarm/.farm-id
fi

# 1) udev 규칙
echo "==> [1/6] udev 규칙 설치"
sudo cp "$SRC_DIR/99-smartfarm-485.rules" /etc/udev/rules.d/
sudo udevadm control --reload-rules

# 2) modprobe.d (USB autosuspend 비활성화 — modules 부팅 시 적용)
echo "==> [2/6] USB autosuspend 비활성화 (modprobe)"
sudo cp "$SRC_DIR/disable-usb-autosuspend.conf" /etc/modprobe.d/

# 3) /usr/local/bin 스크립트 설치
echo "==> [3/6] /usr/local/bin 스크립트 설치"
sudo install -m 0755 "$SRC_DIR/smartfarm-usb-event.sh" /usr/local/bin/smartfarm-usb-event.sh
sudo install -m 0755 "$SRC_DIR/smartfarm-modbus-healthcheck.sh" /usr/local/bin/smartfarm-modbus-healthcheck.sh
sudo install -m 0755 "$SRC_DIR/smartfarm-restart-nodered.sh" /usr/local/bin/smartfarm-restart-nodered.sh

# 4) /boot/firmware/cmdline.txt — usbcore.autosuspend=-1 (즉시 효과 없음, 다음 reboot 부터)
echo "==> [4/6] cmdline.txt 패치 (usbcore.autosuspend=-1)"
CMDLINE=/boot/firmware/cmdline.txt
[ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
if [ -f "$CMDLINE" ]; then
    if ! grep -q 'usbcore.autosuspend=-1' "$CMDLINE"; then
        sudo cp "$CMDLINE" "${CMDLINE}.bak.$(date +%s)"
        # cmdline.txt 는 한 줄. 끝에 공백+옵션 추가.
        sudo sed -i 's/$/ usbcore.autosuspend=-1/' "$CMDLINE"
        echo "    추가됨 (재부팅 시 적용)"
    else
        echo "    이미 적용됨"
    fi
else
    echo "    !! cmdline.txt 없음 — 수동 확인 필요"
fi

# 즉시 적용 (현재 부팅된 커널에는 sysfs 로 직접)
echo "==> 현재 USB 장치들의 power/control 을 'on' 으로 설정 (즉시 적용)"
for f in /sys/bus/usb/devices/*/power/control; do
    if [ -w "$f" ]; then echo on | sudo tee "$f" > /dev/null; fi
done

# 5) PM2 ecosystem.config.js
echo "==> [5/6] PM2 ecosystem.config.js 설치"
cp "$SRC_DIR/ecosystem.config.js" /home/lhk/smartfarm/ecosystem.config.js

# 6) crontab 등록 (lhk 사용자 — root 컨텍스트에서 호출돼도 lhk crontab 으로)
TARGET_USER="${SUDO_USER:-lhk}"
echo "==> [6/6] crontab 등록 (1분 헬스체크, user=$TARGET_USER)"
TMP_CRON=$(mktemp)
sudo -u "$TARGET_USER" crontab -l 2>/dev/null > "$TMP_CRON" || true
# 기존 항목 제거 후 다시 추가 (멱등)
grep -v 'smartfarm-modbus-healthcheck.sh' "$TMP_CRON" > "${TMP_CRON}.new" || true
mv "${TMP_CRON}.new" "$TMP_CRON"
echo "* * * * * /usr/local/bin/smartfarm-modbus-healthcheck.sh" >> "$TMP_CRON"
sudo -u "$TARGET_USER" crontab "$TMP_CRON"
rm "$TMP_CRON"

# udev trigger 로 새 규칙을 현재 연결된 USB 에 적용 → /dev/smartfarm-485 즉시 생성
echo "==> udev trigger (심볼릭 링크 즉시 생성)"
sudo udevadm trigger --action=change --subsystem-match=tty
sleep 1

echo ""
echo "✅ 설치 완료"
echo ""
echo "확인:"
echo "  ls -la /dev/smartfarm-485                         # ttyUSBn 가리키는 심볼릭 링크"
echo "  cat /sys/bus/usb/devices/*/power/control          # 'on' 이어야 함"
echo "  crontab -l | grep smartfarm-modbus-healthcheck"
echo "  ls -la /usr/local/bin/smartfarm-*.sh"
echo ""
echo "다음 단계 (수동):"
echo "  1. Node-RED 에디터에서 modbus-client 노드 옵션 갱신 (serialPort=/dev/smartfarm-485)"
echo "  2. 워치독 v3 코드 붙여넣기"
echo "  3. 헬스체크 플로우 import"
echo "  4. PM2 재시작: pm2 delete all && pm2 start ~/smartfarm/ecosystem.config.js && pm2 save"
echo "  5. (필요 시) sudo reboot — usbcore.autosuspend=-1 영구 반영"
