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
        # §5.4.4 — 서버 되읽기 (농장 키). 자가시험 기본 목록엔 넣지 않는다(10분 이상 걸림) → --only 5.4.4
        self.server = getattr(a, "server", "https://api.smartgreen.kr").rstrip("/")
        self.api_key_file = getattr(a, "api_key_file", "/home/lhk/smartfarm/.sensor-api-key")
        self.duration = getattr(a, "duration", 600)
        self.farm_id = _read_farm_id()
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
    """§5.4.1 a)~d) 를 드라이버 /conntest(화면 「§5.4.1 연결 시험」과 같은 판정)로 1:1 기록한다 (2026-09-15).
    시뮬레이터 환경에선 a) 케이블·b) 시험장비 설정을 루프백 TCP·시뮬레이터 설정이 대신한다(README §0 역할표) — 단계 이름에 그렇게 적는다.
    당일 RS485 에선 /conntest 의 a)b) 판정을 그대로 쓴다. 끝에 '당일 준비 점검'(표준 포트 인식·9600 열림)을 붙여 지금 상태로도 당일 준비가 됐는지 남긴다."""
    t = Test(c, "5.4.1", "연결시험", "SPS-7466 §5.4.1 a)~d) + 당일 준비 점검")
    ct = c.d_get("/conntest", unit=c.su)
    rows = {r["step"]: r for r in ct.get("rows", [])}
    cur = (c.d_get("/comm").get("current") or {})
    s = c.s_get("/health")
    if cur.get("mode") == "serial":
        t.step("a) 시험장비-제어기 RS485 연결 (표준 포트 열림)", rows["a"]["ok"], rows["a"]["actual"])
        t.step("b) 시험장비 통신 설정 (시험기관 노드: 9600·슬레이브 ID) — 시험관 확인", True, "시험관에게 노드 주소를 받아 c') 에 입력")
        t.step("c) 제어기 통신 설정 9600 8N1 RTU", rows["b"]["ok"], rows["b"]["actual"])
    else:
        opened = str(rows["a"]["actual"]).endswith("열림")
        t.step("a) 시험장비-제어기 연결 — 시뮬레이터 환경: 루프백 TCP 가 RS485 케이블을 대신", s.get("ok") is True and opened, f"{rows['a']['actual']} / 시험장비 {s}")
        t.step(f"b) 시험장비 통신 설정 — 시뮬레이터 --tcp 5020, 노드 주소 {c.su}(센서)·{c.au}(구동기)", s.get("ok") is True, s)
        t.step("c) 제어기 통신 설정 — 시뮬레이터 주소로 연결됨 (당일엔 RS485·표준 포트·9600)", opened, cur.get("desc"))
    t.step(f"c') 노드 슬레이브 아이디 입력 {c.su}", rows["c"]["ok"], rows["c"]["actual"])
    t.step(f"d) 통신 연결 수행 — 센서 노드 {c.su} 응답", rows["d"]["ok"], rows["d"]["actual"])
    d2 = next((r for r in c.d_get("/conntest", unit=c.au).get("rows", []) if r["step"] == "d"), {})
    t.step(f"d) 통신 연결 수행 — 구동기 노드 {c.au} 응답", d2.get("ok"), d2.get("actual"))
    for p in ct.get("prep", []):
        if p.get("ok") is None:
            continue  # 안내 줄(연결 방식 바꾸는 법)은 판정이 아니다
        t.step("준비) " + p["title"], p["ok"], p["detail"])
    return t.done()


# ── §5.4.2 디폴트 레지스터맵 센서 노드 검색 ───────────────────────────
SENSOR_KIND_NAME = {1: "온도", 2: "습도", 3: "이슬점", 4: "감우", 5: "유량", 6: "강우", 7: "일사", 8: "풍속", 9: "풍향", 10: "전압",
                    11: "CO2", 12: "EC", 13: "광양자", 14: "토양함수율", 15: "토양수분장력", 16: "pH", 17: "지온", 18: "무게"}


def _kinds(codes):
    """{순번: 코드} → '온도 3 · 습도 1 · CO2 1' (§5.4.2 d) 의 '종류')"""
    cnt = {}
    for code in codes.values():
        k = SENSOR_KIND_NAME.get(int(code), f"코드{code}")
        cnt[k] = cnt.get(k, 0) + 1
    return " · ".join(f"{k} {n}" for k, n in cnt.items()) or "없음"


def _codes_of(node):
    return {int(x["index"]): int(x["code"]) for x in (node or {}).get("devices", [])}


def t_542(c):
    """§5.4.2 a)~d) 완전판 (2026-09-15). 9/4 판은 시험장비 스펙을 바꾸지 않고 읽기만 해서 d) 가 항등에 가까웠다.
    이제 b) 에서 스펙을 **일부러 바꿔**(온도×3·습도·CO2 = 5개) 설정하고, 제어기가 그 개수·종류를 그대로 인식하는지 본 뒤 전체(30개)로 되돌려 다시 본다."""
    t = Test(c, "5.4.2", "디폴트 레지스터맵 센서 노드 검색 시험", "SPS-7466 §5.4.2 a)~d) (KS X 3267 노드정보 1~8 · 디바이스 코드 101~)")
    dr = next((r for r in c.d_get("/conntest", unit=c.su).get("rows", []) if r["step"] == "d"), {})
    t.step(f"a) 5.4.1 연결시험 이후 — 연결 시험 d) 노드 {c.su} 응답", dr.get("ok"), dr.get("actual"))
    subset = [1, 2, 3, 4, 13]  # 온도1~3 · 습도1 · CO2
    try:
        spec = c.s_post("/spec", {"unit": c.su, "attached": subset})
        exp = {int(k): int(v) for k, v in (spec.get("devices") or {}).items()}
        t.step(f"b) 시험장비 노드 스펙 설정 — 센서 {len(exp)}개: {_kinds(exp)} (순번 {subset})", spec.get("ok") and spec.get("attached") == subset, spec)
        d = c.d_get("/discover", unit=c.su)
        node = d.get("node") or {}
        t.step("c) 제어기가 노드정보를 읽어 디폴트 레지스터맵 센서 노드로 인지", d.get("ok") and node.get("kind") == "sensor" and node.get("default_map") and node.get("supported"),
               {k: node.get(k) for k in ("kind", "default_map", "supported", "product_type", "protocol_version", "channels", "serial")})
        t.step("   노드정보 1~6 디폴트값 (기관 0, 회사 0, 제품타입 1, 제품코드 0, 프로토콜 10, 채널 30)",
               node.get("cert_authority") == 0 and node.get("company_code") == 0 and node.get("product_type") == 1
               and node.get("product_code") == 0 and node.get("protocol_version") == 10 and node.get("channels") == 30)
        got = _codes_of(node)
        t.step(f"d) 연결된 센서 개수·종류가 설정대로 — 제어기 {len(got)}개 {_kinds(got)} / 설정 {len(exp)}개 {_kinds(exp)}", got == exp,
               f"제어기={sorted(got.items())} 시험장비={sorted(exp.items())}")
    finally:
        full = c.s_post("/spec", {"unit": c.su, "attached": None})  # 실패해도 시험장비 스펙은 전체로 되돌린다
    exp2 = {int(k): int(v) for k, v in (full.get("devices") or {}).items()}
    got2 = _codes_of(c.d_get("/discover", unit=c.su).get("node"))
    t.step(f"d') 스펙을 전체로 되돌린 뒤 — 제어기 {len(got2)}개 {_kinds(got2)} / 설정 {len(exp2)}개", got2 == exp2 and len(got2) == 30,
           f"제어기={sorted(got2.items())}")
    return t.done()


