#!/usr/bin/env python3
"""양액 자동제어 탭의 '안전 인터락' function 노드 코드만 새 파일로 교체.
flows.json 백업 후 해당 노드의 func 필드만 정확히 변경."""
import json, sys, shutil, os

FLOWS = "/home/lhk/.node-red/flows.json"
NEW_CODE = "/tmp/safety_new.js"

if not os.path.exists(NEW_CODE):
    print(f"new code file missing: {NEW_CODE}")
    sys.exit(1)

with open(NEW_CODE) as f:
    new_code = f.read()

shutil.copy(FLOWS, FLOWS + ".bak.safety_patch")
flows = json.load(open(FLOWS))

target = None
for n in flows:
    if n.get("type") == "function" and n.get("name") == "안전 인터락":
        target = n
        break

if not target:
    print("안전 인터락 노드 못 찾음")
    sys.exit(1)

old_len = len(target.get("func", ""))
target["func"] = new_code
new_len = len(new_code)

json.dump(flows, open(FLOWS, "w"), ensure_ascii=False, indent=4)
print(f"OK: 안전 인터락 func 교체 ({old_len} → {new_len}자)")
