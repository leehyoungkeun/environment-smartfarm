# -*- coding: utf-8 -*-
"""KS X 3267:2022 부속서 A 디폴트 레지스터 맵 — 공식이 단일 출처.

부속서 A 의 표를 공식으로 환원했다 (docs/ksx3267/PLAN.md 1절). 시뮬레이터·드라이버·테스트가
전부 이 모듈을 쓰므로, 표준 해석이 바뀌면 여기 한 곳만 고친다.

원문 오탈자(시험기관 확인 대상): A.2.5 reg 220 타입, reg 245 번호, OPID #21 중복(283/287).
이 모듈은 공식을 따르고(순차), 오탈자는 따르지 않는다.
"""

# ── 노드 정보 (모든 노드 공통, reg 1~8) ──────────────────────────────
REG_CERT_AUTHORITY = 1
REG_COMPANY_CODE = 2
REG_PRODUCT_TYPE = 3
REG_PRODUCT_CODE = 4
REG_PROTOCOL_VERSION = 5
REG_CHANNEL_NUMBER = 6
REG_SERIAL_LO = 7   # uint32 — 워드 간 little-endian: 7 = 하위, 8 = 상위
REG_SERIAL_HI = 8
REG_DEVICE_CODE_BASE = 100  # 디바이스 i 의 코드 = 100 + i

PROTOCOL_VERSION = 10  # 표 9: 이 표준을 따르는 제품은 10 (10진수)

# 제품 타입 (B.1)
PRODUCT_SENSOR_NODE = 1
PRODUCT_ACTUATOR_NODE = 2
PRODUCT_INTEGRATED_NODE = 3

# 디바이스 코드 (A.1.2 / A.2.2)
DEV_NONE = 0
DEV_SWITCH_L1 = 102
DEV_OPENER_L1 = 112
SENSOR_DEVICE_CODES = {  # A.1.2 — 디바이스 순번 i → 장치코드
    1: 1, 2: 1, 3: 1,          # 온도 1~3
    4: 2,                      # 습도 1
    5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 12: 10,
    13: 11, 14: 12, 15: 13, 16: 14, 17: 15, 18: 16, 19: 17,
    20: 1, 21: 1, 22: 1, 23: 1, 24: 1, 25: 1, 26: 1,  # 온도 4~10
    27: 2, 28: 2,              # 습도 2~3
    29: 18, 30: 18,            # 무게 1~2
}
SENSOR_NAMES = {
    1: "온도1", 2: "온도2", 3: "온도3", 4: "습도1", 5: "이슬점", 6: "감우", 7: "유량", 8: "강우",
    9: "일사", 10: "풍속", 11: "풍향", 12: "전압", 13: "CO2", 14: "EC", 15: "광양자",
    16: "토양함수율", 17: "토양수분장력", 18: "pH", 19: "지온", 20: "온도4", 21: "온도5",
    22: "온도6", 23: "온도7", 24: "온도8", 25: "온도9", 26: "온도10", 27: "습도2", 28: "습도3",
    29: "무게1", 30: "무게2",
}

SENSOR_CHANNELS = 30   # A.1.1 채널수
ACTUATOR_CHANNELS = 24 # A.2.1 채널수 (스위치 16 + 개폐기 8)
SWITCH_COUNT = 16
OPENER_COUNT = 8

# 상태 코드 (B.2)
ST_READY = 0
ST_ERROR = 1
ST_BUSY = 2
ST_VOLTAGE_ERROR = 3
ST_CURRENT_ERROR = 4
ST_TEMPERATURE_ERROR = 5
ST_FUSE_ERROR = 6
ST_SENSOR_NEED_REPLACE = 101
ST_SENSOR_NEED_CALIBRATION = 102
ST_SENSOR_NEED_CHECK = 103
ST_SWITCH_ON = 201
ST_SWITCH_USER_CONTROL = 299
ST_OPENER_OPENING = 301
ST_OPENER_CLOSING = 302
ST_OPENER_MANUAL_CONTROL = 399

# 제어 명령 코드 (B.3)
OP_CONTROL = 2
OP_SWITCH_OFF = 0
OP_SWITCH_ON = 201
OP_SWITCH_TIMED_ON = 202
OP_SWITCH_DIRECTIONAL_ON = 203  # 레벨2 — 미지원
OP_OPENER_STOP = 0
OP_OPENER_OPEN = 301
OP_OPENER_CLOSE = 302
OP_OPENER_TIMED_OPEN = 303
OP_OPENER_TIMED_CLOSE = 304
OP_OPENER_SET_POSITION = 305   # 레벨2 — 미지원
OP_OPENER_SET_CONFIG = 306     # 레벨2 — 미지원

# 제어권 (B.4)
CTRL_LOCAL = 1
CTRL_REMOTE = 2
CTRL_MANUAL = 3


# ── 센서 노드 주소 공식 (A.1.3 / A.1.4) ─────────────────────────────
SENSOR_NODE_STATUS = 202

