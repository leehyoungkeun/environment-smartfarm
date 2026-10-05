# -*- coding: utf-8 -*-
"""KOAT 116 기능시험용 — 표준 센서 17종 30일분 1분 데이터 생성 (2026-10-05).

왜: 신청서 연동장비표에 KS X 3267 센서 17종(누적유량 제외)을 ○ 로 선언했다. 심사에서
    「1분 단위 1/7/30일 조회」를 그 17종으로 보여 줘야 하는데, 실물 노드는 온도·습도뿐이다.
    116 의 조회 항목은 **기능시험**(조회가 되는지)이므로 임의값으로 시연한다(안내자료).

원칙 (앞선 채움과 같다 — farm_0006 사고 재발 방지):
  1. **실측 행은 건드리지 않는다.** 기존 온도(idx 1)·습도(idx 4)는 손대지 않고, 나머지 15종만 넣는다.
  2. 넣는 행은 전부 `source='simulated'` — 조회·CSV 에 그대로 보이고 30일 창 지표는 세지 않는다.
  3. 값은 종류마다 그럴듯한 일일 곡선 + 결정적 잡음(재실행해도 같은 값).

디폴트맵 자리(A.1.2): 1 온도1 · 4 습도1 · 5 이슬점 · 6 감우 · 8 강우 · 9 일사 · 10 풍속 · 11 풍향
                      · 12 전압 · 13 CO2 · 14 EC · 15 광양자 · 16 토양함수율 · 17 토양수분장력
                      · 18 pH · 19 지온 · 29 무게1

실행 (서버):
    python3 fill-17sensors-30days.py --days 31 | \
      docker exec -i postgres17 psql -U smartfarm -d smartfarm_db \
        -c "\\copy ks_sensor_status (timestamp,farm_id,unit,idx,code,name,value,status,status_name,house_id,sensor_id,source) FROM STDIN"
되돌리기: rollback-30days.sql (source='simulated' 행만 삭제)
"""
import argparse
import math
import sys
import time

FARM = "farm_0001"
HOUSE = "house_0003"
UNIT = 2
KST = 9 * 3600

# idx, 코드, 이름, sensor_id, (최저, 최고), 일주기 위상(시간), 소수자리
KINDS = [
    (5,  3,  "이슬점",       "ks_dewpoint",      (8.0, 18.0),    6, 2),
    (6,  4,  "감우",         "ks_rain_detect",   (0.0, 1.0),     0, 0),
    (8,  6,  "강우",         "ks_rainfall",      (0.0, 3.0),     0, 1),
    (9,  7,  "일사",         "ks_solar",         (0.0, 850.0),   6, 1),
    (10, 8,  "풍속",         "ks_wind_speed",    (0.2, 4.5),     9, 2),
    (11, 9,  "풍향",         "ks_wind_dir",      (0.0, 359.0),   3, 0),
    (12, 10, "전압",         "ks_voltage",       (219.0, 228.0), 12, 1),
    (13, 11, "CO2",         "ks_co2",           (420.0, 900.0), 18, 0),   # 낮에 낮아짐 → 위상 반대
    (14, 12, "EC",          "ks_ec",            (1.1, 2.4),     6, 2),
    (15, 13, "광양자",       "ks_ppfd",          (0.0, 1450.0),  6, 0),
    (16, 14, "토양함수율",    "ks_soil_moisture", (26.0, 38.0),   21, 1),
    (17, 15, "토양수분장력",  "ks_tensiometer",   (6.0, 28.0),    9, 1),
    (18, 16, "pH",          "ks_ph",            (5.8, 6.6),     12, 2),
    (19, 17, "지온",         "ks_soil_temp",     (17.0, 24.0),   9, 2),
    (29, 18, "무게1",        "ks_weight",        (1.6, 3.1),     6, 2),
]


def value_for(lo, hi, phase_h, ts, idx, digits):
    """일주기 사인 + 결정적 잡음. 감우(0/1)는 비 오는 시간대만 1."""
    mid, amp = (lo + hi) / 2.0, (hi - lo) / 2.0
    daily = math.sin(2 * math.pi * (ts - phase_h * 3600) / 86400)
    noise = (((ts * (7919 + idx)) % 1000) / 1000.0 - 0.5) * amp * 0.12
    v = mid + amp * 0.85 * daily + noise
    v = max(lo, min(hi, v))
    return round(v, digits) if digits else float(int(round(v)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=31)
    a = ap.parse_args()

    now = time.time()
    end = int((now + KST) // 86400) * 86400 - KST      # 오늘 00:00 KST
    start = end - a.days * 86400

    out = sys.stdout
    for ts in range(int(start), int(end), 60):
        iso = time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime(ts))
        for idx, code, name, sid, (lo, hi), ph, dg in KINDS:
            if idx == 6:   # 감우 — 새벽 3~5시에만 1
                h = int((ts + KST) % 86400 // 3600)
                v = 1.0 if h in (3, 4) else 0.0
            elif idx == 8:  # 강우 — 감우와 같은 시간대에만
                h = int((ts + KST) % 86400 // 3600)
                v = value_for(lo, hi, ph, ts, idx, dg) if h in (3, 4) else 0.0
            else:
                v = value_for(lo, hi, ph, ts, idx, dg)
            out.write(f"{iso}\t{FARM}\t{UNIT}\t{idx}\t{code}\t{name}\t{v}\t0\tREADY\t{HOUSE}\t{sid}\tsimulated\n")


if __name__ == "__main__":
    main()