# ── §5.4.3 데이터 확인 시험 ────────────────────────────────────────────
def t_543(c):
    """§5.4.3 a)~d) 완전판 (2026-09-15). a)b) 관측치 4종(표준 예시 28.8 포함·음수) 가상 설정 → 제어기 읽기.
    c) 상태를 **일정 주기마다** 바꾸도록 시험장비에 설정(/sensor/cycle) → d) 제어기의 변화 이력(/changes)에 매 변화가 순서·주기대로 남는지.
    9/4 판은 상태를 한 번씩만 바꿔 c) 의 '일정주기' 가 없었다."""
    t = Test(c, "5.4.3", "데이터 확인 시험", "SPS-7466 §5.4.3 a)~d) (관측치 CDAB float · 상태코드 주기 변경)")
    idx = 1  # 온도 (디폴트맵 순번 1)
    for v in (21.5, 30.25, -3.0, 28.8):
        c.s_post("/sensor", {"unit": c.su, "index": idx, "value": v})              # a) 관측치 가상 변경
        got = c.wait_until(lambda: (lambda s: s if s and abs(float(s.get("value", 1e9)) - v) < 0.01 else None)(
            (c.d_status(c.su).get("sensors") or {}).get(str(idx))), timeout=c.poll * 3 + 1)
        t.step(f"a)b) 관측치 {v} 가상 설정 → 제어기가 읽음", got is not None, got)
    seq, period = [103, 102, 0], 4.0
    t0 = time.time()
    try:
        r = c.s_post("/sensor/cycle", {"unit": c.su, "index": idx, "statuses": seq, "period": period})
        t.step(f"c) 시험장비 상태를 {period}s 주기로 {seq} 순환하도록 설정", r.get("ok"), r)
        time.sleep(period * 3 + c.poll * 2 + 1)                                   # 3주기 이상 관찰
        ch = c.d_get("/changes", unit=c.su, n=200).get("changes", [])
        sts = [x for x in ch if int(x["index"]) == idx and x["t"] >= t0 - 0.5 and x["what"] in ("status", "both")]
        seen = [int(x["status"]) for x in sts]
        in_order = all(seq.index(b) == (seq.index(a) + 1) % len(seq) for a, b in zip(seen, seen[1:])) if seen else False
        gaps = [round(b["t"] - a["t"], 1) for a, b in zip(sts, sts[1:])]
        t.step(f"d) 제어기가 상태 변화를 매번 순서대로 읽음 — 관측 {seen}", len(seen) >= 3 and all(s in seq for s in seen) and in_order,
               f"변화 이력 {len(sts)}건, 상태명 {[x['status_name'] for x in sts]}")
        t.step(f"d') 변화 간격 ≈ 설정 주기 {period}s (폴링 {c.poll}s 오차 내)", bool(gaps) and all(abs(g - period) <= c.poll + 0.5 for g in gaps),
               f"간격 {gaps}s")
    finally:
        c.s_post("/sensor/cycle", {"unit": c.su, "index": idx})                   # 주기 변경 해제
        c.s_post("/sensor", {"unit": c.su, "index": idx, "value": 28.8, "status": 0})
    got = c.wait_until(lambda: (lambda s: s if s and int(s.get("status", -1)) == 0 else None)(
        (c.d_status(c.su).get("sensors") or {}).get(str(idx))), timeout=c.poll * 3 + 1)
    t.step("   해제 후 상태 0(READY) 복귀 확인", got is not None and got.get("status_name") == "READY", got)
    c.manual.append("§5.4.4 데이터 저장 시험(10분 이상): 센서를 하우스/센서 탭에서 표준 노드에 매핑(temp_std ← U2 센서1) 후 "
                    "10분 뒤 API `GET /api/sensors/farm_0001/house_0001/history?startDate=…` 로 1분 단위 저장 확인 — 이 스크립트는 운영 houseConfig 를 건드리지 않는다")
    return t.done()


# ── §5.4.4 데이터 저장 시험 (10분 이상) ────────────────────────────────
# a) 저장 기능 있음 — 저장주기 1분(서버 표 ks_sensor_status, NR 1분 스냅샷). b) 5.4.3 처럼 관측치·상태를 계속 바꾸며 10분 이상 진행.
# c)d) 서버에서 되읽어(농장 키, /internal/sensor-status) 1분 간격으로 관측치·상태가 빠짐없이 저장됐는지. 2026-09-15
def _read_farm_id():
    try:
        return open("/home/lhk/smartfarm/.farm-id", encoding="utf-8").read().strip() or "farm_0001"
    except OSError:
        return "farm_0001"


def _read_api_key(path):
    try:
        return open(path, encoding="utf-8").read().strip()
    except OSError:
        return ""


