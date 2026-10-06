# -*- coding: utf-8 -*-
"""KS X 3267:2022 부속서 A·B 전수 대조 (2026-10-07).

왜 만드나: 2026-10-06 검정에서 부속서 B.2 표기 때문에 탈락했다. B.2 가 틀렸다면 나머지
부속서도 의심해야 한다 — 그래서 **표준 PDF 원문에서 눈으로 뽑은 값**을 여기 박아 두고
`ksmap.py` 와 자동 대조한다. 공식이 바뀌거나 표를 잘못 고치면 여기서 먼저 깨진다.

아래 숫자의 출처 (docs/485_documents/05_03_(KS X 3267)...pdf):
  B.1 제품 타입        42쪽
  B.3 제어명령 코드    43쪽
  B.4 제어권 코드      43쪽
  A.1.1/A.1.2 센서     32~33쪽
  A.1.4 센서 상태      35쪽   (무게#1 287·상태 289, 무게#2 290·상태 292)
  A.2.1/A.2.2 구동기   36쪽
  A.2.5 구동기 상태    38~39쪽 (스위치8 OPID 231, 스위치16 263, 개폐기1 267, 개폐기3 275)
  A.2.6 구동기 제어    39~41쪽 (스위치1 503, 스위치16 563, 개폐기1 567, 개폐기8 595)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ks3267core import ksmap as M  # noqa: E402


class AnnexB(unittest.TestCase):
    def test_b1_제품_타입(self):
        self.assertEqual((M.PRODUCT_SENSOR_NODE, M.PRODUCT_ACTUATOR_NODE, M.PRODUCT_INTEGRATED_NODE), (1, 2, 3))

    def test_b3_제어명령_코드(self):
        self.assertEqual(M.OP_CONTROL, 2, "노드 제어권 설정")
        self.assertEqual((M.OP_SWITCH_OFF, M.OP_SWITCH_ON, M.OP_SWITCH_TIMED_ON, M.OP_SWITCH_DIRECTIONAL_ON),
                         (0, 201, 202, 203))
        self.assertEqual((M.OP_OPENER_STOP, M.OP_OPENER_OPEN, M.OP_OPENER_CLOSE,
                          M.OP_OPENER_TIMED_OPEN, M.OP_OPENER_TIMED_CLOSE,
                          M.OP_OPENER_SET_POSITION, M.OP_OPENER_SET_CONFIG),
                         (0, 301, 302, 303, 304, 305, 306))

    def test_b4_제어권_코드(self):
        self.assertEqual((M.CTRL_LOCAL, M.CTRL_REMOTE, M.CTRL_MANUAL), (1, 2, 3))


class AnnexA노드정보(unittest.TestCase):
    def test_노드정보_레지스터_1에서_8(self):
        self.assertEqual(
            (M.REG_CERT_AUTHORITY, M.REG_COMPANY_CODE, M.REG_PRODUCT_TYPE, M.REG_PRODUCT_CODE,
             M.REG_PROTOCOL_VERSION, M.REG_CHANNEL_NUMBER, M.REG_SERIAL_LO, M.REG_SERIAL_HI),
            (1, 2, 3, 4, 5, 6, 7, 8))

    def test_프로토콜_버전은_10(self):
        self.assertEqual(M.PROTOCOL_VERSION, 10)

    def test_채널수(self):
        self.assertEqual(M.SENSOR_CHANNELS, 30, "A.1.1 센서 노드")
        self.assertEqual(M.ACTUATOR_CHANNELS, 24, "A.2.1 구동기 노드 = 스위치16 + 개폐기8")
        self.assertEqual((M.SWITCH_COUNT, M.OPENER_COUNT), (16, 8))

    def test_디바이스_코드는_101부터(self):
        self.assertEqual(M.device_code_reg(1), 101)
        self.assertEqual(M.device_code_reg(30), 130)


class AnnexA센서(unittest.TestCase):
    # A.1.2 — 레지스터 101~119 의 장치코드 (33쪽 표 그대로)
    표 = {1: 1, 2: 1, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8,
          11: 9, 12: 10, 13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 16, 19: 17}
    이름 = {1: "온도1", 4: "습도1", 5: "이슬점", 6: "감우", 7: "유량", 8: "강우",
           9: "일사", 10: "풍속", 11: "풍향", 12: "전압", 13: "CO2", 14: "EC",
           15: "광양자", 16: "토양함수율", 17: "토양수분장력", 18: "pH", 19: "지온", 29: "무게1"}

    def test_장치코드가_표와_같다(self):
        for i, code in self.표.items():
            self.assertEqual(M.SENSOR_DEVICE_CODES[i], code, f"디바이스 {i} (레지스터 {100 + i})")

    def test_온도4에서_10은_코드1_습도2에서_3은_2_무게는_18(self):
        for i in range(20, 27):
            self.assertEqual(M.SENSOR_DEVICE_CODES[i], 1, f"온도 {i - 16}")
        self.assertEqual([M.SENSOR_DEVICE_CODES[i] for i in (27, 28)], [2, 2], "습도 2~3")
        self.assertEqual([M.SENSOR_DEVICE_CODES[i] for i in (29, 30)], [18, 18], "무게 1~2")

    def test_이름이_표준_표기와_같다(self):
        for i, name in self.이름.items():
            self.assertEqual(M.SENSOR_NAMES[i], name, f"디바이스 {i}")

    def test_값_상태_주소_공식(self):
        # A.1.3/A.1.4 — 값 2워드 + 상태 1워드가 3워드씩
        self.assertEqual((M.sensor_value_reg(1), M.sensor_status_reg(1)), (203, 205), "온도1")
        self.assertEqual((M.sensor_value_reg(29), M.sensor_status_reg(29)), (287, 289), "무게#1 (35쪽)")
        self.assertEqual((M.sensor_value_reg(30), M.sensor_status_reg(30)), (290, 292), "무게#2 (35쪽)")

    def test_노드_상태_레지스터(self):
        self.assertEqual(M.SENSOR_NODE_STATUS, 202)

    def test_범위_밖은_막는다(self):
        for bad in (0, 31):
            with self.assertRaises(Exception, msg=f"센서 {bad}"):
                M.sensor_value_reg(bad)


class AnnexA구동기(unittest.TestCase):
    def test_디바이스_코드_레벨1(self):
        self.assertEqual(M.DEV_SWITCH_L1, 102, "A.2.2 스위치")
        self.assertEqual(M.DEV_OPENER_L1, 112, "A.2.2 개폐기")

    def test_상태_블록_주소(self):
        # A.2.5 — 38~39쪽에서 확인한 값
        self.assertEqual(M.switch_status_block(1)[0], 203, "스위치1 OPID")
        self.assertEqual(M.switch_status_block(8)[0], 231, "스위치8 OPID (38쪽)")
        self.assertEqual(M.switch_status_block(16)[0], 263, "스위치16 OPID (38쪽)")
        self.assertEqual(M.opener_status_block(1)[0], 267, "개폐기1 OPID (38쪽)")
        self.assertEqual(M.opener_status_block(3)[0], 275, "개폐기3 OPID (39쪽)")
        self.assertEqual(M.opener_status_block(8)[0], 295, "개폐기8 OPID (39쪽)")

    def test_상태_블록은_OPID_상태_남은시간2워드(self):
        opid, status, lo, hi = M.switch_status_block(1)
        self.assertEqual((status, lo, hi), (opid + 1, opid + 2, opid + 3))

    def test_명령_블록_주소(self):
        # A.2.6 — 39~41쪽
        self.assertEqual(M.switch_cmd_block(1)[0], 503, "스위치1 명령")
        self.assertEqual(M.switch_cmd_block(2)[0], 507, "스위치2 명령 (39쪽)")
        self.assertEqual(M.switch_cmd_block(16)[0], 563, "스위치16 명령 (41쪽)")
        self.assertEqual(M.opener_cmd_block(1)[0], 567, "개폐기1 명령 (41쪽)")
        self.assertEqual(M.opener_cmd_block(8)[0], 595, "개폐기8 명령 (41쪽)")

    def test_명령_블록은_명령_OPID_동작시간2워드(self):
        cmd, opid, lo, hi = M.opener_cmd_block(1)
        self.assertEqual((opid, lo, hi), (cmd + 1, cmd + 2, cmd + 3))

    def test_노드_제어_레지스터(self):
        self.assertEqual((M.ACT_NODE_OPID, M.ACT_NODE_STATUS), (201, 202))
        self.assertEqual((M.ACT_NODE_CMD, M.ACT_NODE_CMD_OPID), (501, 502))

    def test_상태와_명령_블록이_겹치지_않는다(self):
        """같은 주소를 읽기와 쓰기가 공유하면 명령이 상태를 덮어쓴다."""
        status = {r for k in range(1, 17) for r in M.switch_status_block(k)} \
            | {r for j in range(1, 9) for r in M.opener_status_block(j)}
        cmd = {r for k in range(1, 17) for r in M.switch_cmd_block(k)} \
            | {r for j in range(1, 9) for r in M.opener_cmd_block(j)}
        self.assertEqual(status & cmd, set())


if __name__ == "__main__":
    unittest.main()
