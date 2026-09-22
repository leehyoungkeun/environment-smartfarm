# -*- coding: utf-8 -*-
"""localstore — 제어기 로컬 1분 스냅샷 (2026-09-15). pymodbus 없이 돈다."""
import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from localstore import LocalStore  # noqa: E402


class Clock:
    def __init__(self, t=1_800_000_000.0): self.t = t
    def __call__(self): return self.t


def states(t, sensor_err=False):
    return {
        2: {"error": "timeout"} if sensor_err else {"kind": "sensor", "t": t, "unit": 2, "sensors": {
            "1": {"name": "온도1", "code": 1, "value": 21.5, "status": 103, "status_name": "NEED_CHECK"},
            "4": {"name": "습도1", "code": 2, "value": 60.0, "status": 0, "status_name": "READY"}}},
        1: {"kind": "actuator", "t": t, "unit": 1, "devices": {
            "1": {"name": "스위치1", "kind": "switch", "n": 1, "opid": 7, "status": 201, "status_name": "ON", "remain": 12},
            "17": {"name": "개폐기1", "kind": "opener", "n": 1, "opid": 0, "status": 0, "status_name": "READY", "remain": 0}}},
    }


class Record(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.clk = Clock()
        self.s = LocalStore(os.path.join(self.dir, "snap.db"), retention_days=60, clock=self.clk)

    def test_one_row_per_minute_and_idempotent(self):
        r = self.s.record(states(self.clk.t))
        self.assertEqual((r["sensors"], r["actuators"]), (2, 2))
        self.assertIsNone(self.s.record(states(self.clk.t + 20)), "같은 분엔 다시 쓰지 않는다")
        self.clk.t += 60
        self.s._last_minute = None
        self.s.record(states(self.clk.t))            # 다음 분
        self.s._last_minute = None
        self.s.record(states(self.clk.t))            # 같은 분을 억지로 또 — PK 로 무시
        rows = self.s.query_sensor(unit=2, idx=1, start=self.clk.t - 120, end=self.clk.t + 1)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["status"], 103, "점검군 상태여도 값·상태 그대로 (생략하지 않는다)")
        self.assertEqual(rows[0]["value"], 21.5)

    def test_stale_or_error_state_makes_no_row(self):
        r = self.s.record(states(self.clk.t - 200))   # 3분 넘게 낡음
        self.assertEqual((r["sensors"], r["actuators"]), (0, 0))
        self.clk.t += 60
        r = self.s.record(states(self.clk.t, sensor_err=True))
        self.assertEqual(r["sensors"], 0, "오류 상태는 행을 만들지 않는다 = 결손으로 드러난다")
        self.assertEqual(r["actuators"], 2)

    def test_actuator_rows_and_query(self):
        self.s.record(states(self.clk.t))
        rows = self.s.query_actuator(unit=1, start=self.clk.t - 60, end=self.clk.t + 1)
        self.assertEqual([(r["idx"], r["kind"], r["n"], r["status"], r["remain"]) for r in rows], [(1, "switch", 1, 201, 12), (17, "opener", 1, 0, 0)])
        self.assertTrue(rows[0]["timestamp"].endswith("Z"))

    def test_prune_by_retention(self):
        old = self.clk.t - 61 * 86400
        self.s.record(states(old), now=old)
        self.s._last_minute = None
        self.s._last_prune = self.clk.t            # record 안의 시간당 자동 정리를 잠시 막고 명시 prune 을 본다
        self.s.record(states(self.clk.t))
        self.assertEqual(len(self.s.query_sensor(start=old - 1, end=self.clk.t + 1)), 4, "정리 전엔 옛 행도 있다")
        n = self.s.prune()
        self.assertEqual(n, 4, "60일 지난 센서 2 + 구동기 2 행 삭제")
        self.assertEqual(len(self.s.query_sensor(start=old - 1, end=self.clk.t + 1)), 2)
        # 자동 정리: 마지막 정리 뒤 1시간이 지나면 record 가 스스로 정리한다
        self.s._last_minute = None; self.s._last_prune = 0
        self.s.record(states(old), now=old)         # 옛 행을 다시 넣고
        self.s._last_minute = None
        self.clk.t += 60                            # 시계를 다음 분으로 (record 는 clock() 으로 분을 정한다)
        self.s.record(states(self.clk.t))           # 새 분 기록 → 자동 정리 발동
        self.assertEqual(len(self.s.query_sensor(start=old - 1, end=self.clk.t + 1)), 4, "옛 2행은 지워지고 새 4행만")

    def test_summary_and_csv(self):
        self.s.record(states(self.clk.t))
        sm = self.s.summary(days=2)
        self.assertEqual(len(sm), 1); self.assertEqual((sm[0]["sensors"], sm[0]["actuators"]), (2, 2))
        csv = LocalStore.to_csv(self.s.query_sensor(start=self.clk.t - 60), ["timestamp", "unit", "idx", "value", "status"])
        self.assertIn("온도", csv) if "name" in csv else None
        self.assertIn(",2,1,21.5,103", csv)
        self.assertTrue(csv.startswith("﻿"))