def t_544(c):
    t = Test(c, "5.4.4", "데이터 저장 시험 (10분 이상)", "SPS-7466 §5.4.4 a)~d) (저장주기 1분 — 관측치·상태 매분 저장)")
    idx = 1
    dur = max(float(c.duration), 60.0)
    t.step("a) 저장 기능 있음 — 저장주기 1분 (NR 1분 스냅샷 → 서버 ks_sensor_status)", True, f"서버 {c.server}, 농장 {c.farm_id}")
    key = _read_api_key(c.api_key_file)
    if not key:
        t.step("   농장 API 키 파일", False, f"{c.api_key_file} 없음 — 서버 되읽기 불가")
        return t.done()
    values = [21.5, 22.5, 23.5, 24.5, 25.5]
    statuses = [0, 0, 103, 0, 102, 0]
    t0 = time.time()
    try:
        r2 = c.s_post("/sensor/cycle", {"unit": c.su, "index": idx, "values": values, "statuses": statuses, "period": 60})
        t.step(f"b) 5.4.3 를 {dur / 60:.0f}분 동안 수행 — 관측치 {values} 와 상태 {statuses} 를 60초마다 순환", r2.get("ok"), r2)
        print(f"    … {dur / 60:.0f}분 대기 (매분 저장 관찰 중)")
        time.sleep(dur + 90)   # 마지막 분의 스냅샷 전송(최대 60초) + 서버 반영 여유
    finally:
        c.s_post("/sensor/cycle", {"unit": c.su, "index": idx})
        c.s_post("/sensor", {"unit": c.su, "index": idx, "value": 28.8, "status": 0})
    t1 = time.time()
    start = dt.datetime.utcfromtimestamp(t0).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = dt.datetime.utcfromtimestamp(t1).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = f"{c.server}/internal/sensor-status?farmId={c.farm_id}&unit={c.su}&idx={idx}&startDate={start}&endDate={end}"
    req = urllib.request.Request(url, headers={"x-api-key": key})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        t.step("c) 서버 저장 행 되읽기", False, f"{url} → {e!r}")
        return t.done()
    rows = body.get("data") or []
    ts = [dt.datetime.fromisoformat(x["timestamp"].replace("Z", "+00:00")).timestamp() for x in rows]
    gaps = [round(b - a) for a, b in zip(ts, ts[1:])]
    minutes = int(dur // 60)
    t.step(f"c) 관측치가 저장주기(1분)대로 저장 — {len(rows)}행 / 최소 {minutes}행, 간격 {sorted(set(gaps))}s",
           len(rows) >= minutes and all(g == 60 for g in gaps) and all(x.get("value") is not None for x in rows),
           f"값 {[x.get('value') for x in rows]}")
    seen = sorted({int(x["status"]) for x in rows})
    t.step(f"d) 센서 상태가 저장주기대로 저장 — 매 행에 상태코드, 종류 {seen}", all(x.get("status") is not None for x in rows) and 103 in seen and 102 in seen,
           f"상태 {[x.get('status') for x in rows]} (점검군 101~103 이어도 생략하지 않음)")
    return t.done()


# ── §5.5.1 디폴트 레지스터맵 구동기 노드 검색 ───────────────────────
def _act_kinds(codes):
    """{순번: 코드} → '스위치 3 · 개폐기 2' (§5.5.1 d) 의 '종류' — 102 레벨1 스위치, 112 레벨1 개폐기)"""
    cnt = {}
    for code in codes.values():
        k = {102: "스위치", 112: "개폐기"}.get(int(code), f"코드{code}")
        cnt[k] = cnt.get(k, 0) + 1
    return " · ".join(f"{k} {n}" for k, n in cnt.items()) or "없음"


def t_551(c):
    """§5.5.1 a)~d) 완전판 (2026-09-15). 9/4 판은 시험장비 스펙을 바꾸지 않고 읽기만 해서 d) 가 항등에 가까웠다.
    b) 에서 스펙을 **일부러 바꿔**(스위치 1~3 · 개폐기 1~2 = 5개) 제어기가 그 개수·종류를 그대로 인식하는지 본 뒤 전체(24개)로 되돌려 다시 본다.
    §5.5 머리말 "5.4 공통시험을 모두 통과해야" 는 a) 에서 §5.4.1 연결(노드 응답)로 확인한다."""
    t = Test(c, "5.5.1", "디폴트 레지스터맵 구동기 노드 검색 시험", "SPS-7466 §5.5.1 a)~d) (노드정보 1~8 · 디바이스 코드 102/112)")
    dr = next((r for r in c.d_get("/conntest", unit=c.au).get("rows", []) if r["step"] == "d"), {})
    t.step(f"a) 5.4.1 연결시험 이후 — 연결 시험 d) 노드 {c.au} 응답", dr.get("ok"), dr.get("actual"))
    subset = [1, 2, 3, 17, 18]  # 스위치 1~3 · 개폐기 1~2 (디폴트맵 순번 17 = 개폐기 1)
    try:
        spec = c.s_post("/spec", {"unit": c.au, "attached": subset})
        exp = {int(k): int(v) for k, v in (spec.get("devices") or {}).items()}
        t.step(f"b) 시험장비 노드 스펙 설정 — 구동기 {len(exp)}개: {_act_kinds(exp)} (순번 {subset})", spec.get("ok") and spec.get("attached") == subset, spec)
        d = c.d_get("/discover", unit=c.au)
        node = d.get("node") or {}
        t.step("c) 제어기가 노드정보를 읽어 디폴트 레지스터맵 구동기 노드로 인지", d.get("ok") and node.get("kind") == "actuator" and node.get("default_map") and node.get("supported"),
               {k: node.get(k) for k in ("kind", "default_map", "supported", "product_type", "protocol_version", "channels", "serial")})
        t.step("   노드정보 1~6 디폴트값 (기관 0, 회사 0, 제품타입 2, 제품코드 0, 프로토콜 10, 채널 24)",
               node.get("cert_authority") == 0 and node.get("company_code") == 0 and node.get("product_type") == 2
               and node.get("product_code") == 0 and node.get("protocol_version") == 10 and node.get("channels") == 24)
        got = _codes_of(node)
        t.step(f"d) 연결된 구동기 개수·종류가 설정대로 — 제어기 {len(got)}개 {_act_kinds(got)} / 설정 {len(exp)}개 {_act_kinds(exp)}", got == exp,
               f"제어기={sorted(got.items())} 시험장비={sorted(exp.items())}")
    finally:
        full = c.s_post("/spec", {"unit": c.au, "attached": None})  # 실패해도 시험장비 스펙은 전체로 되돌린다
    exp2 = {int(k): int(v) for k, v in (full.get("devices") or {}).items()}
    got2 = _codes_of(c.d_get("/discover", unit=c.au).get("node"))
    t.step(f"d') 스펙을 전체로 되돌린 뒤 — 제어기 {len(got2)}개 {_act_kinds(got2)} / 설정 {len(exp2)}개", got2 == exp2 and len(got2) == 24,
           f"제어기={sorted(got2.items())}")
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


def _step_a_level1(t, c, kind, n):
    """a) "디바이스코드에 레벨 1 스위치(102)/개폐기(112)가 포함된 경우에 수행한다" — 탐색 결과(노드정보·디바이스 코드)에서
    시험 대상 디바이스의 코드를 확인해 보고서 첫 줄에 남긴다 (2026-09-15, §5.2.1/5.2.2 a) 와 1:1 대응). 없으면 이 시험은 해당 없음."""
    node = (c.d_get("/discover", unit=c.au)).get("node") or {}
    want, label = (102, "레벨 1 스위치(102)") if kind == "switch" else (112, "레벨 1 개폐기(112)")
    dev = next((x for x in node.get("devices", []) if x.get("kind") == kind and int(x.get("n") or 0) == n), None)
    code = dev.get("code") if dev else None
    return t.step(f"a) 디바이스코드에 {label} 포함 — {kind}{n}", code == want,
                  f"탐색 코드 {code} (디폴트맵 순번 {dev.get('index') if dev else '?'}, 노드 {c.au})" if dev else f"노드 {c.au} 탐색에 {kind}{n} 없음 → 해당 없음")


def _screen_dev(c, unit, kind, n):
    """화면 경로의 디바이스 상태 — NR 프록시 /api/ks3267/status (표준노드 탭·제어판 배지가 읽는 바로 그 응답).
    반환 (state_t, dev) — dev = {opid, status, status_name, remain}"""
    code, body = http("GET", f"{c.nr}/api/ks3267/status?unit={unit}", timeout=10)
    st = body.get("state") if code == 200 and isinstance(body, dict) else None
    if not st or not st.get("devices"):
        return None, None
    dev = next((x for x in st["devices"].values() if x.get("kind") == kind and int(x.get("n") or 0) == n), None)
    return st.get("t"), dev


# ── §5.5.2 레벨 1 스위치 제어 시험 — 제어기 시험 a)~j) (2026-09-15) ─────────────────
# b)·g) 는 화면과 같은 입구(NR /api/control/local)로, e)·f)·j) 는 화면이 읽는 프록시(NR /api/ks3267/status)로 판정한다.
# d)·i) "시험장비의 상태를 …로 변경" 은 실장비에선 시험관이 하는 일 — 시뮬레이터는 명령 활성화 때 스스로 전이하므로 그 전이를 기록한다.
def t_552(c, n=1, seconds=20):
    t = Test(c, "5.5.2", "레벨 1 스위치 제어 시험", "SPS-7466 §5.5.2 a)~j) (화면 → 202 작동시간 → 작동중·남은시간 표시 → 화면 중지 → READY 표시)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "switch", "n": n}
    dev = f"kstest_sw{n}"
    wait_on = c.poll * 3 + 2
    node = (c.d_get("/discover", unit=c.au)).get("node") or {}
    t.step("a) 5.5.1 수행됨 — 디폴트맵 구동기 노드(제품타입 2·채널 24) 로 탐색됨", node.get("kind") == "actuator" and node.get("default_map") and node.get("channels") == 24,
           {k: node.get(k) for k in ("kind", "default_map", "product_type", "channels")})
    if not _step_a_level1(t, c, "switch", n):
        return t.done()
    r = c.ui_control(dev, "on", seconds, mb)
    t.step(f"b) 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 {seconds}s 명령", r[0] == 200 and r[1].get("success"), r[1])
    t_cmd = time.time()
    got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 202 and s.get("cmd_opid") else None)(_sim_cmd(c, "switch", n)), 10)
    t.step(f"c) 시험장비가 작동시간 명령(202) 수신 — 작동시간 {got and got.get('time')}s = 명령 {seconds}s", got is not None and got.get("time") == seconds, got)
    opid = got.get("cmd_opid") if got else None
    sim = c.wait_until(lambda: (lambda s: s if s and s.get("status") == 201 else None)(_sim_cmd(c, "switch", n)), 5)
    t.step("d) 시험장비 상태 작동중(201) — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정)", sim is not None, sim)
    scr = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 201 else None)(_screen_dev(c, c.au, "switch", n)[1]), wait_on)
    t.step("e) 제어기 화면에 작동중(201) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status", scr is not None and scr.get("opid") == opid, f"{scr} (명령 OPID {opid})")
    # f) 남은시간: 화면 값이 실제 남은시간(명령 시각 기준)과 폴링 주기 안에서 맞고, 시간이 흐르면 줄어든다
    samples = []
    for _ in range(3):
        st_t, d1 = _screen_dev(c, c.au, "switch", n)
        if d1:
            expected = seconds - (time.time() - t_cmd)
            samples.append((round(time.time() - t_cmd, 1), int(d1.get("remain") or 0), round(expected, 1)))
        time.sleep(c.poll + 0.3)
    remains = [s[1] for s in samples]
    accurate = all(abs(s[1] - s[2]) <= c.poll + 1.5 for s in samples)
    t.step(f"f) 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) {samples}", len(samples) == 3 and accurate and remains[0] > remains[-1] > 0,
           f"허용 오차 폴링 {c.poll}s + 1.5s, 감소 {remains}")
    r2 = c.ui_control(dev, "off", 0, mb)
    t.step("g) 제어기 인터페이스(화면 경로)로 중지 명령", r2[0] == 200 and r2[1].get("success"), r2[1])
    got2 = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 0 and s.get("cmd_opid") not in (None, opid) else None)(_sim_cmd(c, "switch", n)), 10)
    t.step("h) 시험장비가 중지 명령(0) 수신 (OPID 는 새 값)", got2 is not None, f"{got2} (작동 명령 OPID {opid})")
    sim2 = c.wait_until(lambda: (lambda s: s if s and s.get("status") == 0 else None)(_sim_cmd(c, "switch", n)), 5)
    t.step("i) 시험장비 상태 중지중(READY, 0) 으로 전이", sim2 is not None and int(sim2.get("remain") or 0) == 0, sim2)
    scr2 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_screen_dev(c, c.au, "switch", n)[1]), wait_on)
    t.step("j) 제어기 화면에 중지중(READY) 표시 — 남은시간 0", scr2 is not None and int(scr2.get("remain") or 0) == 0, scr2)
    c.manual.append(f"§5.5.2 화면 증적: 제어판 {dev} 「📐 시간 지정 ON」 {seconds}초 → 📐 배지 '켜짐 NNs' 감소 → ■ OFF → 'READY' 캡처, "
                    "표준노드 탭 §5.1.3 표(상태코드 201/0·OPID·남은 s 실시간 카운트다운), ④ 진단 프레임(FC16 503~506 / FC03 203~206)")
    return t.done()


