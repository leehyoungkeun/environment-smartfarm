import json

g = json.load(open("/home/lhk/.node-red/context/global/global.json"))
hc = g.get("houseConfig", {})
houses = hc.get("houses", [])

print("=== 모든 house 의 devices (워치독 source) ===")
for h in houses:
    devices = h.get("devices", []) or []
    if devices:
        print(f"\nhouse {h.get('id')}:")
        for d in devices:
            mb = d.get("modbus") or {}
            print(f"  device {d.get('deviceId')}: type={d.get('deviceType')} modbus={mb}")

print("\n=== global._watchdogModules ===")
print(json.dumps(g.get("_watchdogModules", "(없음)"), ensure_ascii=False, indent=2)[:500])

print("\n=== global.relayModules (등록된 모듈) ===")
print(json.dumps(g.get("relayModules", []), ensure_ascii=False, indent=2))
