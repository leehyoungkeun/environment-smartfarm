# -*- coding: utf-8 -*-
"""KS X 3267 마스터 — 노드 등록·폴링·명령 발행·readback. 버스 트랜잭션은 단일 락으로 직렬화한다
(4.1: 마스터는 동시에 하나의 트랜잭션만).

opid (6.1.4 / 6.3.3 / 6.3.4): 모든 명령에 동반, 매 명령 변경, 0 은 "없음". 1..65535 순환을
파일에 영속해 재시작 후에도 직전 값과 겹치지 않게 한다.

원칙: 타임아웃·예외를 숨기지 않는다. 재시도는 기본 0 (--retries 로 명시) — 버스 문제는
로그·카운터로 드러나야 하지, 재시도로 가려지면 안 된다 (feedback_no_workaround_for_modbus).
"""
import json
import os
import threading
import time

from ks3267core import ksmap as M
from ks3267core.codec import regs_to_float, regs_to_uint32, uint32_to_regs
from discovery import discover
from transport import ModbusExc, TransportTimeout

SWITCH_OPS = {"off": M.OP_SWITCH_OFF, "on": M.OP_SWITCH_ON, "timed_on": M.OP_SWITCH_TIMED_ON}
OPENER_OPS = {"stop": M.OP_OPENER_STOP, "open": M.OP_OPENER_OPEN, "close": M.OP_OPENER_CLOSE,
              "timed_open": M.OP_OPENER_TIMED_OPEN, "timed_close": M.OP_OPENER_TIMED_CLOSE}
TIMED_OPS = {M.OP_SWITCH_TIMED_ON, M.OP_OPENER_TIMED_OPEN, M.OP_OPENER_TIMED_CLOSE}
LEVEL2_OPS = {M.OP_SWITCH_DIRECTIONAL_ON, M.OP_OPENER_SET_POSITION, M.OP_OPENER_SET_CONFIG}

STATUS_NAMES = {
    M.ST_READY: "READY", M.ST_ERROR: "ERROR", M.ST_BUSY: "BUSY", M.ST_VOLTAGE_ERROR: "VOLTAGE_ERROR",
    M.ST_CURRENT_ERROR: "CURRENT_ERROR", M.ST_TEMPERATURE_ERROR: "TEMPERATURE_ERROR",
    M.ST_FUSE_ERROR: "FUSE_ERROR", M.ST_SENSOR_NEED_REPLACE: "NEED_REPLACE",
    M.ST_SENSOR_NEED_CALIBRATION: "NEED_CALIBRATION", M.ST_SENSOR_NEED_CHECK: "NEED_CHECK",
    M.ST_SWITCH_ON: "ON", M.ST_SWITCH_USER_CONTROL: "USER_CONTROL",
    M.ST_OPENER_OPENING: "OPENING", M.ST_OPENER_CLOSING: "CLOSING", M.ST_OPENER_MANUAL_CONTROL: "MANUAL_CONTROL",
}


ORIGIN_SRC = ("screen", "auto", "direct", "test")   # 화면(사람) · 자동제어 · 드라이버 API 직접 · 시험장비 역할


def _origin(o):
    """명령 출처를 이벤트 필드로 정규화. 출처를 안 밝힌 명령은 'direct'(드라이버 API 를 바로 부른 것) — 화면 경로는
    NR 「표준 명령 조립」이 source {via:'screen', house, device, by} 를 실어 보낸다 (2026-09-19)."""
    o = o or {}
    src = str(o.get("src") or o.get("via") or "direct")
    if src not in ORIGIN_SRC:
        src = "direct"
    out = {"src": src}
    for k in ("house", "device", "by"):
        v = o.get(k)
        if v not in (None, ""):
            out[k] = str(v)[:64]
    return out


def status_name(code):
    if 900 <= code <= 999:
        return f"VENDOR_ERROR_{code}"
    return STATUS_NAMES.get(code, f"UNKNOWN_{code}")


class OpidGenerator:
    """1..65535 순환, 0 건너뜀, 파일 영속 (재시작 후 직전 opid 재사용 방지)"""

    def __init__(self, path=None):
        self.path = path
        self.lock = threading.Lock()
        self.value = 0
        if path and os.path.exists(path):
            try:
                self.value = int(json.load(open(path))["opid"]) & 0xFFFF
            except Exception:
                self.value = 0

    def next(self):
        with self.lock:
            self.value = (self.value % 0xFFFF) + 1  # 1..65535
            if self.path:
                tmp = self.path + ".tmp"
                with open(tmp, "w") as f:
                    json.dump({"opid": self.value}, f)
                os.replace(tmp, self.path)
            return self.value


