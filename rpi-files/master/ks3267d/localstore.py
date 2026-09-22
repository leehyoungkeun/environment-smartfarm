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
import contextlib
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
CREATE TABLE IF NOT EXISTS command_log (
  ts REAL NOT NULL, unit INTEGER NOT NULL, dev TEXT, op INTEGER, opid INTEGER,
  status INTEGER, remain INTEGER, accepted INTEGER, kind TEXT, code INTEGER,
  src TEXT, house TEXT, device TEXT, actor TEXT
);
CREATE INDEX IF NOT EXISTS idx_command_log_unit ON command_log (unit, ts);
CREATE TABLE IF NOT EXISTS vendor_actuator_minute (
  ts INTEGER NOT NULL, house_id TEXT NOT NULL, device_id TEXT NOT NULL,
  unit INTEGER, kind TEXT, n INTEGER, name TEXT, opid INTEGER, status INTEGER NOT NULL, status_name TEXT, remain INTEGER,
  PRIMARY KEY (ts, house_id, device_id)
);
"""


def _iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + "Z"


def _parse_iso(v):
    """'2026-09-19T12:34:00.000Z' → epoch 초 (UTC)"""
    import datetime as _dt
    return _dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp()


def _int(v):
    try:
        return None if v is None else int(v)
    except (TypeError, ValueError):
        return None


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
            # 9/19 첫 판 command_log 에는 출처 열이 없다 — 있는 파일은 열만 더한다
            have = {r[1] for r in c.execute("PRAGMA table_info(command_log)")}
            for col in ("src", "house", "device", "actor"):
                if col not in have:
                    c.execute(f"ALTER TABLE command_log ADD COLUMN {col} TEXT")

    @contextlib.contextmanager
    def _conn(self):
        """연결을 열고 — 커밋(또는 롤백) 후 **반드시 닫는다**.
        2026-09-20: 예전엔 `with sqlite3.connect(...)` 를 그대로 돌려줬는데, sqlite3 의 with 는 트랜잭션만 끝내고
        연결은 닫지 않는다. 호출마다 연결이 남아 파일 핸들이 분당 십여 개씩 늘고(2일 만에 209개),
        연결별 페이지 캐시로 RSS 가 244 MB 까지 불었다. 데몬은 API 서버라 스레드마다 새로 연다."""
        c = sqlite3.connect(self.path, timeout=5, check_same_thread=False)
        try:
            c.execute("PRAGMA journal_mode=WAL")
            with c:
                yield c
        finally:
            c.close()

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

    def log_command(self, ev, now=None):
        """명령 이벤트(master._event 의 command/write_opid/command_exception/command_timeout)를 남긴다 — 드라이버를 재시작하거나
        제어기를 껐다 켜도 실노드 증적(§5.5.2/5.5.3 명령 이력)이 살아남게 (2026-09-19). 반환: 저장한 행 수"""
        t = float(ev.get("t") or (self.clock() if now is None else now))
        row = (t, int(ev.get("unit") or 0), str(ev.get("dev") or ""), _int(ev.get("op")), _int(ev.get("opid")),
               _int(ev.get("status")), _int(ev.get("remain")), 1 if ev.get("accepted") else 0, str(ev.get("kind") or "command"), _int(ev.get("code")),
               str(ev.get("src") or "direct"), ev.get("house"), ev.get("device"), ev.get("by"))
        with self._conn() as c:
            c.execute("INSERT INTO command_log (ts, unit, dev, op, opid, status, remain, accepted, kind, code, src, house, device, actor) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row)
        return 1

    def query_commands(self, unit=None, start=None, end=None, limit=500):
        """명령 이력 (시간순). 반환 행은 master.events 의 명령 이벤트와 같은 키 — evidence 가 둘을 같은 코드로 읽는다."""
        start, end = self._range(start, end, self.clock())
        sql = "SELECT ts, unit, dev, op, opid, status, remain, accepted, kind, code, src, house, device, actor FROM command_log WHERE ts >= ? AND ts <= ?"
        p = [float(start), float(end)]
        if unit is not None:
            sql += " AND unit = ?"; p.append(int(unit))
        sql += " ORDER BY ts LIMIT ?"; p.append(min(int(limit or 500), 20000))
        with self._conn() as c:
            rows = c.execute(sql, p).fetchall()
        return [{"t": r[0], "unit": r[1], "dev": r[2], "op": r[3], "opid": r[4], "status": r[5], "remain": r[6],
                 "accepted": bool(r[7]), "kind": r[8], "code": r[9], "src": r[10] or "direct",
                 "house": r[11], "device": r[12], "by": r[13]} for r in rows]

    # ── 비표준(벤더) 구동기 1분 행 (2026-09-19 표준·비표준 저장 통일) ─────────────
    # NR 「1분 스냅샷」이 매분 실제 릴레이 코일 상태로 만든 행을 넘긴다(POST /local/vendor-actuator).
    # 비표준은 버스가 달라 unit·n 이 표준과 겹칠 수 있어 표준 actuator_minute 과 따로 둔다 — 키는 하우스·장치.
    MIN_RETENTION_DAYS, MAX_RETENTION_DAYS = 7, 3650

    def record_vendor(self, rows, now=None):
        """rows: [{timestamp(ISO), houseId, deviceId, unit, kind, n, status, statusName, remain, opid}] → 저장 행 수(중복은 무시)"""
        out = []
        for r in rows or []:
            try:
                ts = int(_parse_iso(r["timestamp"]) // 60 * 60)
                out.append((ts, str(r["houseId"]), str(r["deviceId"]), _int(r.get("unit")), r.get("kind"), _int(r.get("n")),
                            r.get("name") or r.get("deviceId"), _int(r.get("opid")) or 0, int(r["status"]),
                            r.get("statusName") or r.get("status_name"), _int(r.get("remain")) or 0))
            except (KeyError, TypeError, ValueError):
                continue
        if not out:
            return 0
        with self._conn() as c:
            before = c.total_changes
            c.executemany("INSERT OR IGNORE INTO vendor_actuator_minute VALUES (?,?,?,?,?,?,?,?,?,?,?)", out)
            return c.total_changes - before

    def query_vendor_actuator(self, house_id=None, device_id=None, start=None, end=None, limit=5000):
        start, end = self._range(start, end, self.clock())
        sql = ("SELECT ts, house_id, device_id, unit, kind, n, name, opid, status, status_name, remain "
               "FROM vendor_actuator_minute WHERE ts >= ? AND ts <= ?")
        p = [int(start), int(end)]
        if house_id:
            sql += " AND house_id = ?"; p.append(str(house_id))
        if device_id:
            sql += " AND device_id = ?"; p.append(str(device_id))
        sql += " ORDER BY ts, house_id, device_id LIMIT ?"; p.append(min(int(limit or 5000), 200000))
        with self._conn() as c:
            rows = c.execute(sql, p).fetchall()
        return [{"timestamp": _iso(r[0]), "house_id": r[1], "device_id": r[2], "unit": r[3], "kind": r[4], "n": r[5], "name": r[6],
                 "opid": r[7], "status": r[8], "status_name": r[9], "remain": r[10], "source": "vendor"} for r in rows]

    def set_retention(self, days):
        """보관 일수를 서버 설정(NR 전역 retentionDays)과 맞춘다. 범위 밖이면 무시. 반환: 적용된 일수"""
        try:
            d = int(days)
        except (TypeError, ValueError):
            return self.retention // 86400
        if self.MIN_RETENTION_DAYS <= d <= self.MAX_RETENTION_DAYS:
            self.retention = d * 86400
        return self.retention // 86400

    def prune(self, now=None):
        now = self.clock() if now is None else now
        cut = int(now) - self.retention
        with self._conn() as c:
            a = c.execute("DELETE FROM sensor_minute WHERE ts < ?", (cut,)).rowcount
            b = c.execute("DELETE FROM actuator_minute WHERE ts < ?", (cut,)).rowcount
            c.execute("DELETE FROM command_log WHERE ts < ?", (cut,))
            v = c.execute("DELETE FROM vendor_actuator_minute WHERE ts < ?", (cut,)).rowcount
        self._last_prune = now
        return a + b + v

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
            v = c.execute("SELECT date(ts, 'unixepoch', 'localtime') d, count(*) FROM vendor_actuator_minute WHERE ts >= ? GROUP BY d", (cut,)).fetchall()
        out = {}
        blank = lambda d: {"date": d, "sensors": 0, "actuators": 0, "vendorActuators": 0}
        for d, n in s:
            out.setdefault(d, blank(d))["sensors"] = n
        for d, n in a:
            out.setdefault(d, blank(d))["actuators"] = n
        for d, n in v:
            out.setdefault(d, blank(d))["vendorActuators"] = n
        return [out[k] for k in sorted(out)]

    @staticmethod
    def to_csv(rows, columns):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(columns)
        for r in rows:
            w.writerow(["" if r.get(k) is None else r.get(k) for k in columns])
        return "﻿" + buf.getvalue()
