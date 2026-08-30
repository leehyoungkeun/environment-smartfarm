# -*- coding: utf-8 -*-
"""시뮬레이터 E2E — 마스터(pymodbus 클라이언트) 관점에서 표준 절차를 왕복 검증.

이 스크립트가 통과하는 시뮬레이터 = 마스터 드라이버(P2) 개발의 기준이자, SPS-7466
자가 시험(P6) 시나리오의 뼈대다. 드라이버가 완성되면 같은 시나리오를 드라이버 API 로 돌린다.

사용:
  python sim.py --tcp 5020 --unit 1 --type actuator &
  python sim.py --tcp 5021 --unit 2 --type sensor &
  python e2e_tcp.py [--act 5020] [--sen 5021]
"""
import argparse
import sys
import time

from pymodbus.client import ModbusTcpClient

import _paths  # noqa: F401
from ks3267core import ksmap as M
from ks3267core.codec import regs_to_float, regs_to_uint32, uint32_to_regs

ok = True


def check(cond, msg):
    global ok
    print(("  OK  " if cond else "  FAIL") + " " + msg)
    ok = ok and cond


def connect(port):
    for _ in range(30):
        c = ModbusTcpClient("127.0.0.1", port=port, timeout=2)
        if c.connect():
            return c
        time.sleep(0.3)
    raise SystemExit(f"connect failed :{port}")


def run(act_port, sen_port, unit_act=1, unit_sen=2):
    print("== actuator node ==")
    c = connect(act_port)
    info = c.read_holding_registers(1, count=8, device_id=unit_act).registers
    check(info[0:2] == [0, 0], "node info: cert/company 0,0 (default map)")
    check(info[2] == 2 and info[4] == 10 and info[5] == 24, "type 2 / version 10 / channels 24")
    codes = c.read_holding_registers(101, count=24, device_id=unit_act).registers
    check(codes[:16] == [102] * 16 and codes[16:] == [112] * 8, "device codes 102x16 + 112x8")

    cc, co, tl, th = M.switch_cmd_block(1)
    lo, hi = uint32_to_regs(5)
    w = c.write_registers(cc, [M.OP_SWITCH_TIMED_ON, 7, lo, hi], device_id=unit_act)
    check(not w.isError(), "FC16 TIMED_ON accepted")
    so, ss, rl, rh = M.switch_status_block(1)
    st = c.read_holding_registers(so, count=4, device_id=unit_act).registers
    check(st[0] == 7 and st[1] == M.ST_SWITCH_ON and regs_to_uint32(st[2], st[3]) in (4, 5), f"readback opid7 ON remain~5 -> {st}")
    time.sleep(6)
    st = c.read_holding_registers(so, count=4, device_id=unit_act).registers
    check(st == [0, 0, 0, 0], f"after 6s READY/opid0/remain0 -> {st}")

    oc, op, ol, oh = M.opener_cmd_block(1)
    c.write_registers(oc, [M.OP_OPENER_OPEN, 8, 0, 0], device_id=unit_act)
    oso, oss, orl, orh = M.opener_status_block(1)
    st = c.read_holding_registers(oso, count=4, device_id=unit_act).registers
    check(st[1] == M.ST_OPENER_OPENING and regs_to_uint32(st[2], st[3]) in (29, 30), f"OPEN -> OPENING remain~30 -> {st}")
    c.write_registers(oc, [M.OP_OPENER_STOP, 9, 0, 0], device_id=unit_act)
    check(c.read_holding_registers(oso, count=2, device_id=unit_act).registers[1] == M.ST_READY, "STOP -> READY")

    c.write_registers(cc, [M.OP_SWITCH_ON, 20, 0, 0], device_id=unit_act)
    c.write_registers(cc, [M.OP_SWITCH_OFF, 20, 0, 0], device_id=unit_act)  # same opid
    check(c.read_holding_registers(so, count=2, device_id=unit_act).registers[1] == M.ST_SWITCH_ON, "same opid resend ignored")
    c.write_registers(cc, [M.OP_SWITCH_OFF, 21, 0, 0], device_id=unit_act)
    check(c.read_holding_registers(so, count=2, device_id=unit_act).registers[1] == M.ST_READY, "new opid OFF -> READY")

    # FC06 word-by-word: activation only when opid word written
    c2, o2, _, _ = M.switch_cmd_block(2)
    c.write_register(c2, M.OP_SWITCH_ON, device_id=unit_act)
    so2, ss2, _, _ = M.switch_status_block(2)
    check(c.read_holding_registers(so2, count=2, device_id=unit_act).registers[1] == M.ST_READY, "FC06 cmd only -> not active yet")
    c.write_register(o2, 5, device_id=unit_act)
    check(c.read_holding_registers(so2, count=2, device_id=unit_act).registers[1] == M.ST_SWITCH_ON, "FC06 opid -> ON")

    e = c.write_registers(oc, [M.OP_OPENER_SET_POSITION, 30, 0, 0], device_id=unit_act)
    check(e.isError() and getattr(e, "exception_code", None) == 3, f"level-2 SET_POSITION -> exception 0x03 (got {getattr(e, 'exception_code', None)})")
    c.close()

    print("== sensor node ==")
    c = connect(sen_port)
    info = c.read_holding_registers(1, count=8, device_id=unit_sen).registers
    check(info[2] == 1 and info[5] == 30, "type 1 / channels 30")
    v = c.read_holding_registers(M.sensor_value_reg(3), count=3, device_id=unit_sen).registers
    check(v[0] == 0x6666 and v[1] == 0x41E6, f"temp3 28.8 -> words [0x{v[0]:04X}, 0x{v[1]:04X}] (standard CDAB example)")
    check(abs(regs_to_float(v[0], v[1]) - 28.8) < 1e-4 and v[2] == 0, "float decode 28.8, status READY")
    v = c.read_holding_registers(M.sensor_value_reg(4), count=3, device_id=unit_sen).registers
    check(abs(regs_to_float(v[0], v[1]) - 60.0) < 1e-4, "humidity1 60.0")
    c.close()
    print("\nRESULT:", "ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--act", type=int, default=5020)
    p.add_argument("--sen", type=int, default=5021)
    a = p.parse_args()
    sys.exit(0 if run(a.act, a.sen) else 1)