class CommandLog(unittest.TestCase):
    """명령 이력 로컬 저장 — 드라이버 재시작·정전 뒤에도 실노드 증적의 §5.5.2/5.5.3 명령 이력이 남는다 (2026-09-19)"""
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.clock = Clock()
        self.s = LocalStore(os.path.join(self.dir, "s.db"), clock=self.clock)

    def ev(self, t, **kw):
        base = {"t": t, "kind": "command", "unit": 1, "dev": "switch1", "op": 202, "opid": 7, "status": 201, "remain": 20, "accepted": True}
        base.update(kw); return base

    def test_log_and_query_roundtrip(self):
        self.s.log_command(self.ev(self.clock.t - 30))
        self.s.log_command(self.ev(self.clock.t - 10, kind="command_exception", op=203, opid=8, code=3, accepted=False, status=None, remain=None))
        rows = self.s.query_commands(unit=1, start=self.clock.t - 60, end=self.clock.t)
        self.assertEqual([r["op"] for r in rows], [202, 203])
        self.assertEqual(rows[0]["accepted"], True); self.assertEqual(rows[0]["status"], 201)
        self.assertEqual(rows[1]["kind"], "command_exception"); self.assertEqual(rows[1]["code"], 3); self.assertIsNone(rows[1]["status"])

    def test_query_filters_unit_and_window(self):
        self.s.log_command(self.ev(self.clock.t - 5, unit=2))
        self.s.log_command(self.ev(self.clock.t - 7200))
        self.s.log_command(self.ev(self.clock.t - 5))
        self.assertEqual(len(self.s.query_commands(unit=1)), 1)          # 기본 창 1시간
        self.assertEqual(len(self.s.query_commands()), 2)

    def test_survives_reopen(self):
        self.s.log_command(self.ev(self.clock.t - 1))
        again = LocalStore(self.s.path, clock=self.clock)
        self.assertEqual(len(again.query_commands(unit=1)), 1)

    def test_prune_removes_old(self):
        self.s.log_command(self.ev(self.clock.t - 61 * 86400))
        self.s.log_command(self.ev(self.clock.t - 1))
        self.s.prune()
        self.assertEqual(len(self.s.query_commands(unit=1, start=self.clock.t - 100 * 86400)), 1)


class CommandLogOriginMigration(unittest.TestCase):
    """9/19 첫 판 command_log(출처 열 없음)가 있는 파일도 열면 열이 더해지고, 출처가 저장·조회된다"""
    def test_old_table_gets_columns_and_origin_roundtrips(self):
        import sqlite3
        d = tempfile.mkdtemp(); path = os.path.join(d, "s.db")
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE command_log (ts REAL NOT NULL, unit INTEGER NOT NULL, dev TEXT, op INTEGER, opid INTEGER, "
                  "status INTEGER, remain INTEGER, accepted INTEGER, kind TEXT, code INTEGER)")
        c.execute("INSERT INTO command_log VALUES (1799999990, 1, 'switch1', 202, 7, 201, 20, 1, 'command', NULL)")
        c.commit(); c.close()
        clk = Clock()
        s = LocalStore(path, clock=clk)
        s.log_command({"t": clk.t - 5, "kind": "command", "unit": 1, "dev": "switch1", "op": 0, "opid": 8, "status": 0, "remain": 0,
                       "accepted": True, "src": "screen", "house": "house_0003", "device": "heater1", "by": "web_dashboard"})
        rows = s.query_commands(unit=1, start=clk.t - 100, end=clk.t)
        self.assertEqual([r["src"] for r in rows], ["direct", "screen"])      # 옛 행은 출처 미상 → direct
        self.assertEqual((rows[1]["house"], rows[1]["device"], rows[1]["by"]), ("house_0003", "heater1", "web_dashboard"))


