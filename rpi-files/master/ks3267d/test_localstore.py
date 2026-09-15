# -*- coding: utf-8 -*-
"""localstore — 제어기 로컬 1분 스냅샷 (2026-09-15). pymodbus 없이 돈다."""
import os
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


if __name__ == "__main__":
    unittest.main()
