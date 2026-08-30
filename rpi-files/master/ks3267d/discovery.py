# -*- coding: utf-8 -*-
"""노드 탐색 (6.1.1 / 6.1.2 / 5.1) — 레지스터 1~8 → 디폴트맵 판정 → 101~(100+채널수) 디바이스 코드.

결과는 NodeDescriptor(dict). 스코프 밖(자동등록 노드, 레벨2/복합 노드, 미지원 코드)은
supported=False 와 reason 으로 **명시**한다 — 조용히 넘기지 않는다 (심사 화면에 그대로 보인다).
"""
from ks3267core import ksmap as M
from ks3267core.codec import regs_to_uint32

READ_CHUNK = 100  # 한 번에 읽는 최대 레지스터 수 (모드버스 한도 125 이내)


def discover(transport, unit):
    info = transport.read(unit, M.REG_CERT_AUTHORITY, 8)
    cert, company, ptype, pcode, ver, channels, s_lo, s_hi = info
    d = {
        "unit": unit,
        "cert_authority": cert, "company_code": company,
        "product_type": ptype, "product_code": pcode,
        "protocol_version": ver, "channels": channels,
        "serial": regs_to_uint32(s_lo, s_hi),
        "default_map": (cert == 0 and company == 0),
        "supported": True, "notes": [], "devices": [],
    }
    if not d["default_map"]:
        d["supported"] = False
        d["notes"].append("자동등록(KS X 3286) 노드 — 디폴트맵 전용 스코프 밖")
        return d
    if ver != M.PROTOCOL_VERSION:
        if ver == 101:
            d["notes"].append("프로토콜버전 101 (표 1 표기) — 표 9 의 10 과 상이, SPS 기준 10 기대")
        else:
            d["supported"] = False
            d["notes"].append(f"프로토콜버전 {ver} — 기대값 {M.PROTOCOL_VERSION}")
            return d

    if ptype == M.PRODUCT_SENSOR_NODE:
        d["kind"] = "sensor"
        n = min(channels, M.SENSOR_CHANNELS)
        if channels != M.SENSOR_CHANNELS:
            d["notes"].append(f"채널수 {channels} (디폴트맵 기대 {M.SENSOR_CHANNELS})")
        codes = _read_codes(transport, unit, n)
        for i, code in enumerate(codes, start=1):
            if code == M.DEV_NONE:
                continue
            expected = M.SENSOR_DEVICE_CODES.get(i)
            dev = {"index": i, "code": code, "name": M.SENSOR_NAMES.get(i, f"센서{i}"),
                   "value_reg": M.sensor_value_reg(i), "status_reg": M.sensor_status_reg(i)}
            if expected is not None and code != expected:
                dev["note"] = f"코드 {code} — 디폴트맵 위치 {i} 는 코드 {expected} 기대"
            d["devices"].append(dev)
    elif ptype == M.PRODUCT_ACTUATOR_NODE:
        d["kind"] = "actuator"
        n = min(channels, M.ACTUATOR_CHANNELS)
        if channels != M.ACTUATOR_CHANNELS:
            d["notes"].append(f"채널수 {channels} (디폴트맵 기대 {M.ACTUATOR_CHANNELS})")
        codes = _read_codes(transport, unit, n)
        for i, code in enumerate(codes, start=1):
            if code == M.DEV_NONE:
                continue
            kind, k = M.actuator_device_index(i)
            dev = {"index": i, "code": code, "kind": kind, "n": k}
            if kind == "switch" and code == M.DEV_SWITCH_L1:
                so, ss, rl, rh = M.switch_status_block(k); co, cp, tl, th = M.switch_cmd_block(k)
                dev.update(name=f"스위치{k}", level=1)
            elif kind == "opener" and code == M.DEV_OPENER_L1:
                so, ss, rl, rh = M.opener_status_block(k); co, cp, tl, th = M.opener_cmd_block(k)
                dev.update(name=f"개폐기{k}", level=1)
            else:
                dev.update(name=f"{kind}{k}", supported=False,
                           note=f"디바이스 코드 {code} — 디폴트맵 위치 {i} 기대 코드 "
                                f"{M.DEV_SWITCH_L1 if kind == 'switch' else M.DEV_OPENER_L1} (레벨1)")
                d["devices"].append(dev)
                continue
            dev.update(supported=True,
                       status={"opid": so, "status": ss, "remain": [rl, rh]},
                       cmd={"cmd": co, "opid": cp, "time": [tl, th]})
            d["devices"].append(dev)
    elif ptype == M.PRODUCT_INTEGRATED_NODE:
        d["kind"] = "integrated"; d["supported"] = False
        d["notes"].append("복합 노드(타입 3) — 디폴트맵은 센서/구동기 노드만 정의, 스코프 밖")
    else:
        d["kind"] = "unknown"; d["supported"] = False
        d["notes"].append(f"제품타입 {ptype} 미지원")
    return d


def _read_codes(transport, unit, n):
    codes = []
    addr = M.device_code_reg(1)
    while len(codes) < n:
        cnt = min(READ_CHUNK, n - len(codes))
        codes += transport.read(unit, addr + len(codes), cnt)
    return codes