class VendorActuator(unittest.TestCase):
    """비표준(벤더) 구동기 1분 행 — 표준과 같은 로컬 저장·보관 (2026-09-19 저장 정책 통일)"""
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.clock = Clock()
        self.s = LocalStore(os.path.join(self.dir, "s.db"), clock=self.clock)

    def row(self, t, dev="cooler1", status=201, **kw):
        import datetime as dt
        r = {"timestamp": dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat().replace("+00:00", "Z"), "houseId": "house_0001",
             "deviceId": dev, "unit": 2, "kind": "switch", "n": 4, "status": status, "statusName": "ON" if status else "READY"}
        r.update(kw); return r

    def test_record_query_and_dedupe(self):
        t = self.clock.t - 120
        self.assertEqual(self.s.record_vendor([self.row(t), self.row(t, dev="side_window1", kind="opener", status=301)]), 2)
        self.assertEqual(self.s.record_vendor([self.row(t)]), 0, "같은 분·장치 재전송이 중복 저장됐다")
        rows = self.s.query_vendor_actuator(house_id="house_0001")
        self.assertEqual(sorted((r["device_id"], r["status"], r["source"]) for r in rows),
                         [("cooler1", 201, "vendor"), ("side_window1", 301, "vendor")])

    def test_bad_rows_skipped(self):
        self.assertEqual(self.s.record_vendor([{"houseId": "h"}, {"timestamp": "x", "houseId": "h", "deviceId": "d", "status": 0}, None]), 0)

    def test_same_unit_as_standard_does_not_collide(self):
        """비표준 버스의 unit 2 와 표준 버스의 unit 2 는 다른 장치 — 표를 나눠 서로 덮지 않는다"""
        t = self.clock.t - 60
        self.s.record({2: {"kind": "actuator", "t": t, "unit": 2, "devices": {"4": {"name": "스위치4", "kind": "switch", "n": 4, "opid": 1, "status": 0, "status_name": "READY", "remain": 0}}}}, now=t)
        self.s.record_vendor([self.row(t)])
        self.assertEqual(len(self.s.query_actuator(unit=2)), 1)
        self.assertEqual(len(self.s.query_vendor_actuator()), 1)

    def test_retention_follows_server_setting_and_prunes_vendor(self):
        self.assertEqual(self.s.set_retention(30), 30)
        self.assertEqual(self.s.set_retention(3), 30, "7일 미만은 무시")
        self.assertEqual(self.s.set_retention("x"), 30)
        self.s.record_vendor([self.row(self.clock.t - 40 * 86400), self.row(self.clock.t - 60)])
        self.s.prune()
        self.assertEqual(len(self.s.query_vendor_actuator(start=self.clock.t - 100 * 86400)), 1)

    def test_summary_counts_vendor(self):
        self.s.record_vendor([self.row(self.clock.t - 60)])
        self.assertEqual(sum(d["vendorActuators"] for d in self.s.summary()), 1)


class ConnectionLifetime(unittest.TestCase):
    """SQLite 연결은 쓰고 나면 닫는다 — 2026-09-20 사고: 연결이 남아 fd 209개·RSS 244MB"""
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.s = LocalStore(os.path.join(self.dir, "s.db"), clock=Clock())

    def test_conn_closed_after_use(self):
        with self.s._conn() as c:
            c.execute("SELECT 1")
        with self.assertRaises(sqlite3.ProgrammingError):
            c.execute("SELECT 1")

    def test_repeated_calls_do_not_leak_open_connections(self):
        import gc
        for i in range(30):
            self.s.record_vendor([{ "timestamp": "2026-09-20T00:%02d:00Z" % (i % 60), "houseId": "h", "deviceId": "d",
                                    "unit": 2, "kind": "switch", "n": 1, "status": 0 }])
            self.s.query_vendor_actuator()
        gc.collect()
        live = [o for o in gc.get_objects() if isinstance(o, sqlite3.Connection)]
        self.assertLessEqual(len(live), 2, f"열린 연결 {len(live)}개가 남았다 — fd·메모리 누수")

    def test_error_inside_block_still_closes(self):
        try:
            with self.s._conn() as c:
                c.execute("SELECT * FROM nope")
        except sqlite3.OperationalError:
            pass
        with self.assertRaises(sqlite3.ProgrammingError):
            c.execute("SELECT 1")


if __name__ == "__main__":
    unittest.main()
