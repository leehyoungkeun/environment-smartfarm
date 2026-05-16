#!/usr/bin/env python3
"""양액 탭 wire 연결 + HTTP request 노드 상세 점검"""
import json
f = json.load(open("/home/lhk/.node-red/flows.json"))
tabs = [n for n in f if n.get("type")=="tab" and "양액" in n.get("label","")]
tab_id = tabs[0]["id"]
nodes = [n for n in f if n.get("z")==tab_id]
by_id = {n["id"]: n for n in nodes}

def name_of(nid):
    n = by_id.get(nid)
    if n:
        return f"{n.get('type')}[{n.get('name','')}]"
    return f"???({nid})"

print("=== 전체 wire 흐름 ===")
for n in nodes:
    if not n.get("wires"):
        continue
    wires = n.get("wires", [])
    outs = []
    for out_i, w_list in enumerate(wires):
        if w_list:
            targets = [name_of(t) for t in w_list]
            outs.append(f"  out{out_i}: {targets}")
    if outs:
        print(f"\n{n.get('type')}[{n.get('name','')}] →")
        for o in outs:
            print(o)

print("\n=== HTTP request 노드 상세 ===")
for n in nodes:
    if n.get("type") != "http request":
        continue
    print(f"\n[{n.get('name')}]")
    print(f"  method: {n.get('method')}")
    print(f"  ret: {n.get('ret')}")
    print(f"  url: {n.get('url')!r}")
    print(f"  tls: {n.get('tls')}")
    print(f"  authType: {n.get('authType')}")
    print(f"  proxy: {n.get('proxy')}")
