# -*- coding: utf-8 -*-
"""evidence — 실노드 증적 묶음 (2026-09-19). pymodbus 없이 가짜 master·store 로 돈다."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evidence as ev  # noqa: E402
from localstore import LocalStore  # noqa: E402

NOW = 1_800_000_000.0


class Frames:
    stats = {"tx": 10, "rx": 9, "exceptions": 0, "timeouts": 1}
    def recent(self, n): return [{"t": NOW - 1, "dir": "TX", "hex": "01 03 00 CA 00 5B"}, {"t": NOW - 0.9, "dir": "RX", "hex": "01 03 B6 00 00"}][:n]


class T:
    desc = "rtu /dev/smartfarm-485-std 9600 8N1"
    frames = Frames()


class FakeMaster:
    def __init__(self, kind="sensor"):
        self.t = T()
        self.nodes, self.state, self.changes, self.events = {}, {}, {}, []
        if kind == "sensor":
            self.nodes[1] = {"unit": 1, "kind": "sensor", "cert_authority": 0, "company_code": 0, "product_type": 1, "product_code": 0,
                             "protocol_version": 10, "channels": 30, "default_map": True, "supported": True, "notes": [],
                             "devices": [{"index": 1, "code": 1, "name": "온도1"}, {"index": 4, "code": 2, "name": "습도1"}]}
            self.state[1] = {"kind": "sensor", "t": NOW - 1, "unit": 1, "node_status": 0, "node_status_name": "READY", "sensors": {
                1: {"name": "온도1", "code": 1, "value": 25.69, "status": 0, "status_name": "READY"},
                4: {"name": "습도1", "code": 2, "value": 60.97, "status": 0, "status_name": "READY"}}}
            self.changes[1] = [{"t": NOW - 30, "index": 1, "name": "온도1", "value": 25.5, "status": 0, "status_name": "READY", "prev_value": 25.4, "prev_status": 0, "what": "value"},
                               {"t": NOW - 3, "index": 1, "name": "온도1", "value": 25.69, "status": 0, "status_name": "READY", "prev_value": 25.5, "prev_status": 0, "what": "value"}]
        else:
            self.nodes[1] = {"unit": 1, "kind": "actuator", "cert_authority": 0, "company_code": 0, "product_type": 2, "product_code": 0,
                             "protocol_version": 10, "channels": 24, "default_map": True, "supported": True, "notes": [],
                             "devices": [{"index": 1, "code": 102, "kind": "switch", "n": 1, "name": "스위치1"}, {"index": 17, "code": 112, "kind": "opener", "n": 1, "name": "개폐기1"}]}
            self.state[1] = {"kind": "actuator", "t": NOW - 1, "unit": 1, "node_opid": 0, "node_status": 0, "node_status_name": "READY", "devices": {
                1: {"name": "스위치1", "kind": "switch", "n": 1, "opid": 7, "status": 201, "status_name": "ON", "remain": 12},
                17: {"name": "개폐기1", "kind": "opener", "n": 1, "opid": 0, "status": 0, "status_name": "READY", "remain": 0}}}
            self.events = [{"t": NOW - 20, "kind": "command", "unit": 1, "dev": "switch1", "op": 202, "opid": 7, "status": 201, "remain": 20, "accepted": True}]


def conntest(ok=True):
    return {"rows": [{"step": "a", "ok": ok, "actual": "rtu … · 열림"}, {"step": "b", "ok": True, "actual": "9600 bps · 8N1 · RTU"},
                     {"step": "c", "ok": True, "actual": "1"}, {"step": "d", "ok": ok, "actual": "센서 노드 · 프로토콜 10 · 채널 30", "note": None}],
            "prep": [{"title": "표준 포트 인식", "ok": True, "detail": "ttyUSB0"}, {"title": "안내", "ok": None, "detail": "x"}], "passed": ok}


def fill_store(store, unit, minutes, kind="sensor"):
    """minutes 개의 분에 걸쳐 1분 스냅샷을 기록한다 (마지막 분이 NOW)"""
    for i in range(minutes):
        t = NOW - (minutes - 1 - i) * 60
        store.clock.t = t
        if kind == "sensor":
            store.record({unit: {"kind": "sensor", "t": t, "unit": unit, "sensors": {"1": {"name": "온도1", "code": 1, "value": 25.0 + i * 0.1, "status": 0, "status_name": "READY"}}}}, now=t)
        else:
            store.record({unit: {"kind": "actuator", "t": t, "unit": unit, "devices": {"1": {"name": "스위치1", "kind": "switch", "n": 1, "opid": 7, "status": 201, "status_name": "ON", "remain": 1}}}}, now=t)


class Clock:
    def __init__(self, t=NOW): self.t = t
    def __call__(self): return self.t


class Build(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = LocalStore(os.path.join(self.dir, "s.db"), clock=Clock())

    def test_sensor_all_pass_with_10_minutes(self):
        fill_store(self.store, 1, 11)
        self.store.clock.t = NOW
        e = ev.build(FakeMaster("sensor"), self.store, {"desc": "rtu x", "mode": "serial"}, conntest(), 1, now=NOW)
        ids = [r["id"] for r in e["results"]]
        self.assertEqual(ids, ["5.4.1", "5.4.2", "5.4.3", "5.4.4"])
        self.assertEqual(e["passed"], 4, json.dumps(e["results"], ensure_ascii=False)[:800])
        self.assertEqual(e["meta"]["kind"], "sensor")
        self.assertTrue(e["id"].startswith("realnode-"))
        steps = {s["step"]: s for s in e["results"][1]["steps"]}
        self.assertIn("d) 연결된 디바이스 2개 — 온도 1 · 습도 1", steps)

    def test_sensor_store_short_fails_544_only(self):
        fill_store(self.store, 1, 4)
        self.store.clock.t = NOW
        e = ev.build(FakeMaster("sensor"), self.store, {"desc": "rtu x"}, conntest(), 1, now=NOW)
        by = {r["id"]: r for r in e["results"]}
        self.assertFalse(by["5.4.4"]["ok"])
        self.assertIn("4/10분", by["5.4.4"]["steps"][0]["detail"])
        self.assertTrue(by["5.4.3"]["ok"])
        self.assertEqual(e["passed"], 3)

    def test_no_changes_fails_543(self):
        m = FakeMaster("sensor"); m.changes = {}
        fill_store(self.store, 1, 11)
        e = ev.build(m, self.store, {"desc": "rtu x"}, conntest(), 1, now=NOW)
        by = {r["id"]: r for r in e["results"]}
        self.assertFalse(by["5.4.3"]["ok"])
        self.assertIn("변화 없음", " ".join(s["detail"] for s in by["5.4.3"]["steps"]))

    def test_conntest_failure_propagates(self):
        e = ev.build(FakeMaster("sensor"), None, {"desc": "tcp"}, conntest(ok=False), 1, now=NOW)
        by = {r["id"]: r for r in e["results"]}
        self.assertFalse(by["5.4.1"]["ok"])
        self.assertFalse(by["5.4.4"]["ok"])   # store None
        self.assertIn("로컬 저장소", by["5.4.4"]["steps"][0]["step"])

    def test_wrong_protocol_version_fails_542(self):
        m = FakeMaster("sensor"); m.nodes[1]["protocol_version"] = 101
        e = ev.build(m, None, {"desc": "x"}, conntest(), 1, now=NOW)
        by = {r["id"]: r for r in e["results"]}
        self.assertFalse(by["5.4.2"]["ok"])
        bad = [s for s in by["5.4.2"]["steps"] if not s["ok"]]
        self.assertEqual(len(bad), 1); self.assertIn("프로토콜 버전 10", bad[0]["step"])

    def _screen(self, t, dev, op, status, remain, opid, **kw):
        e = {"t": t, "kind": "command", "unit": 1, "dev": dev, "op": op, "opid": opid, "status": status, "remain": remain,
             "accepted": True, "src": "screen", "house": "house_0003", "device": "heater1" if dev.startswith("switch") else "window1", "by": "web_dashboard"}
        e.update(kw)
        self.store.log_command(e)

    def _full_screen_run(self):
        self._screen(NOW - 40, "switch1", 202, 201, 20, 11)
        self._screen(NOW - 35, "switch1", 0, 0, 0, 12)          # 5초 뒤 작동 중 중지
        self._screen(NOW - 30, "opener1", 303, 301, 20, 13)
        self._screen(NOW - 25, "opener1", 0, 0, 0, 14)
        self._screen(NOW - 20, "opener1", 304, 302, 20, 15)
        self._screen(NOW - 15, "opener1", 0, 0, 0, 16)

    def _act(self, m=None):
        fill_store(self.store, 1, 11, kind="actuator")
        self.store.clock.t = NOW
        return ev.build(m or FakeMaster("actuator"), self.store, {"desc": "rtu x"}, conntest(), 1, now=NOW)

    def test_actuator_full_screen_sequences_pass(self):
        self._full_screen_run()
        e = self._act()
        self.assertEqual([r["id"] for r in e["results"]], ["5.4.1", "5.5.1", "5.5.2", "5.5.3", "116-저장"])
        self.assertEqual(e["passed"], 5, json.dumps(e["results"], ensure_ascii=False)[:1200])
        steps = {s["step"]: s for s in e["results"][1]["steps"]}
        self.assertIn("d) 연결된 디바이스 2개 — 스위치 1 · 개폐기 1", steps)
        b = [s for s in e["results"][2]["steps"] if s["step"].startswith("b)")][0]
        self.assertIn("5초 뒤", b["detail"]); self.assertIn("READY", b["detail"])
        lines = [s["step"] for s in e["results"][3]["steps"] if s["step"].startswith("   ")]
        self.assertTrue(all("[화면 house_0003 window1 by web_dashboard]" in x for x in lines), lines)

    def test_commands_survive_restart_via_store(self):
        """드라이버 재시작으로 메모리 이벤트가 비어도 로컬 SQLite 의 명령 이력으로 판정한다 (2026-09-19 18:26 사고)"""
        self._full_screen_run()
        m = FakeMaster("actuator"); m.events = []
        self.assertEqual(self._act(m)["passed"], 5)

    def test_direct_commands_do_not_count(self):
        """출처가 없는 명령(드라이버 API 직접)은 이력에 [직접] 으로만 보이고 판정엔 안 쓴다 (18:30 시험 명령이 섞였던 문제)"""
        for i, (dev, op, st) in enumerate([("switch1", 202, 201), ("switch1", 0, 0)]):
            self.store.log_command({"t": NOW - 30 + i * 3, "kind": "command", "unit": 1, "dev": dev, "op": op, "opid": 20 + i,
                                    "status": st, "remain": 20 if op else 0, "accepted": True})
        e = self._act()
        r = {x["id"]: x for x in e["results"]}["5.5.2"]
        self.assertFalse(r["ok"])
        self.assertIn("화면 경로 명령이 없습니다", " ".join(s["detail"] for s in r["steps"]))
        self.assertTrue(any("[직접(드라이버 API)]" in s["step"] for s in r["steps"]))

    def test_automation_commands_do_not_count(self):
        self._screen(NOW - 40, "switch1", 202, 201, 20, 11, src="auto", by="automation")
        self._screen(NOW - 35, "switch1", 0, 0, 0, 12, src="auto", by="automation")
        r = {x["id"]: x for x in self._act()["results"]}["5.5.2"]
        self.assertFalse(r["ok"])
        self.assertTrue(any("[자동제어 house_0003 heater1 by automation]" in s["step"] for s in r["steps"]))

    def test_timed_then_natural_expiry_is_not_a_stop(self):
        self._screen(NOW - 40, "switch1", 202, 201, 5, 11)
        self._screen(NOW - 20, "switch1", 0, 0, 0, 12)          # 만료(5초) 뒤의 OFF — 작동 중 중지가 아님
        r = {x["id"]: x for x in self._act()["results"]}["5.5.2"]
        self.assertFalse(r["ok"])
        self.assertIn("작동 중에 중지한 기록이 없습니다", " ".join(s["detail"] for s in r["steps"]))

    def test_opener_needs_both_open_and_close_stops(self):
        self._screen(NOW - 30, "opener1", 303, 301, 20, 13)
        self._screen(NOW - 25, "opener1", 0, 0, 0, 14)
        r = {x["id"]: x for x in self._act()["results"]}["5.5.3"]
        self.assertFalse(r["ok"])
        bad = [s["step"] for s in r["steps"] if not s["ok"]]
        self.assertEqual(len(bad), 1); self.assertIn("304", bad[0])

    def test_rejected_screen_command_fails(self):
        self._full_screen_run()
        self._screen(NOW - 5, "switch1", 202, None, None, 30, kind="command_exception", accepted=False, code=3)
        r = {x["id"]: x for x in self._act()["results"]}["5.5.2"]
        self.assertFalse(r["ok"])
        self.assertIn("command_exception", [s for s in r["steps"] if s["step"].startswith("c)")][0]["detail"])

    def test_no_store_falls_back_to_memory_events(self):
        m = FakeMaster("actuator")
        m.events = [dict(e, src="screen") for e in [
            {"t": NOW - 20, "kind": "command", "unit": 1, "dev": "switch1", "op": 202, "opid": 7, "status": 201, "remain": 20, "accepted": True},
            {"t": NOW - 18, "kind": "command", "unit": 1, "dev": "switch1", "op": 0, "opid": 8, "status": 0, "remain": 0, "accepted": True}]]
        e = ev.build(m, None, {"desc": "x"}, conntest(), 1, now=NOW)
        self.assertTrue({x["id"]: x for x in e["results"]}["5.5.2"]["ok"])

    def test_store_without_commands_fails_552(self):
        r = {x["id"]: x for x in self._act()["results"]}
        self.assertFalse(r["5.5.2"]["ok"]); self.assertFalse(r["5.5.3"]["ok"])

    def test_write_frames_are_kept_in_frames_txt(self):
        class F(Frames):
            def recent(self, n): return [{"t": NOW - 1, "dir": "TX", "hex": "01 03 00 C9 00 62 14 1D"}]
            def recent_writes(self, n): return [{"t": NOW - 600, "dir": "TX", "hex": "01 10 01 F7 00 04 08 00 CA 00 FF 00 14 00 00 3C 2D"},
                                                {"t": NOW - 599.9, "dir": "RX", "hex": "01 10 01 F7 00 04 F0 3A"}]
        m = FakeMaster("actuator"); m.t.frames = F()
        e = ev.build(m, None, {"desc": "x"}, conntest(), 1, now=NOW)
        txt = ev.render_frames(e["frames"])
        self.assertTrue(txt.startswith("# "))
        body = [l for l in txt.splitlines() if not l.startswith("#")]
        self.assertEqual(len(body), 3)
        self.assertIn("TX 01 10 01 F7", body[0]); self.assertIn("RX 01 10 01 F7", body[1])

    def test_unknown_unit_raises(self):
        with self.assertRaises(ValueError):
            ev.build(FakeMaster("sensor"), None, {}, conntest(), 9, now=NOW)


class Files(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.e = ev.build(FakeMaster("sensor"), None, {"desc": "rtu x"}, conntest(), 1, now=NOW)

    def test_write_list_read_delete(self):
        s = ev.write(self.dir, self.e)
        self.assertEqual(sorted(os.listdir(os.path.join(self.dir, s["id"]))), sorted(ev.FILES))
        lst = ev.list_packages(self.dir)
        self.assertEqual([x["id"] for x in lst], [s["id"]])
        self.assertEqual(lst[0]["passed"], s["passed"]); self.assertEqual(lst[0]["unit"], 1)
        rep = ev.read_file(self.dir, s["id"], "report.md")
        self.assertIn("실노드 증적 — 센서 노드 unit 1", rep)
        self.assertIn("| 5.4.1 | 연결시험 |", rep)
        self.assertIn("수동 증적 항목", rep)
        fr = ev.read_file(self.dir, s["id"], "frames.txt")
        self.assertIn("TX 01 03 00 CA 00 5B", fr)
        body = json.loads(ev.read_file(self.dir, s["id"], "results.json"))
        self.assertNotIn("frames", body)      # 프레임은 frames.txt 로만
        self.assertEqual(body["summary"]["id"], s["id"])
        self.assertTrue(ev.delete(self.dir, s["id"]))
        self.assertEqual(ev.list_packages(self.dir), [])

    def test_same_second_gets_suffix(self):
        a = ev.write(self.dir, dict(self.e))
        b = ev.write(self.dir, dict(self.e, id=a["id"].split("-", 1)[0] + "-" + a["id"].split("-", 1)[1].split("-")[0] + "-" + a["id"].split("-")[2]))
        self.assertNotEqual(a["id"], b["id"]); self.assertTrue(b["id"].endswith("-2"))

    def test_path_traversal_rejected(self):
        ev.write(self.dir, self.e)
        with self.assertRaises(ValueError):
            ev.read_file(self.dir, "../etc", "report.md")
        with self.assertRaises(ValueError):
            ev.read_file(self.dir, self.e["id"], "../../secret")
        with self.assertRaises(FileNotFoundError):
            ev.read_file(self.dir, "realnode-20260101-000000", "report.md")

    def test_list_ignores_selftest_folders(self):
        os.makedirs(os.path.join(self.dir, "20260915-235422"))
        ev.write(self.dir, self.e)
        self.assertEqual(len(ev.list_packages(self.dir)), 1)


if __name__ == "__main__":
    unittest.main()
