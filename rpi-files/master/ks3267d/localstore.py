# -*- coding: utf-8 -*-
"""제어기 로컬 1분 스냅샷 저장소 (SQLite) — SPS-7466 §5.4.4·KOAT 116 을 인터넷 없이 그 자리에서 보이기 위해 (2026-09-15).

왜:
  1분 저장·조회는 서버(api.smartgreen.kr)에 있다. 입고 시험장에 인터넷이 없으면 시험관 앞에서 "저장돼 있다" 를 보일 수 없다.
  드라이버는 어차피 매 폴링 상태를 갖고 있으니, 분이 바뀔 때마다 그 상태를 여기 남긴다. 서버 표(ks_sensor_status·actuator_status)와 같은 뜻.
원칙:
  - 값을 지어내지 않는다: 오류 상태(timeout·예외)나 3분 넘게 낡은 상태는 행을 만들지 않는다(= 결손으로 드러난다).
  - 한 분에 한 행(PRIMARY KEY), 같은 분에 두 번 불려도 중복 없음.
  - 보존 60일(로컬 SQLite 정리 정책과 같음). 파일 하나, 연결은 호출마다 새로 연다(API 서버가 다중 스레드).
  - pymodbus 를 import 하지 않는다 — 시험이 라이브러리 없이 돈다 (test_localstore.py).
"""
import csv
import io
import os
import sqlite3
import time

