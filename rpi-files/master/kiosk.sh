#!/bin/bash
# SmartFarm 키오스크 (터치패널)
#
# 화면 절전 정책 — 무입력 KIOSK_BLANK_SEC 초 뒤 패널 전원 끔, 터치하면 다시 켜짐.
#   왜 DPMS 로 일원화하는가:
#     · X 스크린세이버 블랭킹은 화면만 검게 만들고 백라이트는 그대로 켜 둔다 → 발열·패널 수명에 손해.
#     · DPMS off 는 출력 자체를 내린다. 실측(2026-08-30, RPi 1호): 화면이 꺼지면 chromium CPU 4.8% → 0.2%.
#   깨우기: X 는 임의의 입력 이벤트로 DPMS 를 해제한다. 터치패널이 X 입력 장치(USB HID)로
#           잡혀 있으면 화면을 만지는 것만으로 복귀하며, 별도 데몬이 필요 없다.
#   ⚠ 이전 버전은 'xset s off; xset -dpms; xset s noblank' 로 절전을 전부 껐다.
#      화면이 24시간 켜진 채였고, 냉각 장치 없는 RPi 5 에서 발열 누적의 한 축이었다.
set -u
export DISPLAY="${DISPLAY:-:0}"

BLANK_SEC="${KIOSK_BLANK_SEC:-600}"   # 기본 10분

sleep 10

xset s off                       # 스크린세이버 블랭킹은 사용하지 않는다 (DPMS 로 일원화)
xset s noblank
xset +dpms
xset dpms 0 0 "$BLANK_SEC"       # standby=0 suspend=0 off=N초 (0 = 그 단계 사용 안 함)

unclutter -idle 3 &
xrandr --output HDMI-1 --mode 1024x600 2>/dev/null

# 자동 재시작 + 원격 디버깅 (PC 에서 chrome://inspect 접근)
while true; do
  chromium     --kiosk --force-device-scale-factor=1 --disable-features=Translate --lang=ko     --noerrdialogs     --disable-infobars     --disable-session-crashed-bubble     --disable-component-update     --check-for-update-interval=31536000     --remote-debugging-port=9222     --remote-allow-origins=*     'http://localhost'
  sleep 5
done
