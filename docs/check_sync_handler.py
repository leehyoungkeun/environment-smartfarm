#!/usr/bin/env python3
"""RPi Node-RED config sync handler 진단"""
import json

f = json.load(open("/home/lhk/.node-red/flows.json"))

# 1. config/update 토픽 처리
print("=== MQTT in 노드 (config 관련) ===")
for n in f:
    if n.get("type") == "mqtt in":
        topic = n.get("topic", "") or ""
        if "config" in topic or "update" in topic:
            print(f"  topic: {topic}")
            print(f"  z: {n.get('z')}")
            print(f"  wires: {n.get('wires')}")
            print(f"  name: {n.get('name')}")
            print()

# 2. tab 정보
print("=== 모든 tab ===")
for n in f:
    if n.get("type") == "tab":
        print(f"  {n['id'][:12]}... = {n.get('label')}")

# 3. sync/config 관련 function 노드
print()
print("=== sync/config/module/house 관련 function 노드 ===")
keywords = ["sync", "config", "modbus_cfg", "module", "house", "device", "캐시"]
for n in f:
    if n.get("type") == "function":
        name = n.get("name", "")
        if any(k in name.lower() for k in keywords):
            code = n.get("func", "") or ""
            preview = (code[:80] if code else "").replace("\n", " ")
            print(f"  [{name}] z={n.get('z','')[:8]}... ({len(code)}자)")
            print(f"     preview: {preview}")

# 4. global.set('modbus_cfg_', ...) 또는 'houseConfig' set 하는 코드 찾기
print()
print("=== 'modbus_cfg_' 또는 'houseConfig' 다루는 function 노드 ===")
for n in f:
    if n.get("type") == "function":
        code = n.get("func", "") or ""
        if "modbus_cfg" in code or "houseConfig" in code:
            name = n.get("name", "")
            # 어떤 사용
            mc_set = "global.set('modbus_cfg" in code or 'global.set("modbus_cfg' in code
            hc_set = "global.set('houseConfig" in code or 'global.set("houseConfig' in code
            mc_get = "global.get('modbus_cfg" in code or 'global.get("modbus_cfg' in code
            hc_get = "global.get('houseConfig" in code or 'global.get("houseConfig' in code
            ops = []
            if mc_set: ops.append("modbus_cfg SET")
            if hc_set: ops.append("houseConfig SET")
            if mc_get: ops.append("modbus_cfg GET")
            if hc_get: ops.append("houseConfig GET")
            print(f"  [{name}] {' | '.join(ops)}")