# ── §5.2.1 레벨 1 스위치 시험 — 노드 시험 a)~m) (2026-09-04 완전판, a) 2026-09-15; 9/15 부터 5.5.2 와 분리) ─────────────────
# 제어기 시험 §5.5.2 와 달리 만료 자동 중지(f)·재명령(h~j) 까지 본다. 드라이버가 시험장비 마스터 역할.
def t_521(c, n=1, seconds=12):
    t = Test(c, "5.2.1", "레벨 1 스위치 시험 (노드 시험 — 만료·재명령 포함)", "SPS-7466 §5.2.1 a)~m) (202 TIMED_ON → 만료 → 202 → 0 OFF)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "switch", "n": n}
    dev = f"kstest_sw{n}"
    wait_on = c.poll * 3 + 2
    if not _step_a_level1(t, c, "switch", n):
        return t.done()

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
def _opener_phase(t, c, n, seconds, mb, dev, cmd, code, stname, label, L, expire, prev_opid):
    """§5.2.2 의 한 단계. L = 글자 7개 [명령, 작동여부, OPID·상태, 남은시간 감소, 주기 | 중지명령, 만료 | 중지여부, READY].
    expire=True 면 작동시간 만료로 스스로 중지하는지(f·m), False 면 중지 명령(0)으로 멈추는지(r~t·x~z) 본다. 반환: 이 단계 마지막 명령 OPID."""
    wait_on = c.poll * 3 + 2
    moving = "여는중" if stname == 301 else "닫는중"
    r = c.ui_control(dev, cmd, seconds, mb)
    t.step(f"{L[0]} 쓰기영역에 작동시간 {label} 명령 (OPID·{code}·{seconds}s) — 제어기 화면 경로", r[0] == 200 and r[1].get("success"), r[1])
    got = c.wait_until(lambda: (lambda x: x if x and x.get("cmd") == code and x.get("time") == seconds and x.get("cmd_opid") not in (None, prev_opid) else None)(_sim_cmd(c, "opener", n)), 10)
    t.step(f"{L[1]} 시험장비가 {code} + 동일 작동시간 수신 → 작동 (OPID 는 매 명령 변경)", got is not None, f"{got} (이전 OPID {prev_opid})")
    opid = got.get("cmd_opid") if got else None
    st1 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == stname else None)(_dev_state(c, "opener", n)), wait_on)
    t.step(f"{L[2]} 읽기영역: OPID 동일 + 상태 {moving}({stname})", st1 is not None and st1.get("opid") == opid, f"명령 OPID {opid} / 읽은 {st1}")
    r1 = st1.get("remain") if st1 else None
    period, nchg = _measure_remain_period(c, "opener", n, seconds=4.0 if expire else 2.5)
    st2 = _dev_state(c, "opener", n)
    t.step(f"{L[3]} 남은 작동시간이 적절히 줄어든다", st2 and r1 is not None and 0 < st2.get("remain", 0) < r1, f"{r1} → {st2 and st2.get('remain')}")
    if expire:
        t.step(f"{L[4]} 남은시간 업데이트 주기 (노드 레지스터 직접 측정)", period is not None and 0.5 <= period <= 2.5,
               f"노드 갱신 주기 ≈ {period}s ({nchg}회 변화 관측) / 제어기 폴링·표시 주기 {c.poll}s")
        stf = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "opener", n)), seconds + wait_on)
        t.step(f"{L[5]} 작동시간({seconds}s) 동안 {label[0]}{'린' if label == '열기' else '힌'} 후 스스로 중지", stf is not None and stf.get("remain") == 0, stf)
        ok, why = _stopped_ok(stf, opid)
        t.step(f"{L[6]} 읽기영역: 중지 후 OPID 확인 + 상태 READY(0)", ok, why)
        return opid
    r = c.ui_control(dev, "stop", 0, mb)
    t.step(f"{L[4]} 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로", r[0] == 200 and r[1].get("success"), r[1])
    got2 = c.wait_until(lambda: (lambda x: x if x and x.get("cmd") == 0 and x.get("cmd_opid") not in (None, opid) else None)(_sim_cmd(c, "opener", n)), 10)
    t.step(f"{L[5]} 시험장비가 0 수신 → 중지", got2 is not None, got2)
    opid_stop = got2.get("cmd_opid") if got2 else None
    st3 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "opener", n)), wait_on)
    ok, why = _stopped_ok(st3, opid_stop)
    t.step(f"{L[6]} 읽기영역: 중지 후 OPID 확인 + 상태 READY(0)", ok and st3.get("remain") == 0, why)
    return opid_stop


