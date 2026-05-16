#!/usr/bin/env python3
"""telemetry publisher function 노드 func 필드 교체"""
import json, shutil, sys

FLOWS = "/home/lhk/.node-red/flows.json"
NEW = "/tmp/telemetry_new.js"

new_code = open(NEW).read()
shutil.copy(FLOWS, FLOWS + ".bak.telemetry")
flows = json.load(open(FLOWS))

target = None
for n in flows:
    if n.get("type") == "function" and n.get("name") == "telemetry publisher":
        target = n
        break

if not target:
    print("telemetry publisher 노드 못 찾음")
    sys.exit(1)

old_len = len(target.get("func", ""))
target["func"] = new_code
json.dump(flows, open(FLOWS, "w"), ensure_ascii=False, indent=4)
print(f"OK: telemetry publisher func 교체 ({old_len} → {len(new_code)}자)")