STALE_SEC = 180
SWITCH_COUNT = 16   # 구동기 디바이스 순번: 스위치 n → n, 개폐기 n → 16 + n (디폴트맵 A.2)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sensor_minute (
  ts INTEGER NOT NULL, unit INTEGER NOT NULL, idx INTEGER NOT NULL,
  code INTEGER, name TEXT, value REAL, status INTEGER NOT NULL, status_name TEXT,
  PRIMARY KEY (ts, unit, idx)
);
CREATE TABLE IF NOT EXISTS actuator_minute (
  ts INTEGER NOT NULL, unit INTEGER NOT NULL, idx INTEGER NOT NULL,
  kind TEXT, n INTEGER, name TEXT, opid INTEGER, status INTEGER NOT NULL, status_name TEXT, remain INTEGER,
  PRIMARY KEY (ts, unit, idx)
);
CREATE INDEX IF NOT EXISTS idx_sensor_minute_unit ON sensor_minute (unit, idx, ts);
CREATE INDEX IF NOT EXISTS idx_actuator_minute_unit ON actuator_minute (unit, idx, ts);
"""


def _iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + "Z"


class LocalStore:
    def __init__(self, path, retention_days=60, clock=None):
        self.path = path
        self.retention = int(retention_days) * 86400
        self.clock = clock or time.time
        self._last_minute = None
        self._last_prune = 0
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self):
        c = sqlite3.connect(self.path, timeout=5, check_same_thread=False)
        c.execute("PRAGMA journal_mode=WAL")
        return c

    # ── 기록 ────────────────────────────────────────────────────────
    def record(self, states, now=None):
        """states: master.state (unit → poll 결과). 분이 바뀌었을 때만 그 분의 행을 만든다. 반환 {minute, sensors, actuators} 또는 None(같은 분)."""
        now = self.clock() if now is None else now
        minute = int(now // 60) * 60
        if minute == self._last_minute:
            return None
        self._last_minute = minute
        srows, arows = [], []
        for unit, st in (states or {}).items():
            if not st or st.get("error"):
                continue
            t = float(st.get("t") or 0)
            if t <= 0 or now - t > STALE_SEC:
                continue
            u = int(unit)
            if st.get("kind") == "sensor":
                for idx, s in (st.get("sensors") or {}).items():
                    v = s.get("value")
                    srows.append((minute, u, int(idx), s.get("code"), s.get("name"),
                                  float(v) if isinstance(v, (int, float)) else None, int(s.get("status", 0)), s.get("status_name")))
            elif st.get("kind") == "actuator":
                for idx, d in (st.get("devices") or {}).items():
                    arows.append((minute, u, int(idx), d.get("kind"), d.get("n"), d.get("name"), int(d.get("opid") or 0),
                                  int(d.get("status", 0)), d.get("status_name"), int(d.get("remain") or 0)))
        with self._conn() as c:
            if srows:
                c.executemany("INSERT OR IGNORE INTO sensor_minute VALUES (?,?,?,?,?,?,?,?)", srows)
            if arows:
                c.executemany("INSERT OR IGNORE INTO actuator_minute VALUES (?,?,?,?,?,?,?,?,?,?)", arows)
        if now - self._last_prune > 3600:
            self.prune(now)
        return {"minute": minute, "sensors": len(srows), "actuators": len(arows)}

    def prune(self, now=None):
        now = self.clock() if now is None else now
        cut = int(now) - self.retention
        with self._conn() as c:
            a = c.execute("DELETE FROM sensor_minute WHERE ts < ?", (cut,)).rowcount
            b = c.execute("DELETE FROM actuator_minute WHERE ts < ?", (cut,)).rowcount
        self._last_prune = now
        return a + b

    # ── 조회 ────────────────────────────────────────────────────────
    def _range(self, start, end, now):
        end = float(end) if end else now
        start = float(start) if start else end - 3600
        return start, end

    def query_sensor(self, unit=None, idx=None, start=None, end=None, limit=5000):
        start, end = self._range(start, end, self.clock())
        sql = "SELECT ts, unit, idx, code, name, value, status, status_name FROM sensor_minute WHERE ts >= ? AND ts <= ?"
        p = [int(start), int(end)]
        if unit is not None:
            sql += " AND unit = ?"; p.append(int(unit))
        if idx:
            ids = [int(x) for x in str(idx).split(",") if str(x).strip()]
            sql += " AND idx IN (%s)" % ",".join("?" * len(ids)); p += ids
        sql += " ORDER BY ts, unit, idx LIMIT ?"; p.append(min(int(limit or 5000), 200000))
        with self._conn() as c:
            rows = c.execute(sql, p).fetchall()
        return [{"timestamp": _iso(r[0]), "unit": r[1], "idx": r[2], "code": r[3], "name": r[4], "value": r[5], "status": r[6], "status_name": r[7]} for r in rows]

    def query_actuator(self, unit=None, idx=None, start=None, end=None, limit=5000):
        start, end = self._range(start, end, self.clock())
        sql = "SELECT ts, unit, idx, kind, n, name, opid, status, status_name, remain FROM actuator_minute WHERE ts >= ? AND ts <= ?"
        p = [int(start), int(end)]
        if unit is not None:
            sql += " AND unit = ?"; p.append(int(unit))
        if idx:
            ids = [int(x) for x in str(idx).split(",") if str(x).strip()]
            sql += " AND idx IN (%s)" % ",".join("?" * len(ids)); p += ids
        sql += " ORDER BY ts, unit, idx LIMIT ?"; p.append(min(int(limit or 5000), 200000))
        with self._conn() as c:
            rows = c.execute(sql, p).fetchall()
        return [{"timestamp": _iso(r[0]), "unit": r[1], "idx": r[2], "kind": r[3], "n": r[4], "name": r[5], "opid": r[6],
                 "status": r[7], "status_name": r[8], "remain": r[9]} for r in rows]

    def summary(self, days=31):
        """날짜별(UTC 기준 아님 — 로컬 시각) 행 수: [{date, sensors, actuators}] — 30일 데이터 창을 현장에서 보는 용도"""
        cut = int(self.clock()) - int(days) * 86400
        with self._conn() as c:
            s = c.execute("SELECT date(ts, 'unixepoch', 'localtime') d, count(*) FROM sensor_minute WHERE ts >= ? GROUP BY d", (cut,)).fetchall()
            a = c.execute("SELECT date(ts, 'unixepoch', 'localtime') d, count(*) FROM actuator_minute WHERE ts >= ? GROUP BY d", (cut,)).fetchall()
        out = {}
        for d, n in s:
            out.setdefault(d, {"date": d, "sensors": 0, "actuators": 0})["sensors"] = n
        for d, n in a:
            out.setdefault(d, {"date": d, "sensors": 0, "actuators": 0})["actuators"] = n
        return [out[k] for k in sorted(out)]

    @staticmethod
    def to_csv(rows, columns):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(columns)
        for r in rows:
            w.writerow(["" if r.get(k) is None else r.get(k) for k in columns])
        return "﻿" + buf.getvalue()
