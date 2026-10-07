#!/bin/bash
# 제어기 복구 능력 실측 점검 (2026-10-06)
#
# 왜: 「구축 완료」 기록은 증거가 아니다. 2026-10-06 에 pm2 자동 복구가 **설정은 있는데
#     실제로는 안 되는** 상태로 17분간 농장이 멈췄다. 설정을 읽지 말고 **끝에서부터** 확인한다.
#
# 쓰는 법:
#     smartfarm-recovery-check.sh          # 읽기만 — 지금 상태 점검 (언제 돌려도 안전)
#     smartfarm-recovery-check.sh --reboot # 실제 재부팅 후 복구까지 확인 (월 1회, 농한기에)
set -u
PM2=/usr/bin/pm2
ok=0; ng=0
chk() { # 설명, 조건결과(0=통과)
    if [ "$2" = "0" ]; then echo "  ✅ $1"; ok=$((ok+1)); else echo "  ❌ $1"; ng=$((ng+1)); fi
}

echo "제어기 복구 점검 — $(date -Iseconds)"
echo
echo "[1] 지금 살아 있나 (파이프라인 끝에서부터)"
curl -s -m 8 -o /dev/null "http://127.0.0.1:1880/api/health"; chk "Node-RED 응답" $?
curl -s -m 8 -o /dev/null "http://127.0.0.1:3002/health"; chk "표준노드 드라이버(ks3267d) 응답" $?
curl -s -m 8 -o /dev/null "http://127.0.0.1:3001/health" 2>/dev/null || curl -s -m 8 -o /dev/null "http://127.0.0.1:3001/"; chk "rpi-server 응답" $?
N=$($PM2 jlist 2>/dev/null | python3 -c "import sys,json;print(sum(1 for x in json.load(sys.stdin) if x['pm2_env']['status']=='online'))" 2>/dev/null || echo 0)
[ "${N:-0}" -ge 7 ]; chk "pm2 online ${N}개 (7개 이상)" $?

