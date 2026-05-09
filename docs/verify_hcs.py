import json

flows = json.load(open("/home/lhk/.node-red/flows.json"))
print("=== hcs_* 노드 ===")
for n in flows:
    if (n.get("id") or "").startswith("hcs_"):
        ntype = n.get("type", "")
        nid = n.get("id", "")
        nname = n.get("name", "")
        wires = n.get("wires", [])
        print(f"  {ntype:14s} {nid:14s} {nname}")
        for i, w in enumerate(wires):
            if w:
                print(f"    out[{i}] → {w}")

print("\n=== global.houseConfig ===")
d = json.load(open("/home/lhk/.node-red/context/global/global.json"))
hc = d.get("houseConfig", {})
houses = hc.get("houses", [])
print(f"  houses: {len(houses)}")
print(f"  configVersion: {hc.get('configVersion')}")
print(f"  updatedAt: {d.get('houseConfigUpdatedAt', '-')}")
if houses:
    h = houses[0]
    print(f"  first: id={h.get('id')} sensors={len(h.get('sensors', []))} devices={len(h.get('devices', []))}")
