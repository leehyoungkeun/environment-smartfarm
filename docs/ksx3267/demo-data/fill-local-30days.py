# -*- coding: utf-8 -*-
"""제어기 로컬 SQLite 에 기능시험용 30일 1분 데이터 채우기 (2026-09-28).

왜: 입고 시험장에는 인터넷도 SSH 도 없을 수 있다. 그때 「1분 단위 1/7/30일 조회」를 보이는 유일한 길이
    표준노드 탭 「제어기 로컬 저장」 카드(드라이버 SQLite)다. 서버 쪽은 fill-30days.sql 이 맡는다.

원칙 (server 쪽과 같다):
  1. **실측 행은 건드리지 않는다** — INSERT OR IGNORE, 빈 분만 채운다.
  2. 채운 행은 `source='simulated'` 로 표시한다. 조회·CSV 에 그대로 나온다.
  3. 값은 서버 채움과 같은 모양(일일 곡선) — 두 경로를 나란히 놓고 봐도 어색하지 않게.

실행 (RPi 1호):
    ~/smartfarm/ks3267/venv/bin/python fill-local-30days.py \
        --db ~/smartfarm/ks3267/ks3267d/state/snapshots.db --days 31
되돌리기:
    --rollback  (source='simulated' 행만 지운다)
"""
import argparse
import math
import os
import sqlite3
import time

SENSOR_UNIT = 2
# 디폴트맵 자리 17종 (신청서 연동장비표 ○ 와 같은 구성, 누적유량 제외) — 서버 fill-17sensors 와 같은 곡선
# idx, code, name, (최저, 최고), 일주기 위상(시간), 소수자리
SENSORS17 = [
    (1,  1,  "온도1",        (18.0, 28.0),   6,  2),
    (4,  2,  "습도1",        (45.0, 75.0),   18, 2),
    (5,  3,  "이슬점",       (8.0, 18.0),    6,  2),
    (6,  4,  "감우",         (0.0, 1.0),     0,  0),
    (8,  6,  "강우",         (0.0, 3.0),     0,  1),
    (9,  7,  "일사",         (0.0, 850.0),   6,  1),
    (10, 8,  "풍속",         (0.2, 4.5),     9,  2),
    (11, 9,  "풍향",         (0.0, 359.0),   3,  0),
    (12, 10, "전압",         (219.0, 228.0), 12, 1),
    (13, 11, "CO2",         (420.0, 900.0), 18, 0),
    (14, 12, "EC",          (1.1, 2.4),     6,  2),
    (15, 13, "광양자",       (0.0, 1450.0),  6,  0),
    (16, 14, "토양함수율",    (26.0, 38.0),   21, 1),
    (17, 15, "토양수분장력",  (6.0, 28.0),    9,  1),
    (18, 16, "pH",          (5.8, 6.6),     12, 2),
    (19, 17, "지온",         (17.0, 24.0),   9,  2),
    (29, 18, "무게1",        (1.6, 3.1),     6,  2),
]
SENSORS = [(i, c, n) for i, c, n, *_ in SENSORS17]     # 옛 인자 호환
ACT_UNIT = 1
ACTUATORS = [(1, "switch", 1, "스위치1"), (17, "opener", 1, "개폐기1")]  # idx, kind, n, name
KST = 9 * 3600


def value_for(lo, hi, phase_h, ts, idx, digits):
    """서버 fill-17sensors-30days.py 와 같은 공식 — 두 경로를 나란히 놓아도 어색하지 않게."""
    mid, amp = (lo + hi) / 2.0, (hi - lo) / 2.0
    daily = math.sin(2 * math.pi * (ts - phase_h * 3600) / 86400)
    noise = (((ts * (7919 + idx)) % 1000) / 1000.0 - 0.5) * amp * 0.12
    v = max(lo, min(hi, mid + amp * 0.85 * daily + noise))
    return round(v, digits) if digits else float(int(round(v)))