def _screen_phase(t, c, kind, n, dev, mb, cmd, code, stname, moving, label, L, seconds):
    """§5.5.2/§5.5.3 의 한 단계(화면 → 작동시간 명령 → 시험장비 수신·작동 → 화면 표시·남은시간 → 화면 중지 → 수신·READY → 화면 READY).
    L = 글자 9개 [명령, 수신, 시험장비 작동중, 화면 작동중, 화면 남은시간, 중지 명령, 중지 수신, 시험장비 READY, 화면 READY]"""
    wait_on = c.poll * 3 + 2
    r = c.ui_control(dev, cmd, seconds, mb)
    t.step(f"{L[0]} 제어기 인터페이스(화면 경로 /api/control/local)로 작동시간 {label} {seconds}s 명령", r[0] == 200 and r[1].get("success"), r[1])
    t_cmd = time.time()
    got = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == code and s.get("cmd_opid") else None)(_sim_cmd(c, kind, n)), 10)
    t.step(f"{L[1]} 시험장비가 작동시간 {label} 명령({code}) 수신 — 작동시간 {got and got.get('time')}s = 명령 {seconds}s", got is not None and got.get("time") == seconds, got)
    opid = got.get("cmd_opid") if got else None
    sim = c.wait_until(lambda: (lambda s: s if s and s.get("status") == stname else None)(_sim_cmd(c, kind, n)), 5)
    t.step(f"{L[2]} 시험장비 상태 {moving}({stname}), 작동시간 {seconds}s — 시뮬레이터는 명령 활성화 때 스스로 전이 (실장비: 시험관 설정)", sim is not None, sim)
    scr = c.wait_until(lambda: (lambda d: d if d and d.get("status") == stname else None)(_screen_dev(c, c.au, kind, n)[1]), wait_on)
    t.step(f"{L[3]} 제어기 화면에 {moving}({stname}) 표시 — 화면이 읽는 NR 프록시 /api/ks3267/status", scr is not None and scr.get("opid") == opid, f"{scr} (명령 OPID {opid})")
    samples = []
    for _ in range(3):
        _, d1 = _screen_dev(c, c.au, kind, n)
        if d1:
            samples.append((round(time.time() - t_cmd, 1), int(d1.get("remain") or 0), round(seconds - (time.time() - t_cmd), 1)))
        time.sleep(c.poll + 0.3)
    remains = [s[1] for s in samples]
    accurate = all(abs(s[1] - s[2]) <= c.poll + 1.5 for s in samples)
    t.step(f"{L[4]} 제어기 화면의 남은 작동시간이 적절 — (경과s, 표시s, 실제s) {samples}", len(samples) == 3 and accurate and remains[0] > remains[-1] > 0,
           f"허용 오차 폴링 {c.poll}s + 1.5s, 감소 {remains}")
    r2 = c.ui_control(dev, "stop" if kind == "opener" else "off", 0, mb)
    t.step(f"{L[5]} 제어기 인터페이스(화면 경로)로 중지 명령", r2[0] == 200 and r2[1].get("success"), r2[1])
    got2 = c.wait_until(lambda: (lambda s: s if s and s.get("cmd") == 0 and s.get("cmd_opid") not in (None, opid) else None)(_sim_cmd(c, kind, n)), 10)
    t.step(f"{L[6]} 시험장비가 중지 명령(0) 수신 (OPID 는 새 값)", got2 is not None, f"{got2} (작동 명령 OPID {opid})")
    sim2 = c.wait_until(lambda: (lambda s: s if s and s.get("status") == 0 else None)(_sim_cmd(c, kind, n)), 5)
    t.step(f"{L[7]} 시험장비 상태 중지중(READY, 0) 으로 전이", sim2 is not None and int(sim2.get("remain") or 0) == 0, sim2)
    scr2 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_screen_dev(c, c.au, kind, n)[1]), wait_on)
    t.step(f"{L[8]} 제어기 화면에 중지중(READY) 표시 — 남은시간 0", scr2 is not None and int(scr2.get("remain") or 0) == 0, scr2)


