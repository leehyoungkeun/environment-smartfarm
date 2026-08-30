# -*- coding: utf-8 -*-
"""로컬 REST — 127.0.0.1 전용 (NR 오케스트레이터·백엔드 프록시가 부른다). 표준 라이브러리만.

GET  /health
GET  /discover?unit=N        탐색 후 등록 (탐색 결과 반환)
GET  /nodes                  등록된 노드 서술자
GET  /status[?unit=N]        마지막 폴링 상태
POST /command  {unit, kind, n, op, seconds}
GET  /frames[?n=50]          최근 TX/RX hex (진단·시험 증적)
GET  /events[?n=50]
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from transport import ModbusExc, TransportTimeout


def make_handler(master):
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
                if u.path == "/nodes":
                    return self._json(200, {"ok": True, "nodes": master.nodes})
                if u.path == "/status":
                    if "unit" in q:
                        return self._json(200, {"ok": True, "state": master.state.get(int(q["unit"][0]))})
                    return self._json(200, {"ok": True, "state": master.state})
                if u.path == "/frames":
                    n = int(q.get("n", ["50"])[0])
                    return self._json(200, {"ok": True, "frames": master.t.frames.recent(n),
                                            "stats": master.t.frames.stats})
                if u.path == "/events":
                    n = int(q.get("n", ["50"])[0])
                    return self._json(200, {"ok": True, "events": master.events[-n:]})
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
                    r = master.command(int(body["unit"]), body["kind"], int(body["n"]), body["op"],
                                       seconds=int(body.get("seconds", 0) or 0))
                    return self._json(200, r)
                except (KeyError, ValueError, TypeError) as e:
                    return self._json(400, {"ok": False, "error": f"bad request: {e}"})
            if u.path == "/discover":
                try:
                    return self._json(200, {"ok": True, "node": master.discover(int(body["unit"]))})
                except (ModbusExc, TransportTimeout) as e:
                    return self._json(200, {"ok": False, "error": str(e)})
            return self._json(404, {"ok": False, "error": "not found"})
    return H


def serve(master, port=3002, host="127.0.0.1"):
    srv = ThreadingHTTPServer((host, port), make_handler(master))
    th = threading.Thread(target=srv.serve_forever, daemon=True, name="ks3267-api")
    th.start()
    return srv
