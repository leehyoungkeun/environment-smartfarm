# -*- coding: utf-8 -*-
"""표준 노드 통신 설정 시험 — comm.py (시리얼·pymodbus 없이 돈다).

실행: cd rpi-files/master/ks3267d && python -m unittest test_comm -v
"""
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import comm  # noqa: E402

# 1호 실측 (2026-09-15): ttyUSB0 = CH340 자체 버스, ttyUSB1 = FTDI 표준 노드
ENTRIES = [
    {"path": "/dev/ttyUSB0", "real": "/dev/ttyUSB0", "vid": "1a86", "pid": "7523", "product": "USB Serial", "serial": ""},
    {"path": "/dev/ttyUSB1", "real": "/dev/ttyUSB1", "vid": "0403", "pid": "6001", "product": "FT232R USB UART", "serial": "BG03FRRF"},
]


def ports():
    return comm.classify_ports(ENTRIES, std_real="/dev/ttyUSB1", vendor_real="/dev/ttyUSB0")


class ClassifyPorts(unittest.TestCase):
    def test_roles_chips_and_order(self):
        p = ports()
        self.assertEqual([x["role"] for x in p], ["standard", "vendor"], "표준 포트가 맨 위, 자체 버스는 맨 아래")
        self.assertEqual(p[0]["chip"], "FTDI")
        self.assertEqual(p[1]["chip"], "CH340")

    def test_vendor_bus_is_not_selectable(self):
        vendor = [x for x in ports() if x["role"] == "vendor"][0]
        self.assertFalse(vendor["selectable"])

    def test_standard_port_uses_stable_symlink(self):
        std = [x for x in ports() if x["role"] == "standard"][0]
        self.assertEqual(std["stable"], "/dev/smartfarm-485-std", "ttyUSB 번호가 바뀌어도 따라가는 고정 이름")


class ValidateComm(unittest.TestCase):
    def test_vendor_bus_refused(self):
        cfg, err = comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB0", "baud": 9600}, ports())
        self.assertIsNone(cfg)
        self.assertIn("자체 장치 버스", err)

    def test_vendor_bus_refused_even_by_symlink_name(self):
        # 변이 프로브: 고정 이름으로 우회해도 막혀야 한다 (real 로 매칭)
        cfg, err = comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB0", "baud": 9600}, ports())
        self.assertIsNone(cfg)

    def test_standard_9600_stored_with_stable_name(self):
        cfg, err = comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB1", "baud": 9600, "timeout": 1}, ports())
        self.assertIsNone(err)
        self.assertEqual(cfg["port"], "/dev/smartfarm-485-std")
        self.assertEqual(cfg["baud"], 9600)
        self.assertFalse(cfg["nonStandard"])

    def test_non_standard_baud_allowed_but_flagged(self):
        cfg, err = comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB1", "baud": 19200}, ports())
        self.assertIsNone(err)
        self.assertTrue(cfg["nonStandard"])

    def test_unknown_baud_refused(self):
        cfg, err = comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB1", "baud": 1234}, ports())
        self.assertIsNone(cfg)

    def test_unknown_port_refused(self):
        cfg, err = comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB7", "baud": 9600}, ports())
        self.assertIsNone(cfg)
        self.assertIn("찾을 수 없습니다", err)

    def test_timeout_range(self):
        self.assertIsNone(comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB1", "timeout": 10}, ports())[0])
        self.assertIsNone(comm.validate_comm({"mode": "serial", "port": "/dev/ttyUSB1", "timeout": 0.05}, ports())[0])

    def test_simulator_only_on_loopback(self):
        self.assertIsNone(comm.validate_comm({"mode": "tcp", "tcp": "192.168.0.5:5020"}, ports())[0])
        cfg, err = comm.validate_comm({"mode": "tcp", "tcp": "127.0.0.1:5020"}, ports())
        self.assertIsNone(err)
        self.assertEqual(cfg["tcp"], "127.0.0.1:5020")

    def test_unknown_mode_refused(self):
        self.assertIsNone(comm.validate_comm({"mode": "rtu-over-udp"}, ports())[0])


class Persist(unittest.TestCase):
    def test_roundtrip_and_corrupt_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "comm.json")
            self.assertIsNone(comm.load_comm(p), "없으면 None — 실행 인자를 쓴다")
            comm.save_comm(p, {"mode": "serial", "port": "/dev/smartfarm-485-std", "baud": 9600, "timeout": 1.0, "tcp": None, "nonStandard": False})
            got = comm.load_comm(p)
            self.assertEqual(got["port"], "/dev/smartfarm-485-std")
            self.assertNotIn("nonStandard", got, "판정용 필드는 저장하지 않는다")
            with open(p, "w") as f:
                f.write("{broken")
            self.assertIsNone(comm.load_comm(p))


