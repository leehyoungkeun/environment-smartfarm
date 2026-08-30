# -*- coding: utf-8 -*-
"""시뮬레이터 자체 검증 — 부속서 A 표의 실제 숫자와 공식을 대조하고, 노드 동작 의미론을 잠근다.

실행: cd tools/ks3267-sim && python -m unittest -v
"""
import unittest

import _paths  # noqa: F401
from ks3267core import ksmap as M
from ks3267core.codec import float_to_regs, regs_to_float, uint32_to_regs, regs_to_uint32
from node import DefaultMapNode, IllegalDataValue


class MapFormulaVsAnnexA(unittest.TestCase):
    """공식이 부속서 A 원문 표의 대표 주소와 일치하는가 (표에서 직접 옮긴 숫자)"""

    def test_sensor_values(self):
        # A.1.4: 온도#1 값 203~204 상태 205, 습도#1 값 212 상태 214, CO2 239/241, 무게#2 290/292
        self.assertEqual(M.sensor_value_reg(1), 203); self.assertEqual(M.sensor_status_reg(1), 205)
        self.assertEqual(M.sensor_value_reg(4), 212); self.assertEqual(M.sensor_status_reg(4), 214)
        self.assertEqual(M.sensor_value_reg(13), 239); self.assertEqual(M.sensor_status_reg(13), 241)
        self.assertEqual(M.sensor_value_reg(30), 290); self.assertEqual(M.sensor_status_reg(30), 292)

    def test_sensor_device_codes(self):
        # A.1.2: 101 온도1=1, 104 습도1=2, 113 CO2=11, 118 pH=16, 129 무게1=18
        self.assertEqual(M.device_code_reg(1), 101); self.assertEqual(M.SENSOR_DEVICE_CODES[1], 1)
        self.assertEqual(M.device_code_reg(4), 104); self.assertEqual(M.SENSOR_DEVICE_CODES[4], 2)
        self.assertEqual(M.SENSOR_DEVICE_CODES[13], 11)
        self.assertEqual(M.SENSOR_DEVICE_CODES[18], 16)
        self.assertEqual(M.device_code_reg(29), 129); self.assertEqual(M.SENSOR_DEVICE_CODES[29], 18)

    def test_switch_status_blocks(self):
        # A.2.5: OPID#1 203, 스위치1 상태 204, 남은시간 205~206; OPID#8 231; OPID#16 263, 상태 264
        self.assertEqual(M.switch_status_block(1), (203, 204, 205, 206))
        self.assertEqual(M.switch_status_block(8)[0], 231)
        self.assertEqual(M.switch_status_block(16), (263, 264, 265, 266))

    def test_opener_status_blocks(self):
        # A.2.5: OPID#17 267, 개폐기1 상태 268, 남은 269~270; 개폐기8: OPID#23 295, 상태 296, 297~298
        self.assertEqual(M.opener_status_block(1), (267, 268, 269, 270))
        self.assertEqual(M.opener_status_block(8), (295, 296, 297, 298))

    def test_switch_cmd_blocks(self):
        # A.2.6: 스위치1 명령 503, OPID#1 504, 동작시간 505~506; 스위치16 명령 563, OPID 564, 565~566
        self.assertEqual(M.switch_cmd_block(1), (503, 504, 505, 506))
        self.assertEqual(M.switch_cmd_block(16), (563, 564, 565, 566))

    def test_opener_cmd_blocks(self):
        # A.2.6: 개폐기1 명령 567, OPID#17 568, 569~570; 개폐기8 명령 595, OPID#24 596, 597~598
        self.assertEqual(M.opener_cmd_block(1), (567, 568, 569, 570))
        self.assertEqual(M.opener_cmd_block(8), (595, 596, 597, 598))

    def test_actuator_device_codes(self):
        # A.2.2: 101~116 스위치 102, 117~124 개폐기 112
        self.assertEqual(M.actuator_device_index(1), ("switch", 1))
        self.assertEqual(M.actuator_device_index(16), ("switch", 16))
        self.assertEqual(M.actuator_device_index(17), ("opener", 1))
        self.assertEqual(M.actuator_device_index(24), ("opener", 8))

    def test_node_info_constants(self):
        self.assertEqual(M.PROTOCOL_VERSION, 10)           # 표 9
        self.assertEqual(M.SENSOR_CHANNELS, 30)             # A.1.1
        self.assertEqual(M.ACTUATOR_CHANNELS, 24)           # A.2.1
        self.assertEqual(M.ACT_NODE_CMD, 501); self.assertEqual(M.ACT_NODE_CMD_OPID, 502)

    def test_blocks_do_not_overlap(self):
        used = {}
        for k in range(1, 17):
            for a in (*M.switch_status_block(k), *M.switch_cmd_block(k)):
                self.assertNotIn(a, used, f"주소 중복 {a}"); used[a] = k
        for j in range(1, 9):
            for a in (*M.opener_status_block(j), *M.opener_cmd_block(j)):
                self.assertNotIn(a, used, f"주소 중복 {a}"); used[a] = j
        self.assertEqual(max(a for a in used if a < 500), 298)  # 상태 영역 끝
        self.assertEqual(max(used), 598)                          # 명령 영역 끝


