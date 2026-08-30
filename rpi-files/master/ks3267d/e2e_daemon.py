# -*- coding: utf-8 -*-
"""데몬 E2E — 시뮬레이터(TCP) 상대로 REST API 경유 표준 절차 왕복. P6 자가시험의 뼈대.

  python tools/ks3267-sim/sim.py --tcp 5020 --unit 1 --type actuator &
  python tools/ks3267-sim/sim.py --tcp 5021 --unit 2 --type sensor &
  python rpi-files/master/ks3267d/ks3267d.py --tcp 127.0.0.1:5020 --units 1 --api-port 3122 --poll 1 &
  python rpi-files/master/ks3267d/ks3267d.py --tcp 127.0.0.1:5021 --units 2 --api-port 3123 --poll 1 &
  python rpi-files/master/ks3267d/e2e_daemon.py --act 3122 --sen 3123

주의(Windows): 준비 확인은 raw socket connect+close 가 아니라 모드버스 요청으로 한다 —
즉시 close 되는 접속이 pymodbus 서버의 accept 를 깨뜨린다.
"""
import argparse
import json
import sys
import time
import urllib.request

ok = True


def check(c, m):
    global ok
    print(("  OK  " if c else "  FAIL") + " " + m)
    ok = ok and c


def get(port, path):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5))


def post(port, path, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=8))


def run(A, S):
    for _ in range(40):
        try:
            get(A, "/health"); get(S, "/health"); break
        except Exception:
            time.sleep(0.3)
    else:
        raise SystemExit("daemon not up")
    time.sleep(2.5)  # first poll
    print("== actuator daemon ==")
    h = get(A, "/health"); check(h["ok"] and h["nodes"] == [1], f"health nodes={h['nodes']}")
    n = get(A, "/nodes")["nodes"]["1"]
    check(n["supported"] and n["kind"] == "actuator" and len(n["devices"]) == 24, "discovered actuator, 24 devices")
    r = post(A, "/command", {"unit": 1, "kind": "switch", "n": 1, "op": "timed_on", "seconds": 4})
    check(r["ok"] and r["accepted"] and r["status_name"] == "ON" and r["remain"] in (3, 4),
          f"TIMED_ON 4s -> {r.get('status_name')} remain={r.get('remain')} opid={r.get('opid')}")
    time.sleep(1.5)
    d1 = get(A, "/status?unit=1")["state"]["devices"]["1"]
    check(d1["status_name"] == "ON" and 0 < d1["remain"] <= 3, f"poll ON remain={d1['remain']}")
    time.sleep(4)
    d1 = get(A, "/status?unit=1")["state"]["devices"]["1"]
    check(d1["status_name"] == "READY" and d1["opid"] == 0, f"after expiry -> {d1['status_name']}")
    r = post(A, "/command", {"unit": 1, "kind": "opener", "n": 2, "op": "open"})
    check(r["ok"] and r["status_name"] == "OPENING" and r["remain"] in (29, 30), f"OPEN -> {r.get('status_name')} remain={r.get('remain')}")
    r2 = post(A, "/command", {"unit": 1, "kind": "opener", "n": 2, "op": "stop"})
    check(r2["ok"] and r2["status_name"] == "READY" and r2["opid"] == r["opid"] + 1, "STOP -> READY, opid+1")
    r = post(A, "/command", {"unit": 1, "kind": "opener", "n": 2, "op": "set_position"})
    check(not r["ok"] and "미지원" in r["error"], "level-2 rejected locally (no bus traffic)")
    r = post(A, "/command", {"unit": 1, "kind": "switch", "n": 1, "op": "timed_on", "seconds": 0})
    check(not r["ok"], "timed_on without seconds rejected")
    f = get(A, "/frames?n=6")["frames"]
    check(len(f) >= 4, f"frames: {f[-2]['dir']} {f[-2]['hex'][:36]} / {f[-1]['dir']} {f[-1]['hex'][:36]}")
    check(any(e["kind"] == "command" for e in get(A, "/events")["events"]), "events recorded")
    r = get(A, "/discover?unit=7")
    # RTU 실선: 무응답 → timeout. TCP 시뮬: 서버가 미등록 id 에 예외응답. 둘 다 '숨기지 않고 실패 보고' 가 요건.
    check(not r["ok"] and ("timeout" in r["error"] or "exception" in r["error"]), f"discover unknown unit -> reported: {r['error'][:60]}")
    print("== sensor daemon ==")
    st = get(S, "/status?unit=2")["state"]
    check(st["kind"] == "sensor" and abs(st["sensors"]["3"]["value"] - 28.8) < 1e-3, f"sensor3 = {st['sensors']['3']['value']} (CDAB)")
    check(abs(st["sensors"]["4"]["value"] - 60.0) < 1e-3 and st["sensors"]["1"]["status_name"] == "READY", "humidity 60.0, READY")
    print("\nRESULT:", "ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("--act", type=int, default=3122); p.add_argument("--sen", type=int, default=3123)
    a = p.parse_args(); sys.exit(0 if run(a.act, a.sen) else 1)
