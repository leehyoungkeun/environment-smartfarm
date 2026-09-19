# -*- coding: utf-8 -*-
"""로컬 REST — 127.0.0.1 전용 (NR 오케스트레이터·백엔드 프록시가 부른다). 표준 라이브러리만.

GET  /health
GET  /discover?unit=N        탐색 후 등록 (탐색 결과 반환)
GET  /scan?from=1&to=16&timeout=300   범위 자동스캔(ms 타임아웃) — 응답 노드 등록·반환
GET  /nodes                  등록된 노드 서술자
GET  /status[?unit=N]        마지막 폴링 상태
POST /command  {unit, kind, n, op, seconds}
GET  /frames[?n=50]          최근 TX/RX hex (진단·시험 증적)
GET  /events[?n=50]
GET  /comm                   통신 설정·포트 목록 (2026-09-15)
POST /comm   {mode, port, baud, timeout, tcp}   통신 설정 변경 — 재시작 없이 다시 연결하고 저장
GET  /conntest?unit=N        SPS-7466 §5.4.1 연결시험 a)~d) 판정
GET  /evidence               실노드 증적 묶음 목록 (2026-09-19)
POST /evidence {unit}        지금 상태로 증적 묶음 생성 → <evidence_dir>/realnode-…/{report.md,results.json,frames.txt}
GET  /evidence/<id>/<file>   묶음 파일 내용 (JSON {content}) — 화면이 내려받기로 만든다
POST /evidence/delete {id}

통신 설정 변경은 rpi-server(/local-config/ks3267/comm)가 권한을 거른 뒤 부른다 — 이 데몬은 루프백에만 뜬다.
"""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import comm as commlib
import evidence as evlib
from transport import ModbusExc, TransportTimeout


def transport_info(t):
    """화면·연결 시험이 보는 현재 전송 정보"""
    connected = None
    if hasattr(t, "is_connected"):
        try:
            connected = bool(t.is_connected())
        except Exception:
            connected = False
    return {"mode": getattr(t, "mode", None), "port": getattr(t, "port", None), "baud": getattr(t, "baud", None),
            "tcp": getattr(t, "tcp", None), "timeout": getattr(t, "timeout", None),
            "desc": getattr(t, "desc", "?"), "connected": connected}


COMMAND_EVENTS = ("command", "write_opid", "command_exception", "command_timeout")


def _origin_of(body):
    """요청 본문의 source → master 의 origin. NR 「표준 명령 조립」은 {via:'screen', house, device, by} 를 보낸다.
    test_unsupported/test_opid 가 있으면 시험장비 역할 명령이라 'test'. 없으면 master 가 'direct' 로 둔다."""
    src = body.get("source") if isinstance(body.get("source"), dict) else ({"via": body["source"]} if body.get("source") else {})
    if body.get("test_unsupported") or body.get("test_opid"):
        src = dict(src, via="test")
    return src


def _persist_command(master, ctx):
    """방금 master 가 남긴 명령 이벤트를 로컬 SQLite 에도 적는다 — 재시작·정전 뒤에도 실노드 증적의 명령 이력이 남게 (2026-09-19).
    저장 실패는 명령 결과에 영향을 주지 않는다."""
    store = (ctx or {}).get("store")
    if store is None or not master.events:
        return
    ev = master.events[-1]
    if ev.get("kind") in COMMAND_EVENTS:
        try:
            store.log_command(ev)
        except Exception:
            pass


def run_conntest(master, ctx, unit):
    """§5.4.1 a)~d) 판정 + 당일 준비 점검 — /conntest 와 실노드 증적이 같은 판정을 쓴다"""
    discovery = None
    if unit is not None and 1 <= unit <= 247:
        try:
            discovery = {"ok": True, "node": master.discover(unit)}
        except ModbusExc as e:
            discovery = {"ok": False, "error": str(e)}
        except TransportTimeout:
            discovery = {"ok": False, "error": "timeout — 응답 없음"}
    info = transport_info(master.t)
    # 당일 준비 점검: 표준 포트 인식 + 9600 으로 열리는지 (드라이버가 쓰는 포트는 prep_rows 가 다시 열지 않는다)
    prep = commlib.prep_rows(ctx["list_ports"]() if ctx else [], info, probe=commlib.probe_serial_open)
    return commlib.conn_test_rows(info, unit, discovery, prep=prep)