class CodecCDAB(unittest.TestCase):
    """4.3.3 인코딩 — 표준의 예시 그대로"""

    def test_standard_example_28_8(self):
        lo, hi = float_to_regs(28.8)
        self.assertEqual((lo, hi), (0x6666, 0x41E6))  # reg372=0x6666, reg373=0x41E6
        self.assertAlmostEqual(regs_to_float(0x6666, 0x41E6), 28.8, places=4)

    def test_uint32_word_order(self):
        self.assertEqual(uint32_to_regs(0x0001_0002), (0x0002, 0x0001))
        self.assertEqual(regs_to_uint32(0x0002, 0x0001), 0x00010002)

    def test_negative_and_zero(self):
        lo, hi = float_to_regs(-3.5)
        self.assertAlmostEqual(regs_to_float(lo, hi), -3.5, places=5)
        self.assertEqual(float_to_regs(0.0), (0, 0))


class FakeClock:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t
    def advance(self, s): self.t += s


class SensorNodeBehavior(unittest.TestCase):
    def test_node_info_and_default_map_marker(self):
        n = DefaultMapNode("sensor", serial=0x12345678)
        info = n.read(1, 8)
        self.assertEqual(info[0:2], [0, 0], "기관·회사코드 0,0 = 디폴트맵")
        self.assertEqual(info[2], M.PRODUCT_SENSOR_NODE)
        self.assertEqual(info[4], 10)
        self.assertEqual(info[5], 30)
        self.assertEqual(regs_to_uint32(info[6], info[7]), 0x12345678)

    def test_device_codes_and_absent(self):
        n = DefaultMapNode("sensor", devices={1, 4})
        codes = n.read(101, 30)
        self.assertEqual(codes[0], 1); self.assertEqual(codes[3], 2)
        self.assertEqual(codes[1], 0, "미부착은 0")

    def test_sensor_value_roundtrip(self):
        n = DefaultMapNode("sensor")
        n.set_sensor(1, 28.8)
        lo, hi, st = n.read(203, 3)
        self.assertEqual((lo, hi), (0x6666, 0x41E6))
        self.assertEqual(st, M.ST_READY)