def sensor_value_reg(i):
    """센서 i (1..30) 의 값(float, 2 워드) 시작 주소 → 203 + 3(i-1)"""
    _chk(i, 1, SENSOR_CHANNELS)
    return 203 + 3 * (i - 1)

def sensor_status_reg(i):
    """센서 i 의 상태(uint16) → 205 + 3(i-1)"""
    _chk(i, 1, SENSOR_CHANNELS)
    return 205 + 3 * (i - 1)


# ── 구동기 노드 주소 공식 (A.2.3 ~ A.2.6) ────────────────────────────
ACT_NODE_OPID = 201
ACT_NODE_STATUS = 202
ACT_NODE_CMD = 501
ACT_NODE_CMD_OPID = 502

def switch_status_block(k):
    """스위치 k (1..16) 상태 블록: (opid, status, remain_lo, remain_hi) 주소"""
    _chk(k, 1, SWITCH_COUNT)
    base = 203 + 4 * (k - 1)
    return base, base + 1, base + 2, base + 3

def opener_status_block(j):
    """개폐기 j (1..8) 상태 블록: (opid, status, remain_lo, remain_hi) 주소"""
    _chk(j, 1, OPENER_COUNT)
    base = 267 + 4 * (j - 1)
    return base, base + 1, base + 2, base + 3

def switch_cmd_block(k):
    """스위치 k 명령 블록: (cmd, opid, time_lo, time_hi) 주소"""
    _chk(k, 1, SWITCH_COUNT)
    base = 503 + 4 * (k - 1)
    return base, base + 1, base + 2, base + 3

def opener_cmd_block(j):
    """개폐기 j 명령 블록: (cmd, opid, time_lo, time_hi) 주소"""
    _chk(j, 1, OPENER_COUNT)
    base = 567 + 4 * (j - 1)
    return base, base + 1, base + 2, base + 3

def device_code_reg(i):
    """노드 부착 디바이스 i 의 코드 주소 → 100 + i"""
    return REG_DEVICE_CODE_BASE + i

def actuator_device_index(i):
    """구동기 노드 디바이스 순번 i (1..24) → ('switch', k) | ('opener', j)"""
    _chk(i, 1, ACTUATOR_CHANNELS)
    if i <= SWITCH_COUNT:
        return "switch", i
    return "opener", i - SWITCH_COUNT


def _chk(v, lo, hi):
    if not (lo <= v <= hi):
        raise ValueError(f"index {v} out of range {lo}..{hi}")


def build_map(kind):
    """사람이 읽는 맵 (map.json 용). kind = 'sensor' | 'actuator'"""
    m = {"kind": kind, "protocol_version": PROTOCOL_VERSION, "node_info": {
        "cert_authority": REG_CERT_AUTHORITY, "company_code": REG_COMPANY_CODE,
        "product_type": REG_PRODUCT_TYPE, "product_code": REG_PRODUCT_CODE,
        "protocol_version": REG_PROTOCOL_VERSION, "channel_number": REG_CHANNEL_NUMBER,
        "serial": [REG_SERIAL_LO, REG_SERIAL_HI]}}
    if kind == "sensor":
        m["product_type"] = PRODUCT_SENSOR_NODE
        m["channels"] = SENSOR_CHANNELS
        m["node_status"] = SENSOR_NODE_STATUS
        m["devices"] = [{"index": i, "name": SENSOR_NAMES[i], "code_reg": device_code_reg(i),
                         "device_code": SENSOR_DEVICE_CODES[i],
                         "value_reg": sensor_value_reg(i), "status_reg": sensor_status_reg(i)}
                        for i in range(1, SENSOR_CHANNELS + 1)]
    elif kind == "actuator":
        m["product_type"] = PRODUCT_ACTUATOR_NODE
        m["channels"] = ACTUATOR_CHANNELS
        m["node"] = {"opid": ACT_NODE_OPID, "status": ACT_NODE_STATUS,
                     "cmd": ACT_NODE_CMD, "cmd_opid": ACT_NODE_CMD_OPID}
        devs = []
        for i in range(1, ACTUATOR_CHANNELS + 1):
            kind_i, n = actuator_device_index(i)
            if kind_i == "switch":
                so, ss, sl, sh = switch_status_block(n); co, cp, cl, ch = switch_cmd_block(n)
                code = DEV_SWITCH_L1; name = f"스위치{n}"
            else:
                so, ss, sl, sh = opener_status_block(n); co, cp, cl, ch = opener_cmd_block(n)
                code = DEV_OPENER_L1; name = f"개폐기{n}"
            devs.append({"index": i, "kind": kind_i, "n": n, "name": name,
                         "code_reg": device_code_reg(i), "device_code": code,
                         "status": {"opid": so, "status": ss, "remain": [sl, sh]},
                         "cmd": {"cmd": co, "opid": cp, "time": [cl, ch]}})
        m["devices"] = devs
    else:
        raise ValueError(kind)
    return m


if __name__ == "__main__":
    import json, sys
    kind = sys.argv[1] if len(sys.argv) > 1 else "actuator"
    print(json.dumps(build_map(kind), ensure_ascii=False, indent=2))
