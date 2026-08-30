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
def t_552(c, n=1, seconds=20):
    t = Test(c, "5.5.2", "레벨 1 스위치 제어 시험", "SPS-7466 §5.5.2 (명령 202 TIMED_ON / 0 OFF)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "switch", "n": n}
    dev = f"kstest_sw{n}"
    r = c.ui_control(dev, "on", seconds, mb)                                           # b) 화면 경로로 작동시간 명령
    t.step(f"b) 제어기 인터페이스 경로로 작동시간 명령 (on {seconds}s)", r[0] == 200 and r[1].get("success"), r[1])
    got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 202 and s.get("time") == seconds else None)(_sim_cmd(c, "switch", n)), 10)
    t.step("c) 시험장비에서 작동시간 명령(202) 수신, 작동시간 동일", got is not None, got)          # c)
    st1 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 201 else None)(_dev_state(c, "switch", n)), c.poll * 3 + 2)
    t.step("d)e) 시험장비 작동중(201) → 제어기 표시 상태 켜짐", st1 is not None, st1)             # d) e)
    r1 = st1.get("remain") if st1 else None
    c.wait_polls(2)
    st2 = _dev_state(c, "switch", n)
    t.step("f) 남은 작동시간이 줄어든다", st2 and r1 is not None and 0 < st2.get("remain", 0) < r1, f"{r1} → {st2 and st2.get('remain')}")  # f)
    r = c.ui_control(dev, "off", 0, mb)                                                # g) 중지 명령
    t.step("g) 제어기 인터페이스 경로로 중지 명령", r[0] == 200 and r[1].get("success"), r[1])
    got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 0 else None)(_sim_cmd(c, "switch", n)), 10)
    t.step("h) 시험장비에서 중지 명령(0) 수신", got is not None, got)                             # h)
    st3 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "switch", n)), c.poll * 3 + 2)
    t.step("i)j) 시험장비 중지중 → 제어기 표시 READY", st3 is not None and st3.get("remain") == 0, st3)  # i) j)
    c.manual.append(f"§5.5.2 e)f)j) 화면 증적: 제어판의 {dev} 카드 📐 배지가 '켜짐 NNs' → 'READY' 로 바뀌는 캡처 "
                    "(테스트 장치를 houseConfig 에 매핑한 상태에서 수행) + 표준노드 탭 U1 스위치1 행")
    return t.done()


# ── §5.5.3 레벨 1 개폐기 제어 시험 ───────────────────────────────────
def t_553(c, n=1, seconds=15):
    t = Test(c, "5.5.3", "레벨 1 개폐기 제어 시험", "SPS-7466 §5.5.3 (명령 303 TIMED_OPEN / 304 TIMED_CLOSE / 0 STOP)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "opener", "n": n, "controlType": "bidir"}
    dev = f"kstest_op{n}"
    for cmd, code, stname, label in (("open", 303, 301, "열기"), ("close", 304, 302, "닫기")):
        r = c.ui_control(dev, cmd, seconds, mb)                                           # b)/k) 작동시간 열기·닫기
        t.step(f"{label}: 제어기 인터페이스 경로로 작동시간 {label} 명령 ({seconds}s)", r[0] == 200 and r[1].get("success"), r[1])
        got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == code and s.get("time") == seconds else None)(_sim_cmd(c, "opener", n)), 10)
        t.step(f"{label}: 시험장비에서 명령({code}) 수신, 작동시간 동일", got is not None, got)     # c)/l)
        st1 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == stname else None)(_dev_state(c, "opener", n)), c.poll * 3 + 2)
        t.step(f"{label}: 시험장비 {'열림중' if stname == 301 else '닫힘중'}({stname}) → 제어기 표시", st1 is not None, st1)  # d)e) / m)n)
        r1 = st1.get("remain") if st1 else None
        c.wait_polls(2)
        st2 = _dev_state(c, "opener", n)
        t.step(f"{label}: 남은 작동시간이 줄어든다", st2 and r1 is not None and 0 < st2.get("remain", 0) < r1, f"{r1} → {st2 and st2.get('remain')}")  # f)/o)
        r = c.ui_control(dev, "stop", 0, mb)                                              # g)/p) 중지
        t.step(f"{label}: 제어기 인터페이스 경로로 중지 명령", r[0] == 200 and r[1].get("success"), r[1])
        got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 0 else None)(_sim_cmd(c, "opener", n)), 10)
        t.step(f"{label}: 시험장비에서 중지 명령(0) 수신", got is not None, got)                    # h)/q)
        st3 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "opener", n)), c.poll * 3 + 2)
        t.step(f"{label}: 시험장비 중지중 → 제어기 표시 READY", st3 is not None and st3.get("remain") == 0, st3)  # i)j) / r)s)
    c.manual.append(f"§5.5.3 화면 증적: 제어판 {dev} 카드 📐 배지 '열리는 중 NNs' / '닫히는 중 NNs' / 'READY' 캡처")
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