class ConnTestRows(unittest.TestCase):
    NODE = {"kind": "actuator", "protocol_version": 10, "channels": 24, "default_map": True}

    def test_real_rs485_standard_node_passes(self):
        r = comm.conn_test_rows({"mode": "serial", "baud": 9600, "connected": True, "desc": "rtu /dev/smartfarm-485-std 9600 8N1"},
                                1, {"ok": True, "node": self.NODE})
        self.assertTrue(r["passed"])
        self.assertEqual([x["step"] for x in r["rows"]], ["a", "b", "c", "d"])

    def test_simulator_does_not_pass_a_and_b(self):
        # 시뮬레이터에 붙은 채로는 연결시험 통과로 기록하지 않는다 — 검정 증적을 속이지 않기 위해
        r = comm.conn_test_rows({"mode": "tcp", "connected": True, "desc": "tcp 127.0.0.1:5020"}, 1, {"ok": True, "node": self.NODE})
        self.assertFalse(r["passed"])
        self.assertFalse(r["rows"][0]["ok"])
        self.assertFalse(r["rows"][1]["ok"])
        self.assertTrue(r["rows"][3]["ok"], "노드 응답 자체는 사실대로 표시")

    def test_non_standard_baud_fails_b(self):
        r = comm.conn_test_rows({"mode": "serial", "baud": 19200, "connected": True, "desc": "rtu x 19200 8N1"}, 1, {"ok": True, "node": self.NODE})
        self.assertFalse(r["rows"][1]["ok"])

    def test_invalid_unit_and_no_response(self):
        r = comm.conn_test_rows({"mode": "serial", "baud": 9600, "connected": True}, 0, None)
        self.assertFalse(r["rows"][2]["ok"])
        self.assertFalse(r["rows"][3]["ok"])
        r2 = comm.conn_test_rows({"mode": "serial", "baud": 9600, "connected": True}, 5, {"ok": False, "error": "timeout — 응답 없음"})
        self.assertIn("timeout", r2["rows"][3]["actual"])
        self.assertIn("배선", r2["rows"][3]["note"])

    def test_bool_is_not_a_slave_id(self):
        # 변이 프로브: True 는 파이썬에서 1 과 같지만 주소가 아니다
        self.assertFalse(comm.conn_test_rows({}, True, None)["rows"][2]["ok"])

    def test_non_default_map_node_fails_d(self):
        r = comm.conn_test_rows({"mode": "serial", "baud": 9600, "connected": True}, 3,
                                {"ok": True, "node": {**self.NODE, "default_map": False}})
        self.assertFalse(r["rows"][3]["ok"])


