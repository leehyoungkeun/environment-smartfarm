#!/usr/bin/env python3
"""양액 자동제어 탭의 6개 function 노드 코드를 새 파일들로 일괄 교체.
+ inject_setup, fn_setup (사이트 키 설정) 노드 제거 — global.sensorApiKey 사용
+ global.json에 sensorApiKey 등록"""
import json, shutil, os, sys

FLOWS = "/home/lhk/.node-red/flows.json"
GLOBAL = "/home/lhk/.node-red/context/global/global.json"
NEW_DIR = "/tmp/nutrient"
SENSOR_API_KEY = sys.argv[1] if len(sys.argv) > 1 else "smartfarm-sensor-key"

# 노드명 → /tmp/ 안의 파일 매핑
mapping = {
    "양액 시뮬레이터":     "nodered-nutrient-simulator.js",
    "안전 인터락":          "nodered-nutrient-safety-interlock.js",
    "telemetry publisher": "nodered-nutrient-telemetry-publisher.js",
    "트리거 평가":          "nodered-nutrient-trigger-evaluator.js",
    "1회 관수 사이클":      "nodered-nutrient-cycle-runner.js",
    "config fetcher":      "nodered-nutrient-config-fetcher.js",
}

# 1. flows.json 백업
shutil.copy(FLOWS, FLOWS + ".bak.all_funcs")
flows = json.load(open(FLOWS))

# 2. function 노드 func 일괄 교체
patched = []
for n in flows:
    if n.get("type") == "function" and n.get("name") in mapping:
        fname = os.path.join(NEW_DIR, mapping[n["name"]])
        if not os.path.exists(fname):
            print(f"missing: {fname}")
            continue
        new = open(fname).read()
        old_len = len(n.get("func", ""))
        n["func"] = new
        patched.append(f"  [{n['name']}] {old_len} → {len(new)}자")

# 3. inject_setup 과 farmConfig 저장 fn 노드 제거 (있다면)
removed = []
keep = []
for n in flows:
    name = n.get("name", "")
    if name == "🔧 사이트 키 설정 (1회)" or name == "farmConfig 저장":
        removed.append(name)
        continue
    keep.append(n)
flows = keep

json.dump(flows, open(FLOWS, "w"), ensure_ascii=False, indent=4)

# 4. global.json — sensorApiKey + FARM_ID 등록, 양액 placeholder 제거
shutil.copy(GLOBAL, GLOBAL + ".bak.cleanup")
g = json.load(open(GLOBAL))
g["sensorApiKey"] = SENSOR_API_KEY
g["FARM_ID"] = "farm_0001"
# 양액 placeholder farmConfig 제거 (기존 패턴엔 불필요)
g.pop("farmConfig", None)
json.dump(g, open(GLOBAL, "w"), ensure_ascii=False, indent=2)

print("✓ patched:")
for p in patched: print(p)
print(f"✓ removed setup nodes: {removed}")
print(f"✓ global.sensorApiKey = {SENSOR_API_KEY[:8]}...")
print(f"✓ global.FARM_ID = farm_0001")
print(f"✓ global.farmConfig 제거")