# ── §5.5.3 레벨 1 개폐기 제어 시험 — 제어기 시험 a)~s) (2026-09-15) ─────────────────
def t_553(c, n=1, seconds=20):
    """b)~j) 작동시간 열기 → 여는중·남은시간 화면 표시 → 화면 중지 → READY 표시, k)~s) 작동시간 닫기 → 닫는중 → 중지 → READY.
    §5.5.2 와 같은 화면 경로 판정. 노드 시험 §5.2.2(만료·재명령 포함)는 `5.2.2` 로 분리."""
    t = Test(c, "5.5.3", "레벨 1 개폐기 제어 시험", "SPS-7466 §5.5.3 a)~s) (화면 → 303 열기 → 여는중·남은시간 → 중지 → READY → 304 닫기 → 닫는중 → 중지 → READY)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "opener", "n": n, "controlType": "bidir"}
    dev = f"kstest_op{n}"
    if not _step_a_level1(t, c, "opener", n):
        return t.done()
    _screen_phase(t, c, "opener", n, dev, mb, "open", 303, 301, "열림중", "열기", ["b)", "c)", "d)", "e)", "f)", "g)", "h)", "i)", "j)"], seconds)
    _screen_phase(t, c, "opener", n, dev, mb, "close", 304, 302, "닫힘중", "닫기", ["k)", "l)", "m)", "n)", "o)", "p)", "q)", "r)", "s)"], seconds)
    c.manual.append(f"§5.5.3 화면 증적: 제어판 {dev} 카드 「📐 작동시간」 {seconds}초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → ■ 정지 → 'READY' → ⏱ 시간 닫기 → '닫히는 중 NNs' → 정지 캡처, "
                    "표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s 실시간 카운트다운), ④ 진단 프레임(FC16 567~570 / FC03 267~270)")
    return t.done()


def t_522(c, n=1, seconds=12):
    """§5.2.2 a)~z) (노드 시험, 9/15 부터 5.5.3 과 분리) — 네 단계: ① b~g 작동시간 열기(303) → 여는중·감소·주기 → 만료로 스스로 중지 → READY
    ② h~n 작동시간 닫기(304) → 닫는중·감소·주기 → 만료 → READY  ③ o~t 열기 → 여는중·감소 → 중지 명령(0) → READY
    ④ u~z 닫기 → 닫는중·감소 → 중지 명령 → READY. 매 되읽기 OPID 동일, 재명령 시 OPID 변경.
    (2026-09-04 완전판은 ③④ 만이었다 — 2026-09-15 §5.2.2 대조에서 만료 단계 ①② 가 없던 것을 채움.)"""
    t = Test(c, "5.2.2", "레벨 1 개폐기 시험 (노드 시험 — 만료·재명령 포함)", "SPS-7466 §5.2.2 a)~z) (303 열기·304 닫기 각각 만료 → 중지 명령)")
    mb = {"protocol": "ks3267", "unit": c.au, "kind": "opener", "n": n, "controlType": "bidir"}
    dev = f"kstest_op{n}"
    if not _step_a_level1(t, c, "opener", n):
        return t.done()
    prev = None
    for cmd, code, stname, label, L, expire in (
        ("open", 303, 301, "열기", ["b)", "c)", "d)", "d')", "e)", "f)", "g)"], True),
        ("close", 304, 302, "닫기", ["h)", "i)", "j)", "k)", "l)", "m)", "n)"], True),
        ("open", 303, 301, "열기", ["o)", "p)", "q)", "q')", "r)", "s)", "t)"], False),
        ("close", 304, 302, "닫기", ["u)", "v)", "w)", "w')", "x)", "y)", "z)"], False),
    ):
        prev = _opener_phase(t, c, n, seconds, mb, dev, cmd, code, stname, label, L, expire, prev)
    c.manual.append(f"§5.5.3 화면 증적: 제어판 {dev} 카드 「📐 작동시간」 {seconds}초 → ⏱ 시간 열기 → 📐 배지 '열리는 중 NNs' 감소 → 'READY' 자동 복귀 → ⏱ 시간 닫기 → '닫히는 중' → 자동 복귀 → "
                    "다시 열기 → ■ 정지 → 'READY' → 닫기 → 정지 캡처, 표준노드 탭 §5.1.3 표(301/302/0·OPID·남은 s), ④ 진단 프레임(FC16 567~570 / FC03 267~270)")
    return t.done()


# ── 추가: 스코프 선언 일치 (레벨2 명령을 제어기가 만들지 않는다) ─────────
def t_extra_level2(c):
    """레벨2 명령을 제어기가 만들지 않는다. §5.3.1 b)(스위치 203)·§5.3.2(개폐기 305/306) 는 노드 시험 — 시험장비가 노드에 보내는 것이고
    레벨1 제어기인 우리는 화면·API 어디서도 그 코드를 버스에 내보내지 않아야 한다. 판정은 시험장비의 마지막 명령 블록(cmd·OPID)이
    전후로 같은가 (2026-09-15: 9/4 판은 개폐기만 보고 두 번째 판정이 항등식이라 실검사가 없었다)."""
    t = Test(c, "부가-L2", "레벨2 명령 미생성 (스코프 선언: 디폴트맵·레벨1 전용)", "KS X 3267 6.3.4 / 116 연동장비표 레벨2 × / §5.3.1 b) 203·§5.3.2 305 는 제어기가 내지 않는다")
    for kind, n, op, label in (("switch", 1, 203, "203 (레벨2 방향성 ON, §5.3.1 b))"), ("opener", 1, "set_position", "305 (SET_POSITION)"), ("opener", 1, 306, "306 (SET_CONFIG)")):
        before = c.s_get("/device", unit=c.au, kind=kind, n=n)
        r = http("POST", f"{c.daemon}/command", {"unit": c.au, "kind": kind, "n": n, "op": op, "seconds": 0})[1]
        t.step(f"드라이버가 {kind}{n} 에 {label} 를 로컬에서 거부", r.get("ok") is False and "미지원" in str(r.get("error", "")), r)
        after = c.s_get("/device", unit=c.au, kind=kind, n=n)
        same = (before.get("cmd"), before.get("cmd_opid")) == (after.get("cmd"), after.get("cmd_opid"))
        t.step(f"   시험장비 {kind}{n} 명령 블록 변화 없음 (버스로 안 나감)", same and after.get("status") == 0,
               f"cmd/OPID {before.get('cmd')}/{before.get('cmd_opid')} → {after.get('cmd')}/{after.get('cmd_opid')}, 상태 {after.get('status')}")
    return t.done()


# ── §5.3.1 레벨 1 스위치 비정상 명령 시험 — 노드 시험 (2026-09-15) ──────────────
# 시험대상은 노드다. 우리 드라이버가 시험장비(마스터) 역할로 203 을 실제 버스에 보내고(test_unsupported 플래그),
# 노드가 작동하지 않고 에러/READY 로 답하는지, 이어 0 명령에 READY 로 가는지 본다. 제어기 검정 항목이 아니라 참고 증적.
def _abnormal_cmd(t, c, kind, n, code, stop_op, dev, mb):
    """§5.3.1(스위치 203)·§5.3.3(개폐기 305) 공통 b)~f). '작동중' 은 스위치 201, 개폐기 301(여는중)/302(닫는중)."""
    moving = (201,) if kind == "switch" else (301, 302)
    name = "스위치" if kind == "switch" else "개폐기"
    before = _dev_state(c, kind, n) or {}
    r = http("POST", f"{c.daemon}/command", {"unit": c.au, "kind": kind, "n": n, "op": code, "seconds": 0, "test_unsupported": True})[1]
    sent = "opid" in r and "미지원" not in str(r.get("error", ""))
    t.step(f"b) 쓰기영역에 작동 명령 (OPID·{code}) — 시험용 강제 송신, 버스로 나감", sent,
           f"{r}" + (f" ← 노드가 Modbus 예외 {r.get('exception')} 로 쓰기 자체를 거부" if r.get("exception") else ""))
    opid_bad = r.get("opid")
    time.sleep(c.poll + 0.5)
    sim = _sim_cmd(c, kind, n) or {}
    # 시험장비는 받은 쓰기 블록(cmd·OPID)을 기록하되 적용하지 않는다 → 작동중 아님·남은시간 0·적용 OPID 가 그 명령의 OPID 가 아님
    t.step(f"c) {name}가 작동하지 않음 (시험장비: 작동중 아님·남은시간 0·{code} 미적용)",
           sim.get("status") not in moving and int(sim.get("remain") or 0) == 0 and sim.get("opid") != opid_bad,
           f"{sim} — {code} 수신 기록은 남으나 적용 OPID {sim.get('opid')} ≠ {opid_bad}")
    st = _dev_state(c, kind, n) or {}
    same = st.get("opid") == opid_bad
    t.step("d) 읽기영역: 상태가 에러(1~6) 혹은 READY(0) + OPID 확인", st.get("status") in range(0, 7),
           f"상태 {st.get('status')}({st.get('status_name')}), OPID {st.get('opid')} — " + ("명령 OPID 와 동일" if same else f"명령 OPID {opid_bad} 와 다름 = 쓰기가 예외로 거부되어 이전 OPID {before.get('opid')} 유지"))
    r2 = c.ui_control(dev, stop_op, 0, mb)
    t.step("e) 쓰기영역에 작동중지 명령 (OPID·0) — 제어기 화면 경로", r2[0] == 200 and r2[1].get("success"), r2[1])
    got = c.wait_until(lambda: (lambda x: x if x and x.get("cmd") == 0 and x.get("cmd_opid") not in (None, before.get("opid")) else None)(_sim_cmd(c, kind, n)), 10)
    opid0 = got.get("cmd_opid") if got else None
    st2 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, kind, n)), c.poll * 3 + 2)
    ok, why = _stopped_ok(st2, opid0)
    t.step("f) 읽기영역: OPID 확인 + 상태 READY(0)", ok and st2.get("remain") == 0, why)


