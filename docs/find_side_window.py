import json

g = json.load(open("/home/lhk/.node-red/context/global/global.json"))
hc = g.get("houseConfig", {})
for h in hc.get("houses", []):
    for d in h.get("devices", []) or []:
        mb = d.get("modbus") or {}
        if mb.get("unitId") == 1:
            print(f"옛 device 발견:")
            print(f"  house: {h.get('houseId') or h.get('id')}")
            print(f"  deviceId: {d.get('deviceId')}")
            print(f"  modbus: {mb}")
