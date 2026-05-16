#!/usr/bin/env python3
"""RPi flows.json 점검 — 양액 자동제어 탭 상태"""
import json, sys
f = json.load(open("/home/lhk/.node-red/flows.json"))
tabs = [n for n in f if n.get("type")=="tab" and "양액" in n.get("label","")]
if not tabs:
    print("NO 양액 TAB")
    sys.exit()
tab_id = tabs[0]["id"]
print(f"TAB {tabs[0]['label']} id={tab_id}")
nodes = [n for n in f if n.get("z")==tab_id]
print(f"총 노드: {len(nodes)}")
print()
print("=== function 노드 ===")
for fn in [n for n in nodes if n.get("type")=="function"]:
    code = fn.get("func","") or ""
    name = fn.get("name","")
    preview = code[:60].replace("\n", " ")
    print(f"  [{name}] code={len(code)}자  preview={preview!r}")
print()
print("=== inject 노드 ===")
for ij in [n for n in nodes if n.get("type")=="inject"]:
    name = ij.get("name","")
    repeat = ij.get("repeat","")
    payload = ij.get("payload","")
    ptype = ij.get("payloadType","")
    wires = ij.get("wires",[])
    print(f"  [{name}] repeat={repeat!r} payload={payload!r} type={ptype} wires={wires}")
print()
print("=== http request / modbus ===")
for n in nodes:
    if n.get("type") in ["http request", "modbus-flex-write"]:
        print(f"  [{n.get('type')}] name={n.get('name')!r} server={n.get('server','')} wires={n.get('wires')}")