class KsMaster:
    def __init__(self, transport, state_dir=None, clock=None):
        self.t = transport
        self.lock = threading.Lock()  # 버스 직렬화
        self.clock = clock or time.time
        opid_path = os.path.join(state_dir, "opid.json") if state_dir else None
        self.opid = OpidGenerator(opid_path)
        self.nodes = {}     # unit → descriptor
        self.state = {}     # unit → 마지막 폴링 결과
        self.events = []    # 최근 이벤트 (진단)
        self.max_events = 200
        self.changes = {}   # unit → 센서 관측치·상태 변화 이력 (§5.4.3 b·d — 제어기가 변화를 매번 읽었다는 증적, 2026-09-15)
        self.max_changes = 300

    # ── 통신 설정 변경 (2026-09-15) ────────────────────────────────────
    def reconnect(self, build):
        """버스 락 안에서 기존 연결을 닫고 새 전송으로 연결한다. → (성공 여부, 현재 전송)

        같은 시리얼 포트를 속도만 바꿔 다시 여는 경우가 있어 새로 열기 전에 먼저 닫는다.
        새 설정으로 열지 못하면 기존 설정으로 되돌려 연결을 잃지 않는다.
        """
        with self.lock:
            old = self.t
            try:
                old.close()
            except Exception:
                pass
            new = build()
            if new.connect():
                self.t = new
                self.state = {}   # 이전 포트에서 읽은 상태는 더 이상 사실이 아니다
                # 탐색 결과(노드 정보·디바이스 목록)도 옛 버스의 것 — 시뮬레이터→실노드로 바꿨을 때 시뮬 노드의 디바이스 24개가
                # 실노드 카드에 그대로 남던 문제. 비우면 poll_loop 가 --units 를 새 버스에서 다시 탐색한다 (2026-09-16)
                self.nodes = {}
                self.changes = {}
                self._event("comm_changed", desc=getattr(new, "desc", "?"))
                return True, new
            try:
                new.close()
            except Exception:
                pass
            old.connect()
            self._event("comm_change_failed", desc=getattr(new, "desc", "?"), kept=getattr(old, "desc", "?"))
            return False, old

    # ── 이벤트 ──────────────────────────────────────────────────────
    def _event(self, ev, **detail):
        self.events.append({"t": self.clock(), "kind": ev, **detail})
        if len(self.events) > self.max_events:
            self.events = self.events[-self.max_events:]

    # ── 탐색 ─────────────────────────────────────────────────────────
    def discover(self, unit):
        with self.lock:
            try:
                d = discover(self.t, unit)
            except ModbusExc as e:
                self._event("discover_exception", unit=unit, code=e.code)
                raise
            except TransportTimeout as e:
                self._event("discover_timeout", unit=unit, error=str(e))
                raise
        self.nodes[unit] = d
        self._event("discovered", unit=unit, kind=d.get("kind"), supported=d["supported"],
                    devices=len(d["devices"]))
        return d

    def forget(self, unit):
        self.nodes.pop(unit, None); self.state.pop(unit, None)

    def scan(self, start, end, timeout=0.3):
        # 범위 [start, end] 를 짧은 타임아웃으로 훑어 응답하는 노드를 등록·반환.
        # Modbus 는 자동열거가 없어 주소별 probe 필요 — 넓은 범위·긴 타임아웃은 느리다.
        start = max(1, int(start)); end = min(247, int(end))
        if end < start:
            start, end = end, start
        if end - start > 254:
            end = start + 254  # 안전 상한
        timeout = max(0.05, min(2.0, float(timeout)))
        found = []
        cp = getattr(getattr(self.t, "client", None), "comm_params", None)   # 클라이언트 없는 전송(테스트 fake)도 허용
        old = getattr(cp, "timeout_connect", None) if cp is not None else None
        if cp is not None and old is not None:
            cp.timeout_connect = timeout   # 스캔 동안만 짧은 타임아웃
        # 스캔은 "없는 주소" 를 의도적으로 두드린다 — 그 미응답/예외는 버스 장애가 아니므로
        # stats.exceptions/timeouts 가 아닌 stats.scan_misses 로 따로 센다 (transport.probing)
        self.t.probing = True
        try:
            for unit in range(start, end + 1):
                with self.lock:
                    try:
                        d = discover(self.t, unit)   # 저수준(이벤트·저장 없음), 실패는 조용히 skip
                    except (ModbusExc, TransportTimeout):
                        continue
                    except Exception:
                        continue
                    self.nodes[unit] = d
                found.append({"unit": unit, "kind": d.get("kind"),
                              "product_type": d.get("product_type"),
                              "supported": d.get("supported"),
                              "channels": d.get("channels"),
                              "devices": len(d.get("devices", [])),
                              "notes": d.get("notes", [])})
        finally:
            self.t.probing = False
            if cp is not None and old is not None:
                cp.timeout_connect = old
        self._event("scan", start=start, end=end, timeout=timeout,
                    found=[f["unit"] for f in found])
        return {"range": [start, end], "timeout_ms": int(round(timeout * 1000)),
                "count": end - start + 1, "found": found}

    # ── 폴링 ─────────────────────────────────────────────────────────
    def poll(self, unit):
        d = self.nodes[unit]
        if not d.get("supported"):
            return None
        now = self.clock()
        with self.lock:
            try:
                if d["kind"] == "sensor":
                    st = self._poll_sensor(unit, d)
                else:
                    st = self._poll_actuator(unit, d)
            except ModbusExc as e:
                self._event("poll_exception", unit=unit, code=e.code)
                st = {"error": str(e), "exception": e.code}
            except TransportTimeout as e:
                self._event("poll_timeout", unit=unit, error=str(e))
                st = {"error": "timeout"}
        st["t"] = now
        st["unit"] = unit
        if st.get("kind") == "sensor":
            self._record_sensor_changes(unit, self.state.get(unit), st, now)
        self.state[unit] = st
        return st

    def _record_sensor_changes(self, unit, prev, st, now):
        """직전 폴링과 비교해 값·상태가 바뀐 센서만 남긴다. 폴링 주기 그대로의 해상도라 화면 갱신(10초)보다 촘촘하다."""
        ps = (prev or {}).get("sensors") or {}
        if not ps:
            return  # 첫 폴링·오류 복귀 직후는 기준이 없다
        lst = self.changes.setdefault(unit, [])
        for idx, s in (st.get("sensors") or {}).items():
            p = ps.get(idx)
            if not p:
                continue
            dv = p.get("value") != s.get("value")
            ds = p.get("status") != s.get("status")
            if not (dv or ds):
                continue
            lst.append({"t": now, "index": idx, "name": s.get("name"), "value": s.get("value"), "status": s.get("status"),
                        "status_name": s.get("status_name"), "prev_value": p.get("value"), "prev_status": p.get("status"),
                        "what": "both" if dv and ds else ("value" if dv else "status")})
        if len(lst) > self.max_changes:
            del lst[:len(lst) - self.max_changes]

    def _poll_sensor(self, unit, d):
        # 노드 상태 202 + 센서 영역 203..292 를 한 번에 (91 워드)
        regs = self.t.read(unit, M.SENSOR_NODE_STATUS, 1 + 3 * M.SENSOR_CHANNELS)
        base = M.SENSOR_NODE_STATUS
        out = {"kind": "sensor", "node_status": regs[0], "node_status_name": status_name(regs[0]), "sensors": {}}
        for dev in d["devices"]:
            vlo = regs[dev["value_reg"] - base]; vhi = regs[dev["value_reg"] + 1 - base]
            st = regs[dev["status_reg"] - base]
            out["sensors"][dev["index"]] = {"name": dev["name"], "code": dev["code"],
                                            "value": round(regs_to_float(vlo, vhi), 3),
                                            "status": st, "status_name": status_name(st)}
        return out

    def _poll_actuator(self, unit, d):
        # 201..298 (노드 OPID·상태 + 스위치 16 + 개폐기 8) 한 번에 (98 워드)
        regs = self.t.read(unit, M.ACT_NODE_OPID, 98)
        base = M.ACT_NODE_OPID
        out = {"kind": "actuator", "node_opid": regs[0], "node_status": regs[1],
               "node_status_name": status_name(regs[1]), "devices": {}}
        for dev in d["devices"]:
            if not dev.get("supported"):
                continue
            s = dev["status"]
            opid = regs[s["opid"] - base]; st = regs[s["status"] - base]
            remain = regs_to_uint32(regs[s["remain"][0] - base], regs[s["remain"][1] - base])
            out["devices"][dev["index"]] = {"name": dev["name"], "kind": dev["kind"], "n": dev["n"],
                                            "opid": opid, "status": st, "status_name": status_name(st),
                                            "remain": remain}
        return out

    # ── 명령 ─────────────────────────────────────────────────────────
    def _actuator_dev(self, unit, kind, n):
        """등록된 구동기 노드의 탐색된 지원 디바이스 → (dev, None) | (None, 오류 dict)"""
        d = self.nodes.get(unit)
        if not d or d.get("kind") != "actuator":
            return None, {"ok": False, "error": f"unit {unit}: 등록된 구동기 노드가 아님"}
        dev = next((x for x in d["devices"] if x.get("kind") == kind and x.get("n") == n), None)
        if not dev or not dev.get("supported"):
            return None, {"ok": False, "error": f"{kind}{n}: 탐색된 지원 디바이스가 아님"}
        return dev, None

    def command(self, unit, kind, n, op, seconds=0, allow_unsupported=False, opid=None, origin=None):
        """op: 'on'|'off'|'timed_on' (스위치) / 'open'|'close'|'stop'|'timed_open'|'timed_close' (개폐기)
        또는 정수 코드. 반환: {ok, opid, status, remain, exception?}
        opid 지정은 §5.3.4 동일 OPID 시험에서 드라이버가 시험장비 역할을 할 때만 쓴다 (평소엔 매 명령 새 OPID).
        origin: 명령 출처 {src:'screen'|'direct'|'test', house, device, by} — 이벤트에 그대로 남아 실노드 증적이
        화면 경로 명령과 시험·직접 명령을 나눈다 (2026-09-19)."""
        org = _origin(origin)
        dev, err = self._actuator_dev(unit, kind, n)
        if err:
            return err
        table = SWITCH_OPS if kind == "switch" else OPENER_OPS
        code = table.get(op) if isinstance(op, str) else int(op)
        if code is None or (code in LEVEL2_OPS and not allow_unsupported):
            return {"ok": False, "error": f"명령 {op}: 레벨1 {kind} 에서 미지원 (레벨2/자동등록 전용)"}
        if code in TIMED_OPS and int(seconds) <= 0:
            return {"ok": False, "error": "TIMED_* 명령은 동작시간(초) > 0 필요"}
        opid = int(opid) if opid else self.opid.next()
        lo, hi = uint32_to_regs(int(seconds) if code in TIMED_OPS else 0)
        c = dev["cmd"]
        with self.lock:
            try:
                self.t.write(unit, c["cmd"], [code, opid, lo, hi])  # FC 0x10, 4 워드
                s = dev["status"]
                rb = self.t.read(unit, s["opid"], 4)  # readback: opid, status, remain
            except ModbusExc as e:
                self._event("command_exception", unit=unit, dev=f"{kind}{n}", op=code, opid=opid, code=e.code, **org)
                return {"ok": False, "opid": opid, "exception": e.code, "error": str(e)}
            except TransportTimeout as e:
                self._event("command_timeout", unit=unit, dev=f"{kind}{n}", op=code, opid=opid, **org)
                return {"ok": False, "opid": opid, "error": "timeout"}
        st = rb[1]; remain = regs_to_uint32(rb[2], rb[3])
        accepted = (rb[0] == opid) or (code in (M.OP_SWITCH_OFF,) and st == M.ST_READY)
        self._event("command", unit=unit, dev=f"{kind}{n}", op=code, opid=opid, status=st, remain=remain,
                    accepted=accepted, **org)
        return {"ok": True, "accepted": accepted, "opid": opid, "op": code, "status": st,
                "status_name": status_name(st), "remain": remain}

    def write_opid(self, unit, kind, n, opid=None):
        """쓰기영역의 OPID 워드만 새 값으로 바꾼다 — §5.3.4 f)·l)·q)·w) "쓰기 영역에 OPID 를 새로운 값으로 변경한다".
        명령코드·작동시간은 그대로 두고 FC16 1 워드(cmd+1). 노드는 OPID 변경 시점에 블록을 활성화한다 (KS X 3267 6.3.3).
        시험장비 역할 전용 — 화면·NR 경로는 쓰지 않는다. 반환: {ok, opid, status, remain}"""
        dev, err = self._actuator_dev(unit, kind, n)
        if err:
            return err
        org = _origin({"src": "test"})
        opid = int(opid) if opid else self.opid.next()
        with self.lock:
            try:
                self.t.write(unit, dev["cmd"]["opid"], [opid])
                s = dev["status"]
                rb = self.t.read(unit, s["opid"], 4)
            except ModbusExc as e:
                self._event("command_exception", unit=unit, dev=f"{kind}{n}", op="opid", opid=opid, code=e.code, **org)
                return {"ok": False, "opid": opid, "exception": e.code, "error": str(e)}
            except TransportTimeout:
                self._event("command_timeout", unit=unit, dev=f"{kind}{n}", op="opid", opid=opid, **org)
                return {"ok": False, "opid": opid, "error": "timeout"}
        st = rb[1]; remain = regs_to_uint32(rb[2], rb[3])
        self._event("write_opid", unit=unit, dev=f"{kind}{n}", opid=opid, status=st, remain=remain, **org)
        return {"ok": True, "opid": opid, "status": st, "status_name": status_name(st), "remain": remain}

    def snapshot(self):
        return {"nodes": self.nodes, "state": self.state, "events": self.events[-50:],
                "frames": self.t.frames.recent(50) if hasattr(self.t, "frames") else [],
                "stats": getattr(getattr(self.t, "frames", None), "stats", {})}
