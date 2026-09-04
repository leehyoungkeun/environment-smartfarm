# -*- coding: utf-8 -*-
"""SPS-X KOAT-0004-7466:2022 §5.4 / §5.5 제어기 자가시험 — 시험장비(시뮬레이터) 상대로 실행해 증적을 남긴다.

역할 분담 (시험 문서 용어):
  시험대상장비 = 우리 통합제어기 (Node-RED + ks3267d 드라이버 + 화면)
  시험장비     = tools/ks3267-sim (센서 노드 unit 2 + 구동기 노드 unit 1, --ctl 제어 API 로 관측치/상태를 가상 변경)

시험 경로는 화면과 같은 경로를 탄다: NR POST /api/control/local (키오스크·웹 로컬 제어 입구)
  → control_handler → link → execute_control(ks3267 분기) → link → 표준 명령 조립 → ks3267d /command → FC16 → 시뮬레이터.
§5.5.2/5.5.3 의 "제어기의 인터페이스(화면)을 통해" 단계는 이 스크립트가 같은 REST 입구로 대신하고,
실제 화면 캡처(제어판 📐 배지·표준노드 탭)는 수동 증적 항목으로 report 에 남긴다.

실행 (RPi 1호):
  ~/smartfarm/ks3267/venv/bin/python ks3267d/selftest_sps7466.py --out ~/smartfarm/ks3267/evidence
결과: <out>/<timestamp>/report.md + results.json + frames.txt
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HOUSE = "house_0001"


# ── HTTP 도우미 ───────────────────────────────────────────────────────
def http(method, url, body=None, timeout=8):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw[:200]}


class Ctx:
    def __init__(self, a):
        self.daemon, self.sim, self.nr = a.daemon.rstrip("/"), a.sim_ctl.rstrip("/"), a.nr.rstrip("/")
        self.su, self.au = a.sensor_unit, a.actuator_unit
        self.poll = a.poll
        self.results = []   # {id, title, ref, steps:[{step, ok, detail}], ok}
        self.manual = []    # 수동 증적 항목

    # 데몬
    def d_get(self, path, **q):
        qs = urllib.parse.urlencode(q)
        return http("GET", f"{self.daemon}{path}{'?' + qs if qs else ''}")[1]

    def d_status(self, unit):
        return self.d_get("/status", unit=unit).get("state") or {}

    # 시험장비(시뮬레이터 제어 API)
    def s_get(self, path, **q):
        qs = urllib.parse.urlencode(q)
        return http("GET", f"{self.sim}{path}{'?' + qs if qs else ''}")[1]

    def s_post(self, path, body):
        return http("POST", f"{self.sim}{path}", body)[1]

    # 제어기 화면과 같은 입구 (로컬 제어 REST)
    def ui_control(self, device_id, command, duration, modbus):
        return http("POST", f"{self.nr}/api/control/local", {
            "house_id": HOUSE, "device_id": device_id, "command": command,
            "operator": "selftest_sps7466", "duration": duration, "modbus": modbus}, timeout=15)

    def wait_polls(self, n=2):
        time.sleep(self.poll * n + 0.3)

    def wait_until(self, fn, timeout, every=0.5):
        end = time.time() + timeout
        last = None
        while time.time() < end:
            last = fn()
            if last:
                return last
            time.sleep(every)
        return last


class Test:
    def __init__(self, ctx, tid, title, ref):
        self.ctx, self.id, self.title, self.ref = ctx, tid, title, ref
        self.steps = []

    def step(self, name, ok, detail=""):
        self.steps.append({"step": name, "ok": bool(ok), "detail": str(detail)[:600]})
        print(f"  [{'OK' if ok else 'FAIL'}] {self.id} {name} {('— ' + str(detail)[:120]) if detail else ''}")
        return ok

    def done(self):
        ok = all(s["ok"] for s in self.steps) and bool(self.steps)
        self.ctx.results.append({"id": self.id, "title": self.title, "ref": self.ref, "ok": ok, "steps": self.steps})
        print(f"{'PASS' if ok else 'FAIL'} {self.id} {self.title}\n")
        return ok


# ── §5.4.1 연결시험 ────────────────────────────────────────────────────
def t_541(c):
    t = Test(c, "5.4.1", "연결시험", "SPS-7466 §5.4.1")
    h = c.d_get("/health")
    t.step("a)~d) 시험장비-제어기 통신 연결 (드라이버 /health)", h.get("ok") is True, h)
    s = c.s_get("/health")
    t.step("시험장비(시뮬레이터) 응답", s.get("ok") is True, s)
    return t.done()


# ── §5.4.2 디폴트 레지스터맵 센서 노드 검색 ───────────────────────────
def t_542(c):
    t = Test(c, "5.4.2", "디폴트 레지스터맵 센서 노드 검색 시험", "SPS-7466 §5.4.2 (KS X 3267 §5.1.2 노드정보 1~8)")
    spec = c.s_get("/state", unit=c.su)             # b) 시험장비 노드 스펙 (연결 센서 개수·종류)
    d = c.d_get("/discover", unit=c.su)             # c) 제어기에서 노드정보 읽기
    node = d.get("node") or {}
    t.step("b) 시험장비 노드 스펙 조회", spec.get("ok"), f"attached={spec.get('attached')}")
    t.step("c) 디폴트 레지스터맵 센서 노드 인지", d.get("ok") and node.get("kind") == "sensor" and node.get("default_map") and node.get("supported"),
           {k: node.get(k) for k in ("kind", "default_map", "supported", "product_type", "protocol_version", "channels", "serial")})
    t.step("   노드정보 1~6 디폴트값 (기관 0, 회사 0, 제품타입 1, 제품코드 0, 프로토콜 10, 채널 30)",
           node.get("cert_authority") == 0 and node.get("company_code") == 0 and node.get("product_type") == 1
           and node.get("product_code") == 0 and node.get("protocol_version") == 10 and node.get("channels") == 30)
    got = {int(x["index"]): int(x["code"]) for x in node.get("devices", [])}
    exp = {int(k): int(v) for k, v in (spec.get("devices") or {}).items()}
    t.step("d) 연결된 센서 개수·종류가 설정대로 인식", got == exp, f"제어기={sorted(got.items())} 시험장비={sorted(exp.items())}")
    return t.done()


# ── §5.4.3 데이터 확인 시험 ────────────────────────────────────────────
def t_543(c):
    t = Test(c, "5.4.3", "데이터 확인 시험", "SPS-7466 §5.4.3 (관측치 CDAB float, 상태코드)")
    idx = 1  # 온도 (디폴트맵 순번 1)
    for v in (21.5, 30.25, -3.0, 28.8):
        c.s_post("/sensor", {"unit": c.su, "index": idx, "value": v})              # a) 관측치 가상 변경
        got = c.wait_until(lambda: (lambda s: s if s and abs(float(s.get("value", 1e9)) - v) < 0.01 else None)(
            (c.d_status(c.su).get("sensors") or {}).get(str(idx))), timeout=c.poll * 3 + 1)
        t.step(f"b) 관측치 {v} 읽기", got is not None, got)                          # b) 제어기가 정상적으로 읽는가
    for st, name in ((103, "NEED_CHECK"), (102, "NEED_CALIBRATION"), (0, "READY")):
        c.s_post("/sensor", {"unit": c.su, "index": idx, "value": 28.8, "status": st})   # c) 상태 가상 변경
        got = c.wait_until(lambda: (lambda s: s if s and int(s.get("status", -1)) == st else None)(
            (c.d_status(c.su).get("sensors") or {}).get(str(idx))), timeout=c.poll * 3 + 1)
        t.step(f"d) 센서 상태 {st}({name}) 읽기", got is not None and got.get("status_name") == name, got)
    c.manual.append("§5.4.4 데이터 저장 시험(10분 이상): 센서를 하우스/센서 탭에서 표준 노드에 매핑(temp_std ← U2 센서1) 후 "
                    "10분 뒤 API `GET /api/sensors/farm_0001/house_0001/history?startDate=…` 로 1분 단위 저장 확인 — 이 스크립트는 운영 houseConfig 를 건드리지 않는다")
    return t.done()


# ── §5.5.1 디폴트 레지스터맵 구동기 노드 검색 ───────────────────────
def t_551(c):
    t = Test(c, "5.5.1", "디폴트 레지스터맵 구동기 노드 검색 시험", "SPS-7466 §5.5.1")
    spec = c.s_get("/state", unit=c.au)
    d = c.d_get("/discover", unit=c.au)
    node = d.get("node") or {}
    t.step("c) 디폴트 레지스터맵 구동기 노드 인지", d.get("ok") and node.get("kind") == "actuator" and node.get("default_map") and node.get("supported"),
           {k: node.get(k) for k in ("kind", "product_type", "protocol_version", "channels")})
    t.step("   노드정보: 제품타입 2, 프로토콜 10, 채널 24", node.get("product_type") == 2 and node.get("protocol_version") == 10 and node.get("channels") == 24)
    got = {int(x["index"]): int(x["code"]) for x in node.get("devices", [])}
    exp = {int(k): int(v) for k, v in (spec.get("devices") or {}).items()}
    t.step("d) 연결된 구동기 개수·종류(코드 102 스위치/112 개폐기 레벨1)가 설정대로 인식", got == exp,
           f"제어기 {len(got)}개 / 시험장비 {len(exp)}개, 불일치={sorted(set(got.items()) ^ set(exp.items()))[:6]}")
    return t.done()


def _dev_state(c, kind, n):
    st = c.d_status(c.au)
    for d in (st.get("devices") or {}).values():
        if d.get("kind") == kind and int(d.get("n", 0)) == n:
            return d
    return None


def _sim_cmd(c, kind, n):
    """시험장비가 마지막으로 받은 명령 블록 (cmd, opid, time) + 현재 상태"""
    s = c.s_get("/device", unit=c.au, kind=kind, n=n)
    return s


# ── §5.5.2 레벨 1 스위치 제어 시험 ───────────────────────────────────
def _measure_remain_period(c, kind, n, seconds=4.0, every=0.2):
    """e) 남은 작동시간 업데이트 주기 측정 — 시험장비(노드) 레지스터를 짧게 되읽어 remain 이 바뀌는 간격을 잰다.
    (드라이버 폴링 주기 c.poll 와 구분: 노드 갱신 주기 vs 제어기 표시 주기)"""
    end = time.time() + seconds
    last = None; changes = []
    while time.time() < end:
        s = _sim_cmd(c, kind, n)
        r = s.get("remain") if s else None
        now = time.time()
        if r is not None and r != last:
            if last is not None:
                changes.append(now)
            last = r
        time.sleep(every)
    if len(changes) >= 2:
        gaps = [b - a for a, b in zip(changes, changes[1:])]
        return round(sum(gaps) / len(gaps), 2), len(changes)
    return None, len(changes)


def _stopped_ok(d, cmd_opid):
    """READY 판정 + OPID 기록. 표준 g)/m) 는 'OPID 동일' 을 묻고, 표 16 은 '실행 중 명령 없으면 0' 이라
    두 해석이 겹친다 → READY 이고 OPID 가 명령 OPID 와 같거나 0 이면 통과, 어느 쪽인지 detail 에 남긴다."""
    if not d or d.get("status") != 0:
        return False, "READY 아님"
    o = d.get("opid")
    if o == cmd_opid:
        return True, f"READY, OPID 동일({o})"
    if o == 0:
        return True, f"READY, OPID 0 (표 16: 실행 중 명령 없음) — 명령 OPID 는 {cmd_opid}"
    return False, f"READY 이나 OPID 불일치: 상태 {o} ≠ 명령 {cmd_opid}"


# ── §5.5.2 레벨 1 스위치 제어 시험 — b)~m) 완전판 (2026-09-04) ─────────────────
def t_552(c, n=1, seconds=12):
    t = Test(c, "5.5.2", "레벨 1 스위치 제어 시험", "SPS-7466 §5.5.2 / 5.2.1 b)~m) (202 TIMED_ON → 만료 → 202 → 0 OFF)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "switch", "n": n}
    dev = f"kstest_sw{n}"
    wait_on = c.poll * 3 + 2

    # ── b)~g) 작동시간 명령 → 작동중 확인 → 남은시간 감소·주기 → 자연 만료 → READY ──
    r = c.ui_control(dev, "on", seconds, mb)
    t.step(f"b) 쓰기영역에 작동시간 작동 명령 (OPID·202·{seconds}s) — 제어기 화면 경로", r[0] == 200 and r[1].get("success"), r[1])
    got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 202 and s.get("time") == seconds else None)(_sim_cmd(c, "switch", n)), 10)
    t.step("c) 시험장비가 202 + 동일 작동시간 수신 → 작동", got is not None, got)
    opid1 = got.get("cmd_opid") if got else None
    st1 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 201 else None)(_dev_state(c, "switch", n)), wait_on)
    t.step("d) 읽기영역: OPID 동일 + 상태 작동중(201)", st1 is not None and st1.get("opid") == opid1, f"명령 OPID {opid1} / 읽은 {st1}")
    r1 = st1.get("remain") if st1 else None
    period, nchg = _measure_remain_period(c, "switch", n)
    st2 = _dev_state(c, "switch", n)
    t.step("d') 남은 작동시간이 적절히 줄어든다", st2 and r1 is not None and 0 < st2.get("remain", 0) < r1, f"{r1} → {st2 and st2.get('remain')}")
    t.step("e) 남은시간 업데이트 주기 (노드 레지스터 직접 측정)", period is not None and 0.5 <= period <= 2.5,
           f"노드 갱신 주기 ≈ {period}s ({nchg}회 변화 관측) / 제어기 폴링·표시 주기 {c.poll}s")
    stf = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "switch", n)), seconds + wait_on)
    t.step(f"f) 정해진 작동시간({seconds}s) 후 스스로 중지", stf is not None and stf.get("remain") == 0, stf)
    ok, why = _stopped_ok(stf, opid1)
    t.step("g) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0)", ok, why)

    # ── h)~m) 다시 작동시간 명령 → 작동중 → 작동중지 명령(0) → READY ──
    r = c.ui_control(dev, "on", seconds, mb)
    t.step(f"h) 다시 작동시간 작동 명령 (OPID·202·{seconds}s)", r[0] == 200 and r[1].get("success"), r[1])
    got2 = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 202 and s.get("cmd_opid") not in (None, opid1) else None)(_sim_cmd(c, "switch", n)), 10)
    t.step("i) 시험장비가 202 수신 (OPID 는 매 명령 변경)", got2 is not None, f"{got2} (이전 OPID {opid1})")
    opid2 = got2.get("cmd_opid") if got2 else None
    st3 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 201 else None)(_dev_state(c, "switch", n)), wait_on)
    t.step("j) 읽기영역: OPID 동일 + 상태 작동중(201)", st3 is not None and st3.get("opid") == opid2, f"명령 OPID {opid2} / 읽은 {st3}")
    r = c.ui_control(dev, "off", 0, mb)
    t.step("k) 쓰기영역에 작동중지 명령 (OPID·0)", r[0] == 200 and r[1].get("success"), r[1])
    got3 = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 0 and s.get("cmd_opid") not in (None, opid2) else None)(_sim_cmd(c, "switch", n)), 10)
    t.step("l) 시험장비가 0 수신 → 중지", got3 is not None, got3)
    opid3 = got3.get("cmd_opid") if got3 else None
    st4 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "switch", n)), wait_on)
    ok, why = _stopped_ok(st4, opid3)
    t.step("m) 읽기영역: 중지 후 OPID 확인 + 상태 READY(0)", ok and st4.get("remain") == 0, why)
    c.manual.append(f"§5.5.2 화면 증적: 제어판 {dev} 「📐 시간 지정 ON」 {seconds}초 → 📐 배지 '켜짐 NNs' 감소 → 'READY' 자동 복귀 캡처, "
                    "표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s), ④ 진단 프레임(FC16 503~506 / FC03 203~206)")
    return t.done()


# ── §5.5.3 레벨 1 개폐기 제어 시험 ───────────────────────────────────
def t_553(c, n=1, seconds=12):
    """§5.5.3 b)~s): 작동시간 열기(303) → 열림중·남은시간·주기 → 중지(0) → READY → 작동시간 닫기(304) → 닫힘중 → 중지 → READY.
    매 되읽기에서 OPID 동일 판정, 재명령 시 OPID 변경 확인 (2026-09-04 완전판)."""
    t = Test(c, "5.5.3", "레벨 1 개폐기 제어 시험", "SPS-7466 §5.5.3 b)~s) (303 TIMED_OPEN / 304 TIMED_CLOSE / 0 STOP)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "opener", "n": n, "controlType": "bidir"}
    dev = f"kstest_op{n}"
    wait_on = c.poll * 3 + 2
    prev_opid = None
    for cmd, code, stname, label, steps in (("open", 303, 301, "열기", "b)c)d)e)f)g)h)i)j)"), ("close", 304, 302, "닫기", "k)l)m)n)o)p)q)r)s)")):
        s = steps.replace(")", ") ").split()
        r = c.ui_control(dev, cmd, seconds, mb)
        t.step(f"{s[0]} 쓰기영역에 작동시간 {label} 명령 (OPID·{code}·{seconds}s) — 제어기 화면 경로", r[0] == 200 and r[1].get("success"), r[1])
        got = c.wait_until(lambda: (lambda x: x if x and x.get("cmd") == code and x.get("time") == seconds and x.get("cmd_opid") not in (None, prev_opid) else None)(_sim_cmd(c, "opener", n)), 10)
        t.step(f"{s[1]} 시험장비가 {code} + 동일 작동시간 수신 (OPID 는 매 명령 변경)", got is not None, f"{got} (이전 OPID {prev_opid})")
        opid = got.get("cmd_opid") if got else None
        st1 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == stname else None)(_dev_state(c, "opener", n)), wait_on)
        t.step(f"{s[2]}{s[3]} 읽기영역: OPID 동일 + 상태 {'열림중' if stname == 301 else '닫힘중'}({stname}) 표시", st1 is not None and st1.get("opid") == opid, f"명령 OPID {opid} / 읽은 {st1}")
        r1 = st1.get("remain") if st1 else None
        period, nchg = _measure_remain_period(c, "opener", n)
        st2 = _dev_state(c, "opener", n)
        t.step(f"{s[4]} 남은 작동시간이 적절히 표시·감소 (노드 갱신 주기 ≈ {period}s, 제어기 표시 주기 {c.poll}s)",
               st2 and r1 is not None and 0 < st2.get("remain", 0) < r1 and period is not None and 0.5 <= period <= 2.5, f"{r1} → {st2 and st2.get('remain')} / {nchg}회 변화")
        r = c.ui_control(dev, "stop", 0, mb)
        t.step(f"{s[5]} 쓰기영역에 중지 명령 (OPID·0) — 제어기 화면 경로", r[0] == 200 and r[1].get("success"), r[1])
        got2 = c.wait_until(lambda: (lambda x: x if x and x.get("cmd") == 0 and x.get("cmd_opid") not in (None, opid) else None)(_sim_cmd(c, "opener", n)), 10)
        t.step(f"{s[6]}{s[7]} 시험장비가 0 수신 → 중지중", got2 is not None, got2)
        opid_stop = got2.get("cmd_opid") if got2 else None
        st3 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "opener", n)), wait_on)
        ok, why = _stopped_ok(st3, opid_stop)
        t.step(f"{s[8]} 읽기영역: 중지중(READY) 표시 + OPID 확인", ok and st3.get("remain") == 0, why)
        prev_opid = opid_stop
    c.manual.append(f"§5.5.3 화면 증적: 제어판 {dev} 카드 「📐 작동시간」 {seconds}초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → ■ 정지 → 'READY' → ⏱ 시간 닫기 → '닫히는 중 NNs' → 정지 캡처, "
                    "표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)")
    return t.done()


# ── 추가: 스코프 선언 일치 (레벨2 명령을 제어기가 만들지 않는다) ─────────
def t_extra_level2(c):
    t = Test(c, "부가-L2", "레벨2 명령 미생성 (스코프 선언: 디폴트맵·레벨1 전용)", "KS X 3267 6.3.4 / 116 연동장비표 레벨2 ×")
    r = http("POST", f"{c.daemon}/command", {"unit": c.au, "kind": "opener", "n": 1, "op": "set_position", "seconds": 0})[1]
    t.step("드라이버가 레벨2(SET_POSITION) 를 로컬에서 거부 (버스로 안 나감)", r.get("ok") is False and "미지원" in str(r.get("error", "")), r)
    before = c.s_get("/device", unit=c.au, kind="opener", n=1)
    t.step("시험장비 명령 블록 변화 없음", before.get("cmd") in (0, None) or before.get("opid") == before.get("opid"), before)
    return t.done()


# ── 보고서 ────────────────────────────────────────────────────────────
def write_report(c, out, meta):
    os.makedirs(out, exist_ok=True)
    frames = c.d_get("/frames", n=400)
    events = c.d_get("/events", n=200)
    with open(os.path.join(out, "results.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "results": c.results, "manual": c.manual, "stats": frames.get("stats"), "events": events.get("events")}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out, "frames.txt"), "w", encoding="utf-8") as f:
        for fr in frames.get("frames", []):
            ts = dt.datetime.fromtimestamp(fr.get("t", 0)).strftime("%H:%M:%S.%f")[:-3]
            f.write(f"{ts} {fr.get('dir'):2} {fr.get('hex')}\n")
    passed = sum(1 for r in c.results if r["ok"]); total = len(c.results)
    L = [f"# SPS-X KOAT-0004-7466 §5.4/§5.5 자가시험 보고서", "",
         f"- 일시: {meta['at']}", f"- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: {meta.get('transport')}",
         f"- 시험장비: KS X 3267 디폴트맵 노드 시뮬레이터 (센서 unit {c.su}, 구동기 unit {c.au})",
         f"- 결과: **{passed}/{total} 통과**", f"- 프레임: TX {frames.get('stats', {}).get('tx')} / RX {frames.get('stats', {}).get('rx')} / 예외 {frames.get('stats', {}).get('exceptions')} / 타임아웃 {frames.get('stats', {}).get('timeouts')} (frames.txt)", "",
         "| 시험 | 항목 | 근거 | 결과 |", "|---|---|---|---|"]
    for r in c.results:
        L.append(f"| {r['id']} | {r['title']} | {r['ref']} | {'✅ 통과' if r['ok'] else '❌ 실패'} |")
    L.append("")
    for r in c.results:
        L += [f"## {r['id']} {r['title']}", ""]
        for s in r["steps"]:
            L.append(f"- {'✅' if s['ok'] else '❌'} {s['step']}" + (f" — `{s['detail']}`" if s["detail"] else ""))
        L.append("")
    L += ["## 수동 증적 항목 (화면 캡처·저장 확인)", ""] + [f"- [ ] {m}" for m in c.manual] + [""]
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print(f"\n보고서: {os.path.join(out, 'report.md')}  ({passed}/{total} 통과)")
    return passed == total


def main():
    p = argparse.ArgumentParser(description="SPS-7466 §5.4/5.5 제어기 자가시험")
    p.add_argument("--daemon", default="http://127.0.0.1:3002")
    p.add_argument("--sim-ctl", default="http://127.0.0.1:5030")
    p.add_argument("--nr", default="http://127.0.0.1:1880")
    p.add_argument("--sensor-unit", type=int, default=2)
    p.add_argument("--actuator-unit", type=int, default=1)
    p.add_argument("--poll", type=float, default=2.0, help="드라이버 폴링 주기(초) — 대기 시간 계산용")
    p.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "evidence"))
    p.add_argument("--only", default="", help="예: 5.5.2,5.5.3")
    a = p.parse_args()
    c = Ctx(a)
    at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    health = c.d_get("/health")
    if not health.get("ok"):
        print("드라이버(ks3267d) 응답 없음:", health); sys.exit(2)
    tests = [("5.4.1", t_541), ("5.4.2", t_542), ("5.4.3", t_543), ("5.5.1", t_551), ("5.5.2", t_552), ("5.5.3", t_553), ("부가-L2", t_extra_level2)]
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    for tid, fn in tests:
        if only and tid not in only:
            continue
        try:
            fn(c)
        except Exception as e:  # 한 시험이 터져도 나머지는 돌린다
            c.results.append({"id": tid, "title": fn.__doc__ or tid, "ref": "", "ok": False, "steps": [{"step": "예외", "ok": False, "detail": repr(e)}]})
            print(f"FAIL {tid} 예외: {e!r}\n")
    out = os.path.join(a.out, dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    ok = write_report(c, out, {"at": at, "transport": health.get("transport")})
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