def make_handler(master, comm_ctx=None):
    ctx = comm_ctx or {}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):  # 조용히
            pass

        def _json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path); q = parse_qs(u.query)
            try:
                if u.path == "/health":
                    return self._json(200, {"ok": True, "transport": getattr(master.t, "desc", "?"),
                                            "nodes": list(master.nodes), "stats": master.snapshot()["stats"]})
                if u.path == "/discover":
                    unit = int(q.get("unit", ["0"])[0])
                    if not 1 <= unit <= 247:
                        return self._json(400, {"ok": False, "error": "unit 1~247"})
                    try:
                        return self._json(200, {"ok": True, "node": master.discover(unit)})
                    except ModbusExc as e:
                        return self._json(200, {"ok": False, "exception": e.code, "error": str(e)})
                    except TransportTimeout:
                        return self._json(200, {"ok": False, "error": "timeout — 응답 없음 (주소·배선·종단 확인)"})
                if u.path == "/scan":
                    start = int(q.get("from", ["1"])[0])
                    end = int(q.get("to", ["16"])[0])
                    timeout = float(q.get("timeout", ["300"])[0]) / 1000.0  # ms→s
                    return self._json(200, {"ok": True, "result": master.scan(start, end, timeout)})
                if u.path == "/nodes":
                    return self._json(200, {"ok": True, "nodes": master.nodes})
                if u.path == "/status":
                    # now: 데몬 현재시각 — 화면이 샘플 나이(now - state.t)를 시계 편차 없이 계산해 카운트다운 앵커를 보정한다
                    if "unit" in q:
                        return self._json(200, {"ok": True, "now": time.time(), "state": master.state.get(int(q["unit"][0]))})
                    return self._json(200, {"ok": True, "now": time.time(), "state": master.state})
                if u.path == "/frames":
                    n = int(q.get("n", ["50"])[0])
                    return self._json(200, {"ok": True, "frames": master.t.frames.recent(n),
                                            "stats": master.t.frames.stats})
                if u.path == "/events":
                    n = int(q.get("n", ["50"])[0])
                    return self._json(200, {"ok": True, "events": master.events[-n:]})
                if u.path == "/changes":
                    # §5.4.3 — 센서 관측치·상태 변화 이력 (폴링 해상도). unit 없으면 전체
                    n = int(q.get("n", ["60"])[0])
                    if "unit" in q:
                        return self._json(200, {"ok": True, "now": time.time(), "changes": master.changes.get(int(q["unit"][0]), [])[-n:]})
                    return self._json(200, {"ok": True, "now": time.time(), "changes": {str(u_): v[-n:] for u_, v in master.changes.items()}})
                if u.path.startswith("/local/"):
                    # 제어기 로컬 1분 스냅샷 (SQLite) — 인터넷 없이 §5.4.4·116 저장을 그 자리에서 보인다 (2026-09-15)
                    store = ctx.get("store") if ctx else None
                    if store is None:
                        return self._json(200, {"ok": False, "error": "로컬 스냅샷 저장소가 없습니다"})
                    g = lambda k, d=None: (q.get(k, [d])[0] if k in q else d)
                    f = lambda k: (float(g(k)) if g(k) not in (None, "") else None)
                    if u.path == "/local/summary":
                        return self._json(200, {"ok": True, "days": store.summary(int(g("days", "31"))), "path": store.path,
                                                "retentionDays": store.retention // 86400})
                    if u.path == "/local/vendor-actuator-status":
                        # 비표준(벤더) 구동기 1분 행 — 표준과 같은 로컬 저장 (2026-09-19)
                        rows = store.query_vendor_actuator(house_id=g("house"), device_id=g("device"), start=f("start"), end=f("end"),
                                                           limit=int(g("limit", "5000")))
                        if g("format") == "csv":
                            body = store.to_csv(rows, ["timestamp", "house_id", "device_id", "unit", "kind", "n", "name", "opid", "status", "status_name", "remain", "source"]).encode("utf-8")
                            self.send_response(200)
                            self.send_header("Content-Type", "text/csv; charset=utf-8")
                            self.send_header("Content-Length", str(len(body)))
                            self.end_headers()
                            self.wfile.write(body)
                            return None
                        return self._json(200, {"ok": True, "now": time.time(), "intervalSec": 60, "count": len(rows), "data": rows})
                    kind = u.path[len("/local/"):]
                    if kind not in ("sensor-status", "actuator-status"):
                        return self._json(404, {"ok": False, "error": "not found"})
                    unit = int(g("unit")) if g("unit") not in (None, "") else None
                    fn = store.query_sensor if kind == "sensor-status" else store.query_actuator
                    rows = fn(unit=unit, idx=g("idx"), start=f("start"), end=f("end"), limit=int(g("limit", "5000")))
                    if g("format") == "csv":
                        cols = ["timestamp", "unit", "idx", "code", "name", "value", "status", "status_name"] if kind == "sensor-status" \
                            else ["timestamp", "unit", "idx", "kind", "n", "name", "opid", "status", "status_name", "remain"]
                        body = store.to_csv(rows, cols).encode("utf-8")
                        self.send_response(200)
                        self.send_header("Content-Type", "text/csv; charset=utf-8")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return None
                    return self._json(200, {"ok": True, "now": time.time(), "intervalSec": 60, "count": len(rows), "data": rows})
                if u.path == "/comm":
                    if not ctx:
                        return self._json(200, {"ok": False, "error": "이 실행 방식은 통신 설정 변경을 지원하지 않습니다"})
                    return self._json(200, {"ok": True, "current": transport_info(master.t), "ports": ctx["list_ports"](),
                                            "standard": commlib.STANDARD, "allowedBauds": list(commlib.ALLOWED_BAUDS),
                                            "saved": commlib.load_comm(ctx["path"]) is not None})
                if u.path == "/conntest":
                    try:
                        unit = int(q.get("unit", [""])[0])
                    except ValueError:
                        unit = None
                    result = run_conntest(master, ctx, unit)
                    return self._json(200, {"ok": True, "at": time.time(), **result})
                if u.path == "/evidence":
                    # 실노드 증적 묶음 목록 (2026-09-19)
                    if not ctx.get("evidence_dir"):
                        return self._json(200, {"ok": False, "error": "증적 폴더가 설정되지 않았습니다"})
                    return self._json(200, {"ok": True, "dir": ctx["evidence_dir"], "packages": evlib.list_packages(ctx["evidence_dir"])})
                if u.path.startswith("/evidence/"):
                    parts = u.path.split("/")[2:]
                    if len(parts) != 2 or not ctx.get("evidence_dir"):
                        return self._json(404, {"ok": False, "error": "not found"})
                    try:
                        content = evlib.read_file(ctx["evidence_dir"], parts[0], parts[1])
                    except (ValueError, FileNotFoundError) as e:
                        return self._json(404, {"ok": False, "error": str(e)})
                    return self._json(200, {"ok": True, "id": parts[0], "name": parts[1], "content": content})
                return self._json(404, {"ok": False, "error": "not found"})
            except Exception as e:  # 진단 API 가 죽으면 안 된다
                return self._json(500, {"ok": False, "error": str(e)})

        def do_POST(self):
            u = urlparse(self.path)
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return self._json(400, {"ok": False, "error": "invalid json"})
            if u.path == "/command":
                try:
                    # test_unsupported: §5.3 노드 비정상 명령 시험(203/305/306)에서 우리 드라이버가 시험장비 마스터 역할을 할 때만 쓴다.
                    # 화면·NR 경로는 이 키를 보내지 않으므로 레벨2 명령은 평소처럼 로컬 거부된다 (자가시험 부가-L2 가 그것을 검증). 2026-09-15
                    # test_opid: §5.3.4 동일 OPID 시험 전용 — OPID 를 지정해 보낸다. 평소엔 매 명령 새 OPID.
                    r = master.command(int(body["unit"]), body["kind"], int(body["n"]), body["op"],
                                       seconds=int(body.get("seconds", 0) or 0),
                                       allow_unsupported=bool(body.get("test_unsupported", False)),
                                       opid=body.get("test_opid"), origin=_origin_of(body))
                    _persist_command(master, ctx)
                    return self._json(200, r)
                except (KeyError, ValueError, TypeError) as e:
                    return self._json(400, {"ok": False, "error": f"bad request: {e}"})
            if u.path == "/stats/reset":
                # 예외·타임아웃·스캔 미응답 카운터를 0 으로 (진단 프레임은 남긴다). 시험 당일 연결 시험·§5.3 뒤 화면 정리용.
                return self._json(200, {"ok": True, "stats": master.t.frames.reset_stats()})
            if u.path == "/test/opid":
                # §5.3.4 f)·l)·q)·w) 전용: 쓰기영역의 OPID 워드만 새 값으로 (시험장비 역할). 화면·NR 은 쓰지 않는다. 2026-09-15
                try:
                    r = master.write_opid(int(body["unit"]), body["kind"], int(body["n"]), body.get("opid"))
                    _persist_command(master, ctx)
                    return self._json(200, r)
                except (KeyError, ValueError, TypeError) as e:
                    return self._json(400, {"ok": False, "error": f"bad request: {e}"})
            if u.path == "/discover":
                try:
                    return self._json(200, {"ok": True, "node": master.discover(int(body["unit"]))})
                except (ModbusExc, TransportTimeout) as e:
                    return self._json(200, {"ok": False, "error": str(e)})
            if u.path == "/evidence":
                # 실노드 증적 묶음 생성 — 지금 상태(탐색 결과·마지막 폴링·변화 이력·로컬 저장·프레임)를 §5.4/5.5 순서로 판정 (2026-09-19)
                if not ctx.get("evidence_dir"):
                    return self._json(200, {"ok": False, "error": "증적 폴더가 설정되지 않았습니다"})
                try:
                    unit = int(body["unit"])
                except (KeyError, ValueError, TypeError):
                    return self._json(400, {"ok": False, "error": "unit 필요"})
                try:
                    ct = run_conntest(master, ctx, unit)
                    ev = evlib.build(master, ctx.get("store"), transport_info(master.t), ct, unit)
                    return self._json(200, {"ok": True, "package": evlib.write(ctx["evidence_dir"], ev)})
                except ValueError as e:
                    return self._json(200, {"ok": False, "error": str(e)})
                except Exception as e:
                    return self._json(200, {"ok": False, "error": f"증적 생성 실패: {e}"})
            if u.path == "/local/vendor-actuator":
                # NR 「1분 스냅샷」이 비표준 구동기 행 + 서버 보관 설정(retentionDays)을 매분 넘긴다 (2026-09-19 저장 정책 통일)
                store = ctx.get("store")
                if store is None:
                    return self._json(200, {"ok": False, "error": "로컬 저장소가 없습니다"})
                rows = body.get("rows") if isinstance(body.get("rows"), list) else []
                inserted = store.record_vendor(rows[:5000])
                days = store.set_retention(body["retentionDays"]) if body.get("retentionDays") is not None else store.retention // 86400
                return self._json(200, {"ok": True, "received": len(rows), "inserted": inserted, "retentionDays": days})
            if u.path == "/evidence/delete":
                if not ctx.get("evidence_dir"):
                    return self._json(200, {"ok": False, "error": "증적 폴더가 설정되지 않았습니다"})
                try:
                    evlib.delete(ctx["evidence_dir"], str(body.get("id") or ""))
                    return self._json(200, {"ok": True})
                except (ValueError, FileNotFoundError) as e:
                    return self._json(200, {"ok": False, "error": str(e)})
            if u.path == "/comm":
                if not ctx:
                    return self._json(200, {"ok": False, "error": "이 실행 방식은 통신 설정 변경을 지원하지 않습니다"})
                try:
                    cfg, err = commlib.validate_comm(body, ctx["list_ports"]())
                    if err:
                        return self._json(200, {"ok": False, "error": err, "current": transport_info(master.t)})
                    ok, _t = master.reconnect(lambda: ctx["build"](cfg))
                    if not ok:
                        return self._json(200, {"ok": False, "current": transport_info(master.t),
                                                "error": "새 설정으로 포트를 열지 못해 이전 설정을 그대로 유지합니다"})
                    commlib.save_comm(ctx["path"], cfg)
                    return self._json(200, {"ok": True, "current": transport_info(master.t), "nonStandard": cfg["nonStandard"]})
                except Exception as e:
                    return self._json(200, {"ok": False, "error": f"통신 설정 적용 실패: {e}", "current": transport_info(master.t)})
            return self._json(404, {"ok": False, "error": "not found"})
    return H


def serve(master, port=3002, host="127.0.0.1", comm_ctx=None):
    srv = ThreadingHTTPServer((host, port), make_handler(master, comm_ctx))
    th = threading.Thread(target=srv.serve_forever, daemon=True, name="ks3267-api")
    th.start()
    return srv