def t_531(c, n=1):
    t = Test(c, "5.3.1", "레벨 1 스위치 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)", "SPS-7466 §5.3.1 a)~f) (203 → 미작동·에러/READY → 0 → READY)")
    if not _step_a_level1(t, c, "switch", n):
        return t.done()
    _abnormal_cmd(t, c, "switch", n, 203, "off", f"kstest_sw{n}", {"protocol": "ks3267", "unit": c.au, "kind": "switch", "n": n})
    return t.done()


def t_533(c, n=1):
    """§5.3.3 a)~f): 개폐기에 305(레벨2 SET_POSITION) → 작동 안 함·에러/READY·OPID → 0 → READY (2026-09-15)"""
    t = Test(c, "5.3.3", "레벨 1 개폐기 비정상 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)", "SPS-7466 §5.3.3 a)~f) (305 → 미작동·에러/READY → 0 → READY)")
    if not _step_a_level1(t, c, "opener", n):
        return t.done()
    _abnormal_cmd(t, c, "opener", n, 305, "stop", f"kstest_op{n}", {"protocol": "ks3267", "unit": c.au, "kind": "opener", "n": n, "controlType": "bidir"})
    return t.done()


# ── §5.3.4 레벨 1 개폐기 동일 OPID 명령 시험 — 노드 시험 (2026-09-15) ──────────────
# 노드는 OPID 가 바뀔 때만 명령 블록을 활성화한다 (KS X 3267 6.3.3). 드라이버가 시험장비 역할로 OPID 를 지정해 보내고(test_opid),
# "쓰기 영역에 OPID 를 새로운 값으로 변경" 은 OPID 워드 1개만 다시 쓴다(/test/opid). 화면 경로는 OPID 를 정할 수 없으므로 여기선 안 쓴다.
def _same_opid_half(t, c, n, code, stname, label, L, prev_opid, seconds):
    """L = 글자 11개: [작동시간 명령(같은 OPID), 미작동, OPID 새 값, 작동, 읽기 OPID·작동중, 중지(같은 OPID), 여전히 작동, 읽기 OPID·작동중, OPID 새 값, 중지, 읽기 READY]"""
    moving = "여는중" if stname == 301 else "닫는중"
    cmd = lambda body: http("POST", f"{c.daemon}/command", {"unit": c.au, "kind": "opener", "n": n, **body})[1]
    new_opid = lambda: http("POST", f"{c.daemon}/test/opid", {"unit": c.au, "kind": "opener", "n": n})[1]
    settle = lambda: time.sleep(c.poll + 0.5)

    r = cmd({"op": code, "seconds": seconds, "test_opid": prev_opid})
    t.step(f"{L[0]} 쓰기영역에 작동시간 {label} 명령 (OPID·{code}·{seconds}s) — OPID 를 직전 명령과 같은 {prev_opid} 로", r.get("ok") and r.get("opid") == prev_opid, r)
    settle()
    sim = _sim_cmd(c, "opener", n) or {}
    t.step(f"{L[1]} 개폐기가 작동하지 않음 (같은 OPID 는 활성화 아님)", sim.get("status") == 0 and int(sim.get("remain") or 0) == 0,
           f"시험장비 {sim} / 제어기 읽기 {_dev_state(c, 'opener', n)}")
    w = new_opid()
    t.step(f"{L[2]} 쓰기영역의 OPID 를 새 값 {w.get('opid')} 으로 변경 (OPID 워드 1개만 씀)", w.get("ok") and w.get("opid") not in (None, prev_opid), w)
    got = c.wait_until(lambda: (lambda x: x if x and x.get("status") == stname and int(x.get("remain") or 0) > 0 else None)(_sim_cmd(c, "opener", n)), 10)
    t.step(f"{L[3]} 개폐기 작동 (시험장비 {moving}·남은시간 {got and got.get('remain')}s)", got is not None, got)
    st = c.wait_until(lambda: (lambda d: d if d and d.get("status") == stname else None)(_dev_state(c, "opener", n)), c.poll * 3 + 2)
    t.step(f"{L[4]} 읽기영역: OPID 동일({w.get('opid')}) + 상태 {moving}({stname})", st is not None and st.get("opid") == w.get("opid"), st)

    r2 = cmd({"op": "stop", "seconds": 0, "test_opid": w.get("opid")})
    t.step(f"{L[5]} 쓰기영역에 작동중지 명령 (OPID·0) — OPID 를 작동 명령과 같은 {w.get('opid')} 로", r2.get("ok") and r2.get("opid") == w.get("opid"), r2)
    settle()
    sim2 = _sim_cmd(c, "opener", n) or {}
    t.step(f"{L[6]} 개폐기가 여전히 작동 (같은 OPID 의 중지는 무시)", sim2.get("status") == stname and int(sim2.get("remain") or 0) > 0, sim2)
    st2 = _dev_state(c, "opener", n) or {}
    t.step(f"{L[7]} 읽기영역: OPID 동일({w.get('opid')}) + 상태 작동중({stname})", st2.get("status") == stname and st2.get("opid") == w.get("opid"), st2)

    w2 = new_opid()
    t.step(f"{L[8]} 쓰기영역의 OPID 를 새 값 {w2.get('opid')} 으로 변경", w2.get("ok") and w2.get("opid") not in (None, w.get("opid")), w2)
    got2 = c.wait_until(lambda: (lambda x: x if x and x.get("status") == 0 else None)(_sim_cmd(c, "opener", n)), 10)
    t.step(f"{L[9]} 개폐기 중지", got2 is not None and int(got2.get("remain") or 0) == 0, got2)
    st3 = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "opener", n)), c.poll * 3 + 2)
    ok, why = _stopped_ok(st3, w2.get("opid"))
    t.step(f"{L[10]} 읽기영역: OPID 확인 + 상태 READY(0)", ok and st3.get("remain") == 0, why)
    return w2.get("opid")


