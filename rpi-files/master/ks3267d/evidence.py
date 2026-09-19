# -*- coding: utf-8 -*-
"""실노드 증적 묶음 — 화면 버튼 하나로 드라이버가 "지금 읽히는 것" 을 SPS-7466 표 4 순서로 판정해 남긴다 (2026-09-19).

시뮬레이터 자가시험(selftest_sps7466.py)은 시험장비 API 로 관측치·스펙을 바꿔 가며 판정하지만, 실 노드는
바꿀 수 없다. 그래서 여기서는 드라이버가 이미 가진 것(탐색 결과·마지막 폴링·변화 이력·로컬 1분 저장·프레임)만으로
판정하고, 화면 캡처가 필요한 항목은 '수동 증적' 으로 적는다. 입고 시험장(인터넷·SSH 없음)에서 심사관 앞에서 쓴다.

결과: <evidence_dir>/realnode-YYYYmmdd-HHMMSS/{report.md, results.json, frames.txt} — 자가시험 폴더와 같은 3종.
순수 함수(build)와 파일 입출력(write/list_packages/read_file/delete)을 나눠 두어 테스트가 가짜 master 로 돈다.
"""
import datetime as dt
import json
import os
import re
import shutil
import time

from master import STATUS_NAMES
from selftest_sps7466 import _act_kinds, _codes_of, _kinds  # 판정 문구를 자가시험 보고서와 같게

EXPECT = {"sensor": {"product_type": 1, "channels": 30, "label": "센서 노드", "tid": "5.4.2"},
          "actuator": {"product_type": 2, "channels": 24, "label": "구동기 노드", "tid": "5.5.1"}}
PROTOCOL_VERSION = 10
FILES = ("report.md", "results.json", "frames.txt")
ID_RE = re.compile(r"^realnode-\d{8}-\d{6}(-\d+)?$")
STORE_MINUTES = 10  # §5.4.4 "10분 이상" — 로컬 1분 저장이 이만큼 빈틈없이 있어야 통과


class _T:
    """자가시험의 Test 와 같은 모양의 결과를 만든다 (ctx 없이)."""
    def __init__(self, tid, title, ref):
        self.id, self.title, self.ref, self.steps = tid, title, ref, []

    def step(self, name, ok, detail=""):
        self.steps.append({"step": name, "ok": bool(ok), "detail": str(detail)[:600]})
        return ok

    def result(self):
        return {"id": self.id, "title": self.title, "ref": self.ref,
                "ok": all(s["ok"] for s in self.steps) and bool(self.steps), "steps": self.steps}


def _fmt_t(t):
    return dt.datetime.fromtimestamp(float(t)).strftime("%H:%M:%S")


