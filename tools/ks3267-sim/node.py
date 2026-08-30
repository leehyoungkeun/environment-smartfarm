# -*- coding: utf-8 -*-
"""디폴트맵 노드 동작 모델 — pymodbus 없이 순수 파이썬 (테스트 대상).

레지스터 딕셔너리(addr → uint16) 위에서 표준 6절의 의미론을 구현한다:
- 노드 정보 (1~8), 디바이스 코드 (101~), 상태/명령 블록
- 명령 활성화 = opid 변경 시점 (6.1.4 / 6.3.3 / 6.3.4). opid 0 은 "명령 없음".
- 스위치: OFF 0 → READY / ON 201 → 상태 ON(무한) / TIMED_ON 202 → ON + 남은시간 카운트다운 → READY
- 개폐기: OPEN 301 → OPENING(완전열림 소요시간) / CLOSE 302 → CLOSING / STOP 0 → READY
          TIMED_OPEN 303 / TIMED_CLOSE 304 → 지정 시간만 동작
- 레벨2 명령(203, 305, 306)은 예외 응답(illegal data value, 0x03) 대상으로 표시한다.
"""
import time

import _paths  # noqa: F401
from ks3267core import ksmap as M
from ks3267core.codec import float_to_regs, uint32_to_regs, regs_to_uint32


class IllegalDataValue(Exception):
    """모드버스 예외 코드 0x03 — 지원되지 않는 데이터 값"""