class PrepRows(unittest.TestCase):
    """당일 준비 점검 — 시뮬레이터로 운영 중에도 표준 포트가 9600 으로 열리는지 미리 증명 (2026-09-15)"""
    STD = {"path": "/dev/ttyUSB1", "real": "/dev/ttyUSB1", "role": "standard", "stable": comm.STANDARD_LINK, "label": "표준 노드 포트 · FTDI · ttyUSB1"}

    def test_tcp_mode_probes_standard_port_at_9600(self):
        calls = []
        r = comm.prep_rows([self.STD], {"mode": "tcp", "connected": True, "desc": "tcp 127.0.0.1:5020"},
                           probe=lambda p, b: calls.append((p, b)) or {"ok": True})
        self.assertEqual(calls, [(comm.STANDARD_LINK, 9600)])
        self.assertTrue(r[0]["ok"]); self.assertTrue(r[1]["ok"]); self.assertIsNone(r[2]["ok"], "연결 방식은 안내")
        self.assertIn("시험 당일 값으로", r[2]["detail"])

    def test_serial_mode_never_reopens_port_in_use(self):
        r = comm.prep_rows([self.STD], {"mode": "serial", "port": comm.STANDARD_LINK, "baud": 9600, "connected": True, "desc": "rtu"},
                           probe=lambda p, b: self.fail("드라이버가 쓰는 포트를 다시 열면 안 된다"))
        self.assertTrue(all(x["ok"] for x in r))
        self.assertIn("사용 중", r[1]["detail"])

    def test_missing_standard_port(self):
        r = comm.prep_rows([{**self.STD, "role": "vendor"}], {"mode": "tcp"}, probe=lambda p, b: self.fail("포트 없으면 열지 않는다"))
        self.assertFalse(r[0]["ok"]); self.assertFalse(r[1]["ok"])
        self.assertIn("udev", r[0]["detail"])

    def test_probe_failure_is_shown_verbatim(self):
        r = comm.prep_rows([self.STD], {"mode": "tcp"}, probe=lambda p, b: {"ok": False, "error": "[Errno 13] Permission denied"})
        self.assertFalse(r[1]["ok"]); self.assertIn("Permission denied", r[1]["detail"])

    def test_serial_non_standard_baud_flagged(self):
        r = comm.prep_rows([self.STD], {"mode": "serial", "port": comm.STANDARD_LINK, "baud": 19200, "connected": True, "desc": "rtu 19200"},
                           probe=None)
        self.assertFalse(r[2]["ok"])

    def test_probe_serial_open_with_injected_opener(self):
        self.assertTrue(comm.probe_serial_open("/dev/x", opener=lambda p, b: None)["ok"])

        def boom(p, b):
            raise OSError("device busy")
        self.assertIn("busy", comm.probe_serial_open("/dev/x", opener=boom)["error"])

    def test_conn_test_rows_carries_prep(self):
        r = comm.conn_test_rows({"mode": "tcp"}, 1, None, prep=[{"title": "x", "ok": True, "detail": ""}])
        self.assertEqual(len(r["prep"]), 1)
        self.assertEqual(comm.conn_test_rows({"mode": "tcp"}, 1, None)["prep"], [])


class Reconnect(unittest.TestCase):
    """master.reconnect — 새 설정으로 못 열면 기존 연결을 잃지 않는다"""

    class T:
        def __init__(self, name, can_open=True):
            self.desc, self.can_open, self.open, self.frames = name, can_open, False, None

        def connect(self):
            self.open = self.can_open
            return self.can_open

        def close(self):
            self.open = False

    def test_success_switches_and_clears_stale_state(self):
        from master import KsMaster
        old = self.T("tcp sim")
        old.connect()
        m = KsMaster(old)
        m.state = {1: {"stale": True}}
        m.nodes = {1: {"kind": "actuator", "devices": [], "supported": True}}   # 옛 버스(시뮬)에서 탐색한 노드
        ok, cur = m.reconnect(lambda: self.T("rtu std 9600"))
        self.assertTrue(ok)
        self.assertEqual(m.t.desc, "rtu std 9600")
        self.assertEqual(m.state, {}, "이전 포트에서 읽은 상태는 버린다")
        self.assertEqual(m.nodes, {}, "탐색 결과도 옛 버스의 것 — 비워서 새 버스에서 다시 탐색하게 한다 (2026-09-16)")
        self.assertFalse(old.open, "같은 포트를 다시 열 수 있게 기존 연결을 먼저 닫는다")

    def test_failure_keeps_old_transport_connected(self):
        from master import KsMaster
        old = self.T("tcp sim")
        old.connect()
        m = KsMaster(old)
        ok, cur = m.reconnect(lambda: self.T("rtu missing", can_open=False))
        self.assertFalse(ok)
        self.assertIs(m.t, old)
        self.assertTrue(old.open, "새 설정 실패 시 기존 설정으로 다시 연결")


if __name__ == "__main__":
    unittest.main()