class ActuatorNodeBehavior(unittest.TestCase):
    def setUp(self):
        self.clk = FakeClock()
        self.n = DefaultMapNode("actuator", opener_full_time=30, clock=self.clk)

    def cmd(self, block, op, opid, t=0):
        c, o, tl, th = block
        lo, hi = uint32_to_regs(t)
        self.n.write(c, [op, opid, lo, hi])  # FC 0x10, 4 워드 한 번에

    def test_switch_on_off(self):
        self.cmd(M.switch_cmd_block(1), M.OP_SWITCH_ON, 11)
        s = self.n.status_of("switch", 1)
        self.assertEqual(s["status"], M.ST_SWITCH_ON); self.assertEqual(s["opid"], 11)
        self.cmd(M.switch_cmd_block(1), M.OP_SWITCH_OFF, 12)
        s = self.n.status_of("switch", 1)
        self.assertEqual(s["status"], M.ST_READY); self.assertEqual(s["opid"], 0, "실행 중 명령 없으면 opid 0")

    def test_opid_unchanged_does_not_reactivate(self):
        self.cmd(M.switch_cmd_block(2), M.OP_SWITCH_ON, 5)
        self.cmd(M.switch_cmd_block(2), M.OP_SWITCH_OFF, 5)  # 같은 opid → 무시
        self.assertEqual(self.n.status_of("switch", 2)["status"], M.ST_SWITCH_ON,
                         "opid 가 안 바뀌었는데 명령이 활성화됐다 (6.3.3 위반)")

    def test_timed_on_countdown_and_complete(self):
        self.cmd(M.switch_cmd_block(3), M.OP_SWITCH_TIMED_ON, 7, t=10)
        self.assertEqual(self.n.status_of("switch", 3)["remain"], 10)
        self.clk.advance(4); self.n.tick()
        self.assertEqual(self.n.status_of("switch", 3)["remain"], 6)
        self.clk.advance(7); self.n.tick()
        s = self.n.status_of("switch", 3)
        self.assertEqual(s["status"], M.ST_READY); self.assertEqual(s["remain"], 0); self.assertEqual(s["opid"], 0)

    def test_opener_open_close_stop(self):
        self.cmd(M.opener_cmd_block(1), M.OP_OPENER_OPEN, 21)
        s = self.n.status_of("opener", 1)
        self.assertEqual(s["status"], M.ST_OPENER_OPENING); self.assertEqual(s["remain"], 30)
        self.cmd(M.opener_cmd_block(1), M.OP_OPENER_STOP, 22)
        self.assertEqual(self.n.status_of("opener", 1)["status"], M.ST_READY)
        self.cmd(M.opener_cmd_block(1), M.OP_OPENER_TIMED_CLOSE, 23, t=9)
        s = self.n.status_of("opener", 1)
        self.assertEqual(s["status"], M.ST_OPENER_CLOSING); self.assertEqual(s["remain"], 9)

    def test_level2_command_is_illegal(self):
        with self.assertRaises(IllegalDataValue):
            self.cmd(M.opener_cmd_block(2), M.OP_OPENER_SET_POSITION, 31)
        with self.assertRaises(IllegalDataValue):
            self.cmd(M.switch_cmd_block(1), M.OP_SWITCH_DIRECTIONAL_ON, 32, t=5)

    def test_unattached_device_is_illegal(self):
        n = DefaultMapNode("actuator", devices={1}, clock=self.clk)
        with self.assertRaises(IllegalDataValue):
            c, o, tl, th = M.switch_cmd_block(2); n.write(c, [M.OP_SWITCH_ON, 1, 0, 0])

    def test_fc06_single_register_sequence_activates_on_opid(self):
        """0x06 으로 한 워드씩 써도 opid 워드를 쓰는 순간 활성화 (15절: 0x06 사용 가능)"""
        c, o, tl, th = M.switch_cmd_block(4)
        self.n.write(c, [M.OP_SWITCH_ON])
        self.assertEqual(self.n.status_of("switch", 4)["status"], M.ST_READY, "opid 전엔 활성화 안 됨")
        self.n.write(o, [9])
        self.assertEqual(self.n.status_of("switch", 4)["status"], M.ST_SWITCH_ON)

    def test_node_command_records_opid(self):
        self.n.write(M.ACT_NODE_CMD, [M.OP_CONTROL, 77])
        self.assertEqual(self.n.read(M.ACT_NODE_OPID, 1)[0], 77)


if __name__ == "__main__":
    unittest.main()