class DefaultMapNode:
    def __init__(self, kind, unit=1, serial=0, opener_full_time=30, devices=None, clock=None):
        """
        kind: 'sensor' | 'actuator'
        devices: 부착 디바이스 순번 집합 (None = 부속서 A 전부). 미부착은 코드 0.
        opener_full_time: 개폐기 완전 열림/닫힘 소요 초 (레벨1 은 SET_CONFIG 없음 → 시뮬 설정값)
        clock: 시간 함수 (테스트에서 주입)
        """
        assert kind in ("sensor", "actuator")
        self.kind = kind
        self.unit = unit
        self.clock = clock or time.monotonic
        self.regs = {}
        self.opener_full_time = opener_full_time
        self.attached = set(devices) if devices is not None else None
        self.log = []  # (t, event, detail) — 시험 증적
        self._last_opid = {}      # dev_key → 마지막 활성화 opid
        self._active = {}         # dev_key → {"end": t|None, "status": code}
        self._init_regs(serial)

    # ── 초기화 ──────────────────────────────────────────────────────
    def _init_regs(self, serial):
        r = self.regs
        r[M.REG_CERT_AUTHORITY] = 0   # 0,0 = 디폴트맵 노드 (A.1.1 각주 a)
        r[M.REG_COMPANY_CODE] = 0
        r[M.REG_PRODUCT_CODE] = 0
        r[M.REG_PROTOCOL_VERSION] = M.PROTOCOL_VERSION
        lo, hi = uint32_to_regs(serial)
        r[M.REG_SERIAL_LO], r[M.REG_SERIAL_HI] = lo, hi
        for a in range(9, 101):
            r[a] = 0  # reserved
        if self.kind == "sensor":
            r[M.REG_PRODUCT_TYPE] = M.PRODUCT_SENSOR_NODE
            r[M.REG_CHANNEL_NUMBER] = M.SENSOR_CHANNELS
            for i in range(1, M.SENSOR_CHANNELS + 1):
                r[M.device_code_reg(i)] = M.SENSOR_DEVICE_CODES[i] if self._is_attached(i) else M.DEV_NONE
                self.set_sensor(i, 0.0, M.ST_READY)
            r[M.SENSOR_NODE_STATUS] = M.ST_READY
        else:
            r[M.REG_PRODUCT_TYPE] = M.PRODUCT_ACTUATOR_NODE
            r[M.REG_CHANNEL_NUMBER] = M.ACTUATOR_CHANNELS
            for i in range(1, M.ACTUATOR_CHANNELS + 1):
                kind_i, n = M.actuator_device_index(i)
                code = M.DEV_SWITCH_L1 if kind_i == "switch" else M.DEV_OPENER_L1
                r[M.device_code_reg(i)] = code if self._is_attached(i) else M.DEV_NONE
            r[M.ACT_NODE_OPID] = 0
            r[M.ACT_NODE_STATUS] = M.ST_READY
            r[M.ACT_NODE_CMD] = 0
            r[M.ACT_NODE_CMD_OPID] = 0
            for k in range(1, M.SWITCH_COUNT + 1):
                for a in (*M.switch_status_block(k), *M.switch_cmd_block(k)):
                    r[a] = 0
            for j in range(1, M.OPENER_COUNT + 1):
                for a in (*M.opener_status_block(j), *M.opener_cmd_block(j)):
                    r[a] = 0

    def _is_attached(self, i):
        return self.attached is None or i in self.attached

    # ── 센서 ─────────────────────────────────────────────────────────
    def set_sensor(self, i, value, status=M.ST_READY):
        lo, hi = float_to_regs(value)
        a = M.sensor_value_reg(i)
        self.regs[a], self.regs[a + 1] = lo, hi
        self.regs[M.sensor_status_reg(i)] = status

    # ── 레지스터 접근 (모드버스 어댑터가 부른다) ─────────────────────
    def read(self, address, count):
        return [self.regs.get(address + n, 0) for n in range(count)]

    def write(self, address, values):
        """FC 0x10/0x06 — 쓴 뒤 명령 블록 변화를 평가한다. 예외 시 IllegalDataValue."""
        for n, v in enumerate(values):
            self.regs[address + n] = int(v) & 0xFFFF
        if self.kind == "actuator":
            self._evaluate_commands(address, address + len(values) - 1)

    # ── 명령 평가 ────────────────────────────────────────────────────
    def _evaluate_commands(self, lo, hi):
        # 노드 명령 (501/502) — 제어권 CONTROL. 디폴트맵엔 제어권 레지스터가 없어 opid 만 반영.
        if lo <= M.ACT_NODE_CMD_OPID and hi >= M.ACT_NODE_CMD:
            opid = self.regs[M.ACT_NODE_CMD_OPID]
            if opid and opid != self._last_opid.get("node"):
                self._last_opid["node"] = opid
                self.regs[M.ACT_NODE_OPID] = opid
                self._log("node_cmd", {"op": self.regs[M.ACT_NODE_CMD], "opid": opid})
        for k in range(1, M.SWITCH_COUNT + 1):
            c, o, tl, th = M.switch_cmd_block(k)
            if lo <= th and hi >= c:
                self._maybe_activate(("switch", k), c, o, tl, th)
        for j in range(1, M.OPENER_COUNT + 1):
            c, o, tl, th = M.opener_cmd_block(j)
            if lo <= th and hi >= c:
                self._maybe_activate(("opener", j), c, o, tl, th)

    def _maybe_activate(self, key, c, o, tl, th):
        opid = self.regs[o]
        if opid == 0 or opid == self._last_opid.get(key):
            return  # opid 가 안 바뀌면 활성화 아님 (6.3.3)
        kind, n = key
        idx = n if kind == "switch" else M.SWITCH_COUNT + n
        if not self._is_attached(idx):
            raise IllegalDataValue(f"{kind}{n}: 미부착 디바이스")
        op = self.regs[c]
        t = regs_to_uint32(self.regs[tl], self.regs[th])
        now = self.clock()
        if kind == "switch":
            if op == M.OP_SWITCH_OFF:
                self._set(key, M.ST_READY, None, opid)
            elif op == M.OP_SWITCH_ON:
                self._set(key, M.ST_SWITCH_ON, None, opid)
            elif op == M.OP_SWITCH_TIMED_ON:
                if t <= 0: raise IllegalDataValue("TIMED_ON 시간 0")
                self._set(key, M.ST_SWITCH_ON, now + t, opid)
            else:
                raise IllegalDataValue(f"스위치 미지원 명령 {op}")
        else:
            if op == M.OP_OPENER_STOP:
                self._set(key, M.ST_READY, None, opid)
            elif op == M.OP_OPENER_OPEN:
                self._set(key, M.ST_OPENER_OPENING, now + self.opener_full_time, opid)
            elif op == M.OP_OPENER_CLOSE:
                self._set(key, M.ST_OPENER_CLOSING, now + self.opener_full_time, opid)
            elif op == M.OP_OPENER_TIMED_OPEN:
                if t <= 0: raise IllegalDataValue("TIMED_OPEN 시간 0")
                self._set(key, M.ST_OPENER_OPENING, now + t, opid)
            elif op == M.OP_OPENER_TIMED_CLOSE:
                if t <= 0: raise IllegalDataValue("TIMED_CLOSE 시간 0")
                self._set(key, M.ST_OPENER_CLOSING, now + t, opid)
            else:
                raise IllegalDataValue(f"개폐기 미지원 명령 {op} (레벨2 는 미지원)")
        self._last_opid[key] = opid
        self._log("activate", {"dev": f"{kind}{n}", "op": op, "opid": opid, "time": t})

    def _set(self, key, status, end, opid):
        kind, n = key
        so, ss, rl, rh = M.switch_status_block(n) if kind == "switch" else M.opener_status_block(n)
        self.regs[so] = opid if status != M.ST_READY else 0  # 실행 중 명령 없으면 0 (표 16)
        self.regs[ss] = status
        self._active[key] = {"end": end, "status": status, "start": self.clock()}
        self._refresh_remain(key)

    def _refresh_remain(self, key):
        kind, n = key
        so, ss, rl, rh = M.switch_status_block(n) if kind == "switch" else M.opener_status_block(n)
        a = self._active.get(key)
        remain = 0
        if a and a["end"] is not None:
            remain = max(0, int(round(a["end"] - self.clock())))
        self.regs[rl], self.regs[rh] = uint32_to_regs(remain)

    # ── 시간 진행 ────────────────────────────────────────────────────
    def tick(self):
        """주기적으로 호출 — 남은시간 갱신, 만료 시 READY 전이"""
        now = self.clock()
        for key, a in list(self._active.items()):
            if a["end"] is not None and now >= a["end"]:
                kind, n = key
                so, ss, rl, rh = M.switch_status_block(n) if kind == "switch" else M.opener_status_block(n)
                self.regs[ss] = M.ST_READY
                self.regs[so] = 0
                self.regs[rl] = self.regs[rh] = 0
                a["end"] = None; a["status"] = M.ST_READY
                self._log("complete", {"dev": f"{kind}{n}"})
            else:
                self._refresh_remain(key)

    def status_of(self, kind, n):
        so, ss, rl, rh = M.switch_status_block(n) if kind == "switch" else M.opener_status_block(n)
        return {"opid": self.regs[so], "status": self.regs[ss],
                "remain": regs_to_uint32(self.regs[rl], self.regs[rh])}

    def _log(self, ev, detail):
        self.log.append((self.clock(), ev, detail))
