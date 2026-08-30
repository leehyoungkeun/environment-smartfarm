# -*- coding: utf-8 -*-
"""'KS X 3267 표준노드' 탭 가져오기 JSON 생성기 — fn_ks_*.js 를 함수 노드에 담아 ks3267-tab.json 을 만든다.

실행: python docs/ksx3267/nodered/gen_tab.py   → docs/ksx3267/nodered/ks3267-tab.json
NR 에디터: 메뉴 → 가져오기 → 파일 선택 → (새 플로우로) 가져오기 → Deploy

노드 id 는 고정(ks_*) — 하네스 테스트가 마스터 동기화 후 같은 id 로 잠근다.
탭 환경변수는 넣지 않는다 (탭 env 가 process.env 를 덮는 함정). 데몬 주소가 기본(127.0.0.1:3002)과
다를 때만 탭 설정에서 KS3267_API 를 추가한다.
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TAB = "ks3267_tab"


def fn(name):
    return io.open(os.path.join(HERE, name), encoding="utf-8").read()


def node(id_, type_, name, x, y, wires, **extra):
    n = {"id": id_, "type": type_, "z": TAB, "name": name, "x": x, "y": y, "wires": wires}
    n.update(extra)
    return n


nodes = [
    {"id": TAB, "type": "tab", "label": "KS X 3267 표준노드", "disabled": False,
     "info": "KS X 3267:2022 온실통합제어기 표준 노드 경로 (P3, 2026-08-30).\n"
             "ks3267d 데몬(127.0.0.1:3002)이 별도 RS485 포트의 표준 노드를 상대하고, 이 탭은 오케스트레이션만 한다.\n"
             "- 상태 수신: 데몬 → POST /api/ks3267/status → deviceStates/ks3267Readings\n"
             "- 명령: execute_control 3번 출력(link) → 표준 명령 조립 → 데몬 → 결과·이력\n"
             "- 프록시: GET /api/ks3267/:action (읽기 전용) → 데몬\n"
             "탭 env 를 넣지 말 것. Catch 는 이 탭 전용.", "env": []},

    # ── 상태 수신 ─────────────────────────────────────────────
    node("ks_http_status", "http in", "POST /api/ks3267/status", 140, 100, [["ks_fn_status"]],
         url="/api/ks3267/status", method="post", upload=False, swaggerDoc=""),
    node("ks_fn_status", "function", "표준 상태 반영", 380, 100, [["ks_http_status_res"]],
         func=fn("fn_ks_status.js"), outputs=1, timeout=0, noerr=0, initialize="", finalize="", libs=[]),
    node("ks_http_status_res", "http response", "", 600, 100, [], statusCode="", headers={}),

    # ── 명령 (execute_control 3번 출력 → link) ────────────────
    node("ks_link_in_cmd", "link in", "← execute_control 제어 (ks3267)", 120, 220, [["ks_fn_command"]], links=[]),
    node("ks_fn_command", "function", "표준 명령 조립", 340, 220, [["ks_http_command"]],
         func=fn("fn_ks_command.js"), outputs=1, timeout=0, noerr=0, initialize="", finalize="", libs=[]),
    node("ks_http_command", "http request", "데몬 /command", 560, 220, [["ks_fn_result"]],
         method="use", ret="obj", paytoqs="ignore", url="", tls="", persist=False, proxy="", insecureHTTPParser=False,
         authType="", senderr=False, headers=[]),
    node("ks_fn_result", "function", "표준 명령 결과", 780, 220, [["ks_http_log"], []],
         func=fn("fn_ks_result.js"), outputs=2, timeout=0, noerr=0, initialize="", finalize="", libs=[]),
    node("ks_http_log", "http request", "서버 제어이력", 1000, 220, [["ks_debug_log"]],
         method="use", ret="obj", paytoqs="ignore", url="", tls="", persist=False, proxy="", insecureHTTPParser=False,
         authType="", senderr=False, headers=[]),
    node("ks_debug_log", "debug", "이력 결과", 1200, 220, [], active=False, tosidebar=True, console=False,
         tostatus=False, complete="payload", targetType="msg", statusVal="", statusType="auto"),

    # ── 읽기 전용 프록시 ─────────────────────────────────────
    node("ks_http_proxy", "http in", "GET /api/ks3267/:action", 140, 340, [["ks_fn_proxy"]],
         url="/api/ks3267/:action", method="get", upload=False, swaggerDoc=""),
    node("ks_fn_proxy", "function", "데몬 프록시", 360, 340, [["ks_http_proxy_req"], ["ks_http_proxy_res"]],
         func=fn("fn_ks_proxy.js"), outputs=2, timeout=0, noerr=0, initialize="", finalize="", libs=[]),
    node("ks_http_proxy_req", "http request", "데몬 GET", 580, 320, [["ks_fn_proxy_resp"]],
         method="use", ret="obj", paytoqs="ignore", url="", tls="", persist=False, proxy="", insecureHTTPParser=False,
         authType="", senderr=False, headers=[]),   # senderr=True 는 "오류를 Catch 로" — 그러면 http 응답이 안 나가 매달린다 (2026-08-30 실측)
    node("ks_fn_proxy_resp", "function", "응답 정리", 780, 320, [["ks_http_proxy_res"]],
         func="// 데몬 응답을 그대로 돌려주되, 연결 실패는 502 로\n"
              "if (typeof msg.payload !== 'object' || msg.payload === null) {\n"
              "    msg.statusCode = 502;\n"
              "    msg.payload = { success: false, error: 'ks3267d 데몬 응답 없음 (pm2 ks3267d 확인)', detail: String(msg.payload).slice(0, 200) };\n"
              "} else {\n"
              "    msg.statusCode = msg.statusCode || 200;\n"
              "}\nreturn msg;",
         outputs=1, timeout=0, noerr=0, initialize="", finalize="", libs=[]),
    node("ks_http_proxy_res", "http response", "", 1000, 340, [], statusCode="", headers={}),

    # ── 예외 → GlitchTip (탭 전용 Catch — Catch 는 탭을 넘지 못한다) ──
    node("ks_catch", "catch", "탭 예외", 140, 460, [["ks_link_out_gt"]], scope=None, uncaught=False),
    node("ks_link_out_gt", "link out", "예외 →", 340, 460, [], mode="link", links=["gt_link_in"]),

    # ── 표준 구동기 1분 스냅샷 → 서버 actuator_status (116 검정: 1분 저장·조회·추출·손실률) ──
    node("ks_inject_snapshot", "inject", "매 60초", 140, 580, [["ks_fn_snapshot"]],
         props=[{"p": "payload"}], repeat="60", crontab="", once=True, onceDelay=15, topic="", payload="", payloadType="date"),
    node("ks_fn_snapshot", "function", "표준 구동기 1분 스냅샷", 380, 580, [["ks_http_snapshot"]],
         func=fn("fn_ks_snapshot.js"), outputs=1, timeout=0, noerr=0, initialize="", finalize="", libs=[]),
    node("ks_http_snapshot", "http request", "서버 actuator-status", 620, 580, [["ks_fn_snapshot_result"]],
         method="use", ret="obj", paytoqs="ignore", url="", tls="", persist=False, proxy="", insecureHTTPParser=False,
         authType="", senderr=False, headers=[]),
    node("ks_fn_snapshot_result", "function", "스냅샷 전송 결과", 860, 580, [[]],
         func=fn("fn_ks_snapshot_result.js"), outputs=1, timeout=0, noerr=0, initialize="", finalize="", libs=[]),

    node("ks_comment", "comment", "적용 순서 (docs/ksx3267/nodered/README.md)", 140, 40, [],
         info="1) 이 탭 가져오기 → 2) AWS 제어 수신 탭 execute_control 교체(출력 3) + link out → 이 탭 '← execute_control 제어' 연결\n"
              "3) 센서 수집 탭 ③ 교체 → 4) Deploy → 5) pm2 ks3267d --nr-url http://127.0.0.1:1880/api/ks3267/status"),
]

out = os.path.join(HERE, "ks3267-tab.json")
io.open(out, "w", encoding="utf-8").write(json.dumps(nodes, ensure_ascii=False, indent=1))
print("wrote", out, "nodes:", len(nodes))

# 이미 탭을 가져온 농장용: 스냅샷 4노드만 (에디터에서 「KS X 3267 표준노드」 탭을 연 상태로 가져오기 → 현재 탭에 들어간다)
SNAP = {"ks_inject_snapshot", "ks_fn_snapshot", "ks_http_snapshot", "ks_fn_snapshot_result"}
snap = [n for n in nodes if n["id"] in SNAP]
out2 = os.path.join(HERE, "ks3267-snapshot-nodes.json")
io.open(out2, "w", encoding="utf-8").write(json.dumps(snap, ensure_ascii=False, indent=1))
print("wrote", out2, "nodes:", len(snap))