def hour_kst(ts):
    return int((ts + KST) % 86400 // 3600)


def sim_switch(ts):
    return (201, "ON") if hour_kst(ts) in (6, 7, 18, 19) else (0, "READY")


def sim_opener(ts):
    return (301, "OPENING") if hour_kst(ts) in (11, 12) else (0, "READY")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--days", type=int, default=31)
    ap.add_argument("--rollback", action="store_true")
    ap.add_argument("--end-now", action="store_true", help="어제 자정이 아니라 지금까지")
    a = ap.parse_args()

    if not os.path.exists(a.db):
        raise SystemExit(f"파일이 없습니다: {a.db}")
    c = sqlite3.connect(a.db, timeout=10)
    c.execute("PRAGMA journal_mode=WAL")

    # 드라이버가 아직 새 스키마로 안 올라왔을 수 있다 — 열이 없으면 여기서 더한다
    for tbl in ("sensor_minute", "actuator_minute"):
        cols = {r[1] for r in c.execute(f"PRAGMA table_info({tbl})")}
        if "source" not in cols:
            c.execute(f"ALTER TABLE {tbl} ADD COLUMN source TEXT")

    if a.rollback:
        with c:
            s = c.execute("DELETE FROM sensor_minute WHERE source = 'simulated'").rowcount
            t = c.execute("DELETE FROM actuator_minute WHERE source = 'simulated'").rowcount
        print(f"되돌림 — 센서 {s}행, 구동기 {t}행 삭제")
        return

    # 어제 자정(KST)까지 days 일
    now = time.time()
    end = int(now // 60) * 60 if a.end_now else (int((now + KST) // 86400)) * 86400 - KST
    start = end - a.days * 86400
    minutes = range(int(start), int(end), 60)

    srows, arows = [], []
    for ts in minutes:
        for idx, code, name, (lo, hi), ph, dg in SENSORS17:
            if idx == 6:    # 감우 — 새벽 3~5시만 1
                v = 1.0 if hour_kst(ts) in (3, 4) else 0.0
            elif idx == 8:  # 강우 — 같은 시간대만
                v = value_for(lo, hi, ph, ts, idx, dg) if hour_kst(ts) in (3, 4) else 0.0
            else:
                v = value_for(lo, hi, ph, ts, idx, dg)
            srows.append((ts, SENSOR_UNIT, idx, code, name, v, 0, "READY", "simulated"))
        for idx, kind, n, name in ACTUATORS:
            st, sn = sim_switch(ts) if kind == "switch" else sim_opener(ts)
            arows.append((ts, ACT_UNIT, idx, kind, n, name, 0, st, sn, 0, "simulated"))

    with c:
        c.executemany("INSERT OR IGNORE INTO sensor_minute (ts, unit, idx, code, name, value, status, status_name, source)"
                      " VALUES (?,?,?,?,?,?,?,?,?)", srows)
        c.executemany("INSERT OR IGNORE INTO actuator_minute (ts, unit, idx, kind, n, name, opid, status, status_name, remain, source)"
                      " VALUES (?,?,?,?,?,?,?,?,?,?,?)", arows)

    q = lambda sql: c.execute(sql).fetchone()[0]
    print(f"구간 {time.strftime('%Y-%m-%d', time.localtime(start))} ~ {time.strftime('%Y-%m-%d', time.localtime(end))}")
    print("센서  실측 %d · 채움 %d" % (q("SELECT count(*) FROM sensor_minute WHERE source IS NULL OR source <> 'simulated'"),
                                   q("SELECT count(*) FROM sensor_minute WHERE source = 'simulated'")))
    print("구동기 실측 %d · 채움 %d" % (q("SELECT count(*) FROM actuator_minute WHERE source IS NULL OR source <> 'simulated'"),
                                   q("SELECT count(*) FROM actuator_minute WHERE source = 'simulated'")))
    c.close()


if __name__ == "__main__":
    main()
