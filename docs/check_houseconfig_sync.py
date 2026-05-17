#!/usr/bin/env python3
"""RPi houseConfig + modbus_cfg_* 캐시 상태 확인"""
import json, time

g = json.load(open("/home/lhk/.node-red/context/global/global.json"))

print("=== global.houseConfig ===")
hc = g.get("houseConfig") or {}
print(f"  farmId:        {hc.get('farmId')}")
print(f"  houseId:       {hc.get('houseId')}")
print(f"  configVersion: {hc.get('configVersion')}")
print(f"  device count:  {len(hc.get('devices', []))}")
for d in hc.get("devices", []):
    m = d.get("modbus") or {}
    print(f"  - {d.get('deviceId'):20s} ({d.get('name','')})")
    print(f"      unit={m.get('unitId')}, addr={m.get('address')}, addr2={m.get('address2')}, ctrl={m.get('controlType')}")

print()
print("=== global.modbus_cfg_* (개별 캐시) ===")
modbus_keys = sorted([k for k in g.keys() if k.startswith('modbus_cfg_')])
for k in modbus_keys:
    v = g[k]
    if isinstance(v, dict):
        print(f"  {k:30s} unit={v.get('unitId')}, addr={v.get('address')}, addr2={v.get('address2')}, ctrl={v.get('controlType')}")

print()
print("=== houseConfigUpdatedAt ===")
ts = g.get("houseConfigUpdatedAt")
print(f"  raw: {ts}")
if ts:
    try:
        if isinstance(ts, str):
            import datetime
            dt = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            age = (datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds()
            print(f"  age: {age:.0f}초 전")
        elif isinstance(ts, (int, float)):
            age = time.time() - ts/1000 if ts > 1e12 else time.time() - ts
            print(f"  age: {age:.0f}초 전")
    except Exception as e:
        print(f"  parse error: {e}")

print()
print("=== 자동화 규칙 ===")
rules = g.get("automationRules", [])
print(f"  count: {len(rules) if isinstance(rules, list) else 'N/A'}")
upd = g.get("automationRulesUpdatedAt")
print(f"  updated: {upd}")
