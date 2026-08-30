# -*- coding: utf-8 -*-
"""마스터 드라이버 유닛 테스트 — 시리얼 없이, 시뮬레이터의 노드 모델을 FakeTransport 로 감싼다.

실행: cd rpi-files/master/ks3267d && python -m unittest -v
"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# 시뮬레이터 모델 — 리포 배치(tools/ks3267-sim) 와 RPi 배치(형제 ks3267-sim) 둘 다
for _c in (os.path.join(HERE, "..", "..", "..", "tools", "ks3267-sim"), os.path.join(HERE, "..", "ks3267-sim")):
    if os.path.isfile(os.path.join(_c, "node.py")):
        sys.path.insert(0, os.path.normpath(_c)); break

from ks3267core import ksmap as M  # noqa: E402
from master import KsMaster, OpidGenerator, status_name  # noqa: E402
from transport import FrameLog, ModbusExc, TransportTimeout  # noqa: E402
from node import DefaultMapNode, IllegalDataValue  # noqa: E402  (시뮬레이터 모델)


class FakeClock:
    def __init__(self): self.t = 5000.0
    def __call__(self): return self.t
    def advance(self, s): self.t += s


class FakeTransport:
    """DefaultMapNode 들을 버스에 매단 가짜 전송. dead 유닛은 타임아웃."""

    def __init__(self, nodes, dead=()):
        self.nodes = nodes; self.dead = set(dead); self.frames = FrameLog(); self.desc = "fake"
        self.calls = []

    def read(self, unit, addr, count):
        self.calls.append(("R", unit, addr, count))
        if unit in self.dead or unit not in self.nodes:
            raise TransportTimeout("no response")
        return self.nodes[unit].read(addr, count)

    def write(self, unit, addr, values):
        self.calls.append(("W", unit, addr, list(values)))
        if unit in self.dead or unit not in self.nodes:
            raise TransportTimeout("no response")
        try:
            self.nodes[unit].write(addr, values)
        except IllegalDataValue:
            raise ModbusExc(3, 16)
        return True


def make_bus(clock):
    act = DefaultMapNode("actuator", unit=1, opener_full_time=30, clock=clock)
    sen = DefaultMapNode("sensor", unit=2, clock=clock, devices={1, 4, 13})
    sen.set_sensor(1, 28.8); sen.set_sensor(4, 61.5); sen.set_sensor(13, 812.0, M.ST_SENSOR_NEED_CHECK)
    return FakeTransport({1: act, 2: sen}, dead={9}), act, sen


class Discovery(unittest.TestCase):
    def setUp(self):
        self.clk = FakeClock(); self.bus, self.act, self.sen = make_bus(self.clk)
        self.m = KsMaster(self.bus, clock=self.clk)

    def test_actuator_descriptor(self):
        d = self.m.discover(1)
        self.assertTrue(d["default_map"] and d["supported"])
        self.assertEqual(d["kind"], "actuator"); self.assertEqual(d["protocol_version"], 10)
        self.assertEqual(len(d["devices"]), 24)
        sw1 = d["devices"][0]; op1 = d["devices"][16]
        self.assertEqual((sw1["kind"], sw1["n"], sw1["cmd"]["cmd"]), ("switch", 1, 503))
        self.assertEqual((op1["kind"], op1["n"], op1["status"]["status"]), ("opener", 1, 268))

    def test_sensor_descriptor_only_attached(self):
        d = self.m.discover(2)
        self.assertEqual(d["kind"], "sensor")
        self.assertEqual([x["index"] for x in d["devices"]], [1, 4, 13], "코드 0 (미부착) 은 제외")
        self.assertEqual(d["devices"][2]["name"], "CO2")

    def test_non_default_map_is_flagged_unsupported(self):
        self.act.regs[M.REG_COMPANY_CODE] = 77  # 회사코드 ≠ 0 → 자동등록 노드
        d = self.m.discover(1)
        self.assertFalse(d["supported"]); self.assertIn("자동등록", d["notes"][0])

    def test_version_101_noted_but_supported(self):
        self.act.regs[M.REG_PROTOCOL_VERSION] = 101
        d = self.m.discover(1)
        self.assertTrue(d["supported"]); self.assertTrue(any("101" in n for n in d["notes"]))

    def test_dead_unit_times_out_and_is_logged(self):
        with self.assertRaises(TransportTimeout):
            self.m.discover(9)
        self.assertEqual(self.m.events[-1]["kind"], "discover_timeout")
        self.assertNotIn(9, self.m.nodes, "실패한 탐색이 등록되면 안 된다")


class Polling(unittest.TestCase):
    def setUp(self):
        self.clk = FakeClock(); self.bus, self.act, self.sen = make_bus(self.clk)
        self.m = KsMaster(self.bus, clock=self.clk); self.m.discover(1); self.m.discover(2)

    def test_sensor_poll_decodes_floats_and_status(self):
        st = self.m.poll(2)
        self.assertAlmostEqual(st["sensors"][1]["value"], 28.8, places=3)
        self.assertAlmostEqual(st["sensors"][4]["value"], 61.5, places=3)
        self.assertEqual(st["sensors"][13]["status_name"], "NEED_CHECK")
        self.assertEqual(len([c for c in self.bus.calls if c[0] == "R" and c[2] == 202]), 1, "센서 영역은 한 번에 읽는다")

    def test_actuator_poll_reflects_commands(self):
        self.m.command(1, "switch", 3, "timed_on", seconds=12)
        st = self.m.poll(1)
        dev = st["devices"][3]
        self.assertEqual(dev["status_name"], "ON"); self.assertEqual(dev["remain"], 12)
        self.clk.advance(13); self.act.tick()
        self.assertEqual(self.m.poll(1)["devices"][3]["status_name"], "READY")

    def test_poll_timeout_is_reported_not_hidden(self):
        self.bus.dead.add(1)
        st = self.m.poll(1)
        self.assertEqual(st["error"], "timeout"); self.assertEqual(self.m.events[-1]["kind"], "poll_timeout")


class Commands(unittest.TestCase):
    def setUp(self):
        self.clk = FakeClock(); self.bus, self.act, self.sen = make_bus(self.clk)
        self.m = KsMaster(self.bus, clock=self.clk); self.m.discover(1)

    def test_switch_on_writes_fc16_four_words_and_reads_back(self):
        r = self.m.command(1, "switch", 1, "on")
        w = [c for c in self.bus.calls if c[0] == "W"][-1]
        self.assertEqual(w[2], 503); self.assertEqual(w[3][0], M.OP_SWITCH_ON); self.assertEqual(w[3][1], r["opid"])
        self.assertTrue(r["ok"] and r["accepted"]); self.assertEqual(r["status_name"], "ON")
        rb = [c for c in self.bus.calls if c[0] == "R" and c[2] == 203]
        self.assertTrue(rb, "명령 후 readback 이 없다 — 표준은 상태 확인을 전제한다")

    def test_opid_changes_every_command(self):
        a = self.m.command(1, "switch", 1, "on")["opid"]
        b = self.m.command(1, "switch", 1, "off")["opid"]
        c = self.m.command(1, "opener", 2, "open")["opid"]
        self.assertTrue(a != b != c and 0 not in (a, b, c))

    def test_timed_open_seconds_encoded_cdab(self):
        self.m.command(1, "opener", 1, "timed_open", seconds=70000)  # > 65535 → 상위 워드 사용
        w = [c for c in self.bus.calls if c[0] == "W"][-1]
        self.assertEqual(w[2], 567); self.assertEqual((w[3][2], w[3][3]), (70000 & 0xFFFF, 70000 >> 16))
        self.assertEqual(self.act.status_of("opener", 1)["remain"], 70000)

    def test_level2_rejected_locally_without_bus_traffic(self):
        before = len(self.bus.calls)
        r = self.m.command(1, "opener", 1, "set_position")
        self.assertFalse(r["ok"]); self.assertIn("미지원", r["error"])
        self.assertEqual(len(self.bus.calls), before, "스코프 밖 명령이 버스에 나가면 안 된다")

    def test_level2_forced_yields_exception_response(self):
        r = self.m.command(1, "opener", 1, M.OP_OPENER_SET_POSITION, allow_unsupported=True)
        self.assertFalse(r["ok"]); self.assertEqual(r["exception"], 3)
        self.assertEqual(self.m.events[-1]["kind"], "command_exception")

    def test_timed_requires_seconds(self):
        r = self.m.command(1, "switch", 1, "timed_on", seconds=0)
        self.assertFalse(r["ok"])

    def test_unknown_device_rejected(self):
        r = self.m.command(1, "switch", 17, "on")
        self.assertFalse(r["ok"])

    def test_bus_lock_serializes(self):
        import threading
        errors = []
        def worker(i):
            try:
                self.m.command(1, "switch", (i % 16) + 1, "on")
            except Exception as e:
                errors.append(e)
        ths = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
        [t.start() for t in ths]; [t.join() for t in ths]
        self.assertFalse(errors)
        # 쓰기와 readback 이 항상 짝으로 인접해야 한다 (다른 트랜잭션이 끼어들지 않음)
        seq = [c for c in self.bus.calls if c[1] == 1 and (c[0] == "W" or (c[0] == "R" and c[3] == 4))]
        for i in range(0, len(seq) - 1, 2):
            self.assertEqual((seq[i][0], seq[i + 1][0]), ("W", "R"))


class Opid(unittest.TestCase):
    def test_wraps_and_skips_zero_and_persists(self):
        d = tempfile.mkdtemp(); p = os.path.join(d, "opid.json")
        g = OpidGenerator(p); g.value = 0xFFFE
        self.assertEqual(g.next(), 0xFFFF); self.assertEqual(g.next(), 1, "65535 다음은 1 (0 건너뜀)")
        g2 = OpidGenerator(p)
        self.assertEqual(g2.next(), 2, "재시작 후에도 이어진다 — 직전 opid 재사용 금지")


class Names(unittest.TestCase):
    def test_status_names(self):
        self.assertEqual(status_name(301), "OPENING"); self.assertEqual(status_name(950), "VENDOR_ERROR_950")
        self.assertEqual(status_name(7), "UNKNOWN_7")


if __name__ == "__main__":
    unittest.main()