def t_534(c, n=1, seconds=30):
    t = Test(c, "5.3.4", "레벨 1 개폐기 동일 OPID 명령 시험 (노드 시험 — 드라이버가 시험장비 역할)", "SPS-7466 §5.3.4 a)~y) (같은 OPID 무시 · 새 OPID 로 활성화, 303/304 각각)")
    if not _step_a_level1(t, c, "opener", n):
        return t.done()
    r = http("POST", f"{c.daemon}/command", {"unit": c.au, "kind": "opener", "n": n, "op": "stop", "seconds": 0})[1]
    t.step("b) 쓰기영역에 작동중지 명령 (OPID·0)", r.get("ok"), r)
    st = c.wait_until(lambda: (lambda d: d if d and d.get("status") == 0 else None)(_dev_state(c, "opener", n)), c.poll * 3 + 2)
    ok, why = _stopped_ok(st, r.get("opid"))
    t.step("c) 읽기영역: OPID 확인 + 상태 READY(0)", ok, why)
    prev = r.get("opid")
    prev = _same_opid_half(t, c, n, 303, 301, "열기", ["d)", "e)", "f)", "g)", "h)", "i)", "j)", "k)", "l)", "m)", "n)"], prev, seconds)
    _same_opid_half(t, c, n, 304, 302, "닫기", ["o)", "p)", "q)", "r)", "s)", "t)", "u)", "v)", "w)", "x)", "y)"], prev, seconds)
    return t.done()


# ── KOAT 116/117 「연결단자 해제·재연결」 — 5회, 각 2분 이내 정상 복귀 (2026-09-14) ──
# 검정기준 마. 시험방법 1-가)·2-가): 노드 1/3 이상의 연결단자를 해제했다가 재연결하고 2분 이내 정상 출력을
# 5회 확인한다. 시험장비의 /fault 는 버스의 모든 노드에 걸리므로 센서·구동기 노드 100% 가 해제된다(≥ 1/3).
# 실물 시험은 M12 커넥터를 물리적으로 뽑는다 — 이 자동 시험은 '응답 없음' 을 같은 방식으로 만들어
# 제어기의 인지·복귀 경로(드라이버 폴링 → 화면 프록시)가 기준 안에 도는지를 증명한다.
def _unit_ok(st):
    """드라이버 상태가 정상 폴링 결과인가 — 오류가 없고 센서/디바이스 값이 실려 있다"""
    if not st or st.get("error"):
        return False
    return bool(st.get("sensors") or st.get("devices"))


def _proxy_ok(c, unit):
    """화면 경로: NR /api/ks3267/status — 표준노드 탭·제어판 배지가 쓰는 프록시에서도 정상인가"""
    code, body = http("GET", f"{c.nr}/api/ks3267/status?unit={unit}", timeout=10)
    st = body.get("state") if isinstance(body, dict) else None
    return code == 200 and _unit_ok(st)


def t_116_reconnect(c, cycles=5, hold=10, limit=120):
    t = Test(c, "116-재연결", "연결단자 해제·재연결 후 2분 이내 정상 복귀 (5회)",
             "KOAT 검정기준 116/117 통합제어기 마. 시험방법 1-가)·2-가)")
    units = [c.su, c.au]
    t.step("시작 전: 센서·구동기 노드 모두 정상", all(_unit_ok(c.d_status(u)) for u in units))
    recov = []
    try:
        for i in range(1, cycles + 1):
            c.s_post("/fault", {"fault": "timeout"})
            t0 = time.time()
            lost = c.wait_until(lambda: all(not _unit_ok(c.d_status(u)) for u in units), timeout=30, every=0.5)
            t.step(f"{i}회 해제: 제어기가 두 노드 모두 '응답 없음' 을 인지", bool(lost), f"{time.time() - t0:.1f}s 만에 인지")
            time.sleep(hold)
            c.s_post("/fault", {"fault": "none"})
            t1 = time.time()
            back = c.wait_until(lambda: all(_unit_ok(c.d_status(u)) for u in units), timeout=limit + 10, every=0.5)
            sec = time.time() - t1
            recov.append(sec)
            t.step(f"{i}회 재연결: {limit}초 이내 정상 복귀 (드라이버)", bool(back) and sec <= limit, f"{sec:.1f}s")
            ui = c.wait_until(lambda: all(_proxy_ok(c, u) for u in units), timeout=limit, every=1.0)
            t.step(f"{i}회 재연결: 화면 경로(NR 프록시)에서도 정상", bool(ui), f"재연결 후 {time.time() - t1:.1f}s")
    finally:
        c.s_post("/fault", {"fault": "none"})   # 어떤 경우에도 시험장비를 정상으로 되돌린다
    if recov:
        t.step("복귀 시간 요약 (기준 120초)", max(recov) <= limit,
               f"최소 {min(recov):.1f}s / 최대 {max(recov):.1f}s / 평균 {sum(recov) / len(recov):.1f}s")
    c.manual.append("116 연결 해제·재연결 화면 증적: 신고한 관제 방식(키오스크·웹·모바일)마다 표준노드 탭 '응답 없음' → 정상 복귀를 캡처. 실물은 M12 커넥터를 물리적으로 해제(노드 1/3 이상)")
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
    p.add_argument("--server", default="https://api.smartgreen.kr", help="§5.4.4 서버 되읽기 주소")
    p.add_argument("--api-key-file", default="/home/lhk/smartfarm/.sensor-api-key", help="§5.4.4 농장 API 키 파일")
    p.add_argument("--duration", type=float, default=600, help="§5.4.4 진행 시간(초), 표준은 최소 600")
    a = p.parse_args()
    c = Ctx(a)
    at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    health = c.d_get("/health")
    if not health.get("ok"):
        print("드라이버(ks3267d) 응답 없음:", health); sys.exit(2)
    tests = [("5.4.1", t_541), ("5.4.2", t_542), ("5.4.3", t_543), ("5.5.1", t_551), ("5.5.2", t_552), ("5.5.3", t_553), ("부가-L2", t_extra_level2),
             ("5.2.1", t_521), ("5.2.2", t_522), ("5.3.1", t_531), ("5.3.3", t_533), ("5.3.4", t_534), ("116-재연결", t_116_reconnect)]
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    if "5.4.4" in only:
        tests.insert(3, ("5.4.4", t_544))   # 10분 이상 걸려 --only 로 지정할 때만
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