def _minutes(rows, start, end):
    """로컬 저장 행들의 '분' 집합 (start~end 안) — 행의 timestamp 는 ISO 로컬 문자열"""
    out = set()
    for r in rows:
        try:
            ts = dt.datetime.fromisoformat(str(r["timestamp"])).timestamp()
        except Exception:
            continue
        if start <= ts <= end:
            out.add(int(ts // 60))
    return out


def _store_test(tid, title, rows, unit, now, label):
    """§5.4.4(센서)·116(구동기) 로컬 1분 저장 판정 — 최근 STORE_MINUTES 분이 빈틈없이 있는가"""
    t = _T(tid, title, "SPS-7466 §5.4.4 a)~d) / KOAT 116 — 제어기 로컬 1분 저장(SQLite), 저장주기 60초")
    if rows is None:
        t.step("로컬 저장소", False, "드라이버에 로컬 스냅샷 저장소가 없습니다")
        return t.result()
    window_start = now - STORE_MINUTES * 60
    mins = _minutes(rows, window_start, now)
    # 창의 첫 분은 부분 분이라 셈에서 뺀다: 600초 창엔 완전한 분이 10개다
    expect = STORE_MINUTES
    got = len(mins)
    ok = got >= expect
    t.step(f"a) 최근 {STORE_MINUTES}분 저장 (저장주기 60초, {label})", ok,
           f"{got}/{expect}분" + ("" if ok else f" — 노드 등록 뒤 {STORE_MINUTES}분이 지난 다음 다시 만드세요"))
    if rows:
        first, last = rows[0]["timestamp"], rows[-1]["timestamp"]
        t.step("b) 저장 행 (관측치·상태 매분, 점검군 상태도 그대로)", True, f"{len(rows)}행 · {first} ~ {last}")
        st_codes = sorted({int(r.get("status") or 0) for r in rows})
        t.step("c) 저장된 상태 코드", all(c in STATUS_NAMES for c in st_codes), f"{st_codes}")
    else:
        t.step("b) 저장 행", False, "최근 1시간 저장 행 없음")
    t.step("d) 서버 저장(ks_sensor_status·actuator_status)은 인터넷이 있을 때 화면 「§5.4.4 데이터 저장 확인」·보고서 › 데이터 조회로 — 수동", True, "수동 증적")
    return t.result()


def build(master, store, info, conntest, unit, now=None):
    """지금 상태로 증적 묶음(dict)을 만든다.
    master: KsMaster (nodes, state, changes, events, t.frames)   store: LocalStore | None
    info: transport_info(master.t)   conntest: /conntest 와 같은 dict {rows, prep, passed}
    """
    now = float(now if now is not None else time.time())
    node = (master.nodes or {}).get(unit)
    if not node:
        raise ValueError(f"unit {unit}: 탐색된 노드가 아닙니다 — ② 에서 먼저 탐색하세요")
    kind = node.get("kind")
    exp = EXPECT.get(kind)
    if not exp:
        raise ValueError(f"unit {unit}: 지원하지 않는 노드 종류 {kind}")
    st = (master.state or {}).get(unit) or {}
    results, manual = [], []

    # ── 5.4.1 연결시험 (화면 「§5.4.1 연결 시험」과 같은 판정) ──
    t = _T("5.4.1", "연결시험", "SPS-7466 §5.4.1 a)~d) + 당일 준비 점검")
    rows = {r["step"]: r for r in (conntest or {}).get("rows", [])}
    for k, title in (("a", "a) RS485 케이블로 노드와 연결 (표준 포트 열림)"), ("b", "b) 통신 설정 9600 bps · 8N1 · RTU"),
                     ("c", f"c) 노드 슬레이브 아이디 {unit}"), ("d", "d) 통신 연결 수행 (노드 정보 수신)")):
        r = rows.get(k) or {}
        t.step(title, r.get("ok"), r.get("actual", "판정 없음") + (f" · {r['note']}" if r.get("note") else ""))
    for p in (conntest or {}).get("prep", []):
        if p.get("ok") is None:
            continue
        t.step("준비) " + str(p.get("title")), p.get("ok"), p.get("detail", ""))
    results.append(t.result())

    # ── 5.4.2 / 5.5.1 노드 검색 (노드정보 1~8 · 디바이스 코드) ──
    t = _T(exp["tid"], f"디폴트 레지스터맵 {exp['label']} 검색 시험", f"SPS-7466 §{exp['tid']} a)~d) (KS X 3267 노드정보 1~8 · 디바이스 코드 101~)")
    t.step("a) 노드 응답·등록", bool(node.get("supported")), f"unit {unit} · {exp['label']}")
    t.step("b) 기관코드 0 · 회사코드 0 (디폴트맵)", node.get("cert_authority") == 0 and node.get("company_code") == 0,
           f"기관 {node.get('cert_authority')} · 회사 {node.get('company_code')}")
    t.step(f"b) 제품타입 {exp['product_type']} ({exp['label']})", node.get("product_type") == exp["product_type"], f"{node.get('product_type')}")
    t.step(f"b) 프로토콜 버전 {PROTOCOL_VERSION}", node.get("protocol_version") == PROTOCOL_VERSION, f"{node.get('protocol_version')}")
    t.step(f"b) 채널수 {exp['channels']}", node.get("channels") == exp["channels"], f"{node.get('channels')}")
    t.step("c) 디폴트 레지스터맵 판정", bool(node.get("default_map")), "; ".join(node.get("notes") or []) or "디폴트맵")
    codes = _codes_of(node)
    summary = _kinds(codes) if kind == "sensor" else _act_kinds(codes)
    t.step(f"d) 연결된 디바이스 {len(codes)}개 — {summary}", len(codes) > 0,
           ", ".join(f"#{i} 코드 {c}" for i, c in sorted(codes.items())) or "디바이스 코드 전부 0")
    results.append(t.result())
    manual.append(f"③ 노드 {unit} 카드 「노드 기본정보 시험표」 전 항목 일치 화면 캡처 (§{exp['tid']} d)")

    if kind == "sensor":
        # ── 5.1.3 / 5.4.3 데이터 읽기·확인 ──
        t = _T("5.4.3", "데이터 확인 시험 (실노드: 지금 읽히는 관측치·상태와 변화 이력)", "SPS-7466 §5.4.3 a)~d) / §5.1.3 b·c (관측치 CDAB float · 상태코드 정의값)")
        if st.get("error") or not st.get("sensors"):
            t.step("a) 마지막 폴링", False, st.get("error") or "폴링 상태 없음")
        else:
            t.step("a) 노드 상태 202", int(st.get("node_status", -1)) in STATUS_NAMES, f"{st.get('node_status')} {st.get('node_status_name')} · 폴링 {_fmt_t(st.get('t', now))}")
            for idx, s in sorted(st["sensors"].items(), key=lambda kv: int(kv[0])):
                v = s.get("value")
                ok = isinstance(v, (int, float)) and v == v and int(s.get("status", -1)) in STATUS_NAMES
                t.step(f"b) #{idx} {s.get('name')} 관측치·상태", ok, f"{v} · 상태 {s.get('status')} {s.get('status_name')}")
        changes = list((master.changes or {}).get(unit, []))[-120:]
        if changes:
            span = changes[-1]["t"] - changes[0]["t"]
            per = {}
            for c in changes:
                per[c.get("name")] = per.get(c.get("name"), 0) + 1
            t.step(f"c) 관측치·상태 변화 이력 {len(changes)}건 ({_fmt_t(changes[0]['t'])}~{_fmt_t(changes[-1]['t'])}, {span:.0f}초)", True,
                   " · ".join(f"{k} {n}건" for k, n in per.items()))
            tail = changes[-5:]
            t.step("d) 최근 변화 5건", True, "; ".join(f"{_fmt_t(c['t'])} {c.get('name')} {c.get('prev_value')}→{c.get('value')} 상태 {c.get('prev_status')}→{c.get('status')}" for c in tail))
        else:
            t.step("c) 관측치·상태 변화 이력", False, "변화 없음 — 센서를 감싸거나 바람을 불어 값을 바꾼 뒤 다시 만드세요")
        results.append(t.result())
        manual.append(f"③ 노드 {unit} 카드 「노드 데이터 읽기 시험표」·「§5.4.3 관측 변화 이력」 화면 캡처")
        rows = store.query_sensor(unit=unit, start=now - 3600, end=now, limit=20000) if store is not None else None
        results.append(_store_test("5.4.4", "데이터 저장 시험 (10분 이상, 제어기 로컬 1분 저장)", rows, unit, now, "센서 관측치·상태"))
        manual.append("보고서 › 데이터 조회·추출 › 「표준 센서 관측치·상태 (KS X 3267)」 조회·csv 추출 화면 캡처 (인터넷 필요)")
    else:
        # ── 5.5.2 / 5.5.3 구동기 상태 (실노드: 지금 상태 + 최근 명령 이력) ──
        t = _T("5.5.2/5.5.3", "레벨 1 스위치·개폐기 상태 (실노드: 지금 상태와 최근 명령 이력)", "SPS-7466 §5.5.2 a)~j) · §5.5.3 a)~s) (202/303/304 → 201/301/302·남은시간 → 0 → READY)")
        if st.get("error") or not st.get("devices"):
            t.step("a) 마지막 폴링", False, st.get("error") or "폴링 상태 없음")
        else:
            t.step("a) 노드 상태 202 · 노드 OPID 201", int(st.get("node_status", -1)) in STATUS_NAMES, f"상태 {st.get('node_status')} {st.get('node_status_name')} · OPID {st.get('node_opid')} · 폴링 {_fmt_t(st.get('t', now))}")
            for idx, d in sorted(st["devices"].items(), key=lambda kv: int(kv[0])):
                ok = int(d.get("status", -1)) in STATUS_NAMES
                t.step(f"b) #{idx} {d.get('name')} 상태·OPID·남은시간", ok, f"상태 {d.get('status')} {d.get('status_name')} · OPID {d.get('opid')} · 남은 {d.get('remain')}s")
        evs = [e for e in (master.events or []) if e.get("unit") == unit and e.get("kind") in ("command", "write_opid", "command_exception", "command_timeout")][-30:]
        if evs:
            t.step(f"c) 최근 명령 이력 {len(evs)}건", all(e.get("kind") == "command" and e.get("accepted") for e in evs),
                   "; ".join(f"{_fmt_t(e['t'])} {e.get('dev')} op {e.get('op')} opid {e.get('opid')} → 상태 {e.get('status')} 남은 {e.get('remain')}" + ("" if e.get("kind") == "command" else f" [{e.get('kind')}]") for e in evs[-8:]))
        else:
            t.step("c) 최근 명령 이력", False, "명령 없음 — 제어판에서 「시간 지정 ON」·「시간 열기/닫기」·정지를 보낸 뒤 다시 만드세요")
        results.append(t.result())
        manual.append("제어판 카드 배지(켜짐/열리는 중 NN s → READY)와 표준노드 탭 §5.1.3 표(201/301/302·남은시간) 화면 캡처 (§5.5.2 e·f·j, §5.5.3 e·l·s)")
        rows = store.query_actuator(unit=unit, start=now - 3600, end=now, limit=20000) if store is not None else None
        results.append(_store_test("116-저장", "구동기 상태 1분 저장 (제어기 로컬)", rows, unit, now, "구동기 상태"))
        manual.append("보고서 › 데이터 조회·추출 › 「표준 구동기 상태」 조회 화면 캡처 (인터넷 필요)")

    manual.append("④ 진단 「통신 프레임」 화면 캡처 (frames.txt 와 같은 내용)")
    frames = master.t.frames.recent(400) if hasattr(master.t, "frames") else []
    stats = dict(getattr(getattr(master.t, "frames", None), "stats", {}) or {})
    events = list(master.events or [])[-200:]
    at = dt.datetime.fromtimestamp(now)
    return {
        "id": "realnode-" + at.strftime("%Y%m%d-%H%M%S"),
        "meta": {"at": at.strftime("%Y-%m-%d %H:%M:%S"), "t": now, "unit": unit, "kind": kind, "label": exp["label"],
                 "transport": (info or {}).get("desc"), "comm": info, "source": "realnode-ui"},
        "node": node, "state": st,
        "results": results, "manual": manual, "stats": stats, "frames": frames, "events": events,
        "passed": sum(1 for r in results if r["ok"]), "total": len(results),
    }


def render_report(ev):
    m = ev["meta"]
    s = ev.get("stats") or {}
    L = [f"# SPS-X KOAT-0004-7466 §5.4/§5.5 실노드 증적 — {m['label']} unit {m['unit']}", "",
         f"- 일시: {m['at']}", f"- 시험대상장비: 스마트그린 통합제어기 (RPi + Node-RED + ks3267d) — 드라이버 전송: {m.get('transport')}",
         f"- 시험장비: 실제 KS X 3267 노드 (unit {m['unit']}, {m['label']}) — 화면 「실노드 증적 만들기」 로 생성",
         f"- 결과: **{ev['passed']}/{ev['total']} 통과**",
         f"- 프레임: TX {s.get('tx')} / RX {s.get('rx')} / 예외 {s.get('exceptions')} / 타임아웃 {s.get('timeouts')} (frames.txt)", "",
         "| 시험 | 항목 | 근거 | 결과 |", "|---|---|---|---|"]
    for r in ev["results"]:
        L.append(f"| {r['id']} | {r['title']} | {r['ref']} | {'✅ 통과' if r['ok'] else '❌ 실패'} |")
    L.append("")
    for r in ev["results"]:
        L += [f"## {r['id']} {r['title']}", ""]
        for st in r["steps"]:
            L.append(f"- {'✅' if st['ok'] else '❌'} {st['step']}" + (f" — `{st['detail']}`" if st["detail"] else ""))
        L.append("")
    L += ["## 수동 증적 항목 (화면 캡처·저장 확인)", ""] + [f"- [ ] {x}" for x in ev["manual"]] + [""]
    return "\n".join(L)


def render_frames(frames):
    out = []
    for fr in frames or []:
        ts = dt.datetime.fromtimestamp(fr.get("t", 0)).strftime("%H:%M:%S.%f")[:-3]
        out.append(f"{ts} {fr.get('dir'):2} {fr.get('hex')}")
    return "\n".join(out) + ("\n" if out else "")


def summary_of(ev):
    m = ev["meta"]
    return {"id": ev["id"], "at": m["at"], "t": m.get("t"), "unit": m["unit"], "kind": m["kind"], "label": m["label"],
            "transport": m.get("transport"), "passed": ev["passed"], "total": ev["total"],
            "tests": [{"id": r["id"], "title": r["title"], "ok": r["ok"]} for r in ev["results"]], "files": list(FILES)}


def write(evidence_dir, ev):
    """묶음을 폴더로 쓴다. 같은 초에 두 번이면 -2, -3 … 붙인다. 반환: summary"""
    os.makedirs(evidence_dir, exist_ok=True)
    base = ev["id"]; pid = base; n = 1
    while os.path.exists(os.path.join(evidence_dir, pid)):
        n += 1; pid = f"{base}-{n}"
    ev["id"] = pid
    out = os.path.join(evidence_dir, pid)
    os.makedirs(out)
    body = {k: v for k, v in ev.items() if k != "frames"}
    body["summary"] = summary_of(ev)
    with open(os.path.join(out, "results.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, indent=1, default=str)
    with open(os.path.join(out, "frames.txt"), "w", encoding="utf-8") as f:
        f.write(render_frames(ev.get("frames")))
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write(render_report(ev))
    return summary_of(ev)


def list_packages(evidence_dir):
    """실노드 묶음 목록(최신 먼저). results.json 의 summary 만 읽는다."""
    out = []
    if not os.path.isdir(evidence_dir):
        return out
    for name in sorted(os.listdir(evidence_dir), reverse=True):
        if not ID_RE.match(name):
            continue
        p = os.path.join(evidence_dir, name, "results.json")
        try:
            with open(p, encoding="utf-8") as f:
                s = json.load(f).get("summary") or {}
            s["id"] = name
            out.append(s)
        except Exception as e:
            out.append({"id": name, "error": f"읽기 실패: {e}"})
    return out


def _check(evidence_dir, pid, name=None):
    if not ID_RE.match(pid or ""):
        raise ValueError("잘못된 증적 id")
    if name is not None and name not in FILES:
        raise ValueError("잘못된 파일 이름")
    d = os.path.join(evidence_dir, pid)
    if not os.path.isdir(d):
        raise FileNotFoundError(f"증적 {pid} 없음")
    return d


def read_file(evidence_dir, pid, name):
    d = _check(evidence_dir, pid, name)
    with open(os.path.join(d, name), encoding="utf-8") as f:
        return f.read()


def delete(evidence_dir, pid):
    d = _check(evidence_dir, pid)
    shutil.rmtree(d)
    return True