echo
echo "[2] 자동 복구 장치가 켜져 있나"
systemctl is-enabled pm2-lhk >/dev/null 2>&1; chk "pm2-lhk 부팅 자동시작" $?
systemctl is-active pm2-lhk >/dev/null 2>&1; chk "pm2-lhk 동작 중" $?
systemctl is-active smartfarm-pm2-guard.timer >/dev/null 2>&1; chk "pm2 가드 타이머" $?
# resurrect 는 1초. 300초는 굳은 spawn 을 5분 기다리게 했다 (2026-10-07 11:31 부팅).
[ "$(systemctl show pm2-lhk -p TimeoutStartUSec --value)" = "1min" ]; chk "pm2-lhk 기동 타임아웃 60초 (굳으면 1분 안에 재시도)" $?
# Type=forking + PIDFile 이면 systemd 가 pm2 의 포크를 main PID 로 인정하지 못해
# 유닛이 영영 activating 에 머물고, 타임아웃이 오면 또 죽인다 (2026-10-07).
[ "$(systemctl show pm2-lhk -p Type --value)" = "oneshot" ]; chk "pm2-lhk Type=oneshot (forking 이면 기동 미완료로 굳음)" $?
[ -z "$(systemctl show pm2-lhk -p PIDFile --value)" ]; chk "pm2-lhk PIDFile 비어 있음" $?
# 부팅 경주 (2026-10-07 11:31): udev 콜드플러그로 usb-recover 가 pm2-lhk 보다 먼저 떠
# `pm2 jlist` 가 데몬을 띄우고 resurrect 데몬과 충돌 → 둘 다 영영 대기, 기동 5분 공백.
systemctl show "smartfarm-usb-recover@ttyUSB0" -p After --value 2>/dev/null | grep -q "pm2-lhk.service"; chk "usb-recover 가 pm2-lhk 뒤에 선다 (After=)" $?
grep -q 'is-active --quiet pm2-lhk' /usr/local/bin/smartfarm-usb-event.sh 2>/dev/null; chk "usb-event 가 pm2 CLI 전에 systemd 를 먼저 본다" $?
# 구조자가 피구조자를 기다리면 안 된다 — 가드가 After=pm2-lhk 면 굳은 start 뒤에 줄 선다.
! systemctl show smartfarm-pm2-guard.service -p After --value 2>/dev/null | grep -q "pm2-lhk.service"; chk "가드가 pm2-lhk 를 기다리지 않는다" $?
! grep -q 'systemctl restart pm2-lhk' /usr/local/bin/smartfarm-pm2-guard.sh 2>/dev/null; chk "가드가 restart(=pm2 kill) 대신 start 를 쓴다" $?
# pm2 가 network-online 뒤에 서면 WiFi 연결 시간이 pm2 를 SD 콜드 로드 폭풍 안으로 밀어 넣는다
# (2026-10-07 실측: 11초에 뜨면 4초, 24~31초에 뜨면 16~39초). nr-patches 가 그 사슬이었다.
! systemctl show smartfarm-nr-patches.service -p After --value 2>/dev/null | grep -q "network-online"; chk "pm2 사슬이 network-online 을 기다리지 않는다" $?
! systemctl show pm2-lhk.service -p After --value 2>/dev/null | grep -qw "network.target"; chk "pm2-lhk 가 network.target 을 기다리지 않는다 (NM 기동 8초가 SD 폭풍 안으로 밀었다)" $?
[ "$(systemctl is-enabled packagekit.service 2>/dev/null)" = "masked" ]; chk "packagekit 꺼짐 (부팅마다 82% CPU 1분이었다)" $?
# 트랩 7 유닛의 `pm2 save --force` 는 일부만 살아난 상태를 dump 에 굳힌다.
! systemctl show smartfarm-pm2-start.service -p ExecStartPost --value 2>/dev/null | grep -q 'save'; chk "pm2-start 가 부팅 때 dump 를 덮어쓰지 않는다" $?
crontab -l 2>/dev/null | grep -q modbus-healthcheck; chk "Modbus 헬스체크 cron" $?
test -f /etc/systemd/system/smartfarm-usb-recover@.service; chk "USB 복구 유닛" $?
grep -q SYSTEMD_WANTS /etc/udev/rules.d/99-smartfarm-485.rules 2>/dev/null; chk "udev 가 RUN+= 대신 유닛을 지명" $?

echo
echo "[3] 되살릴 목록이 최신인가"
D=$(python3 -c "import json;print(len(json.load(open('/home/lhk/.pm2/dump.pm2'))))" 2>/dev/null || echo 0)
[ "${D:-0}" -ge 7 ]; chk "dump.pm2 ${D}개 저장돼 있음" $?

echo
echo "[4] 수집이 실제로 들어오나"
AGE=$(curl -s -m 8 "http://127.0.0.1:1880/api/sensors/latest/$(cat /home/lhk/smartfarm/.farm-id 2>/dev/null || echo farm_0001)/house_0001" 2>/dev/null \
  | python3 -c "
import sys,json,datetime,time
try:
    d=json.load(sys.stdin)['data']
    ts=datetime.datetime.fromisoformat(d['timestamp'].replace('Z','+00:00')).timestamp()
    print(int(time.time()-ts))
except Exception: print(99999)" 2>/dev/null || echo 99999)
[ "${AGE:-99999}" -lt 300 ]; chk "마지막 센서 값 ${AGE}초 전 (5분 이내)" $?

echo
echo "────────────────────────────────"
echo "통과 $ok · 실패 $ng"
if [ "${1:-}" = "--reboot" ]; then
    [ "$ng" -gt 0 ] && { echo "지금도 실패가 있어 재부팅 시험을 하지 않습니다. 먼저 고치세요."; exit 1; }
    echo
    echo "⚠ 재부팅합니다. 3분 뒤 다시 이 스크립트를 (인자 없이) 돌려 모두 통과하는지 보세요."
    echo "   재부팅 중단하려면 10초 안에 Ctrl+C."
    sleep 10
    sudo reboot
fi
[ "$ng" -eq 0 ]
