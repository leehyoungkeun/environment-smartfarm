import json

flows = json.load(open("/home/lhk/.node-red/flows.json"))
print("=== config/update MQTT 구독 노드 ===")
for n in flows:
    if n.get("type") == "mqtt in" and "config/update" in (n.get("topic") or ""):
        print(f"  id={n.get('id')} topic={n.get('topic')} z={n.get('z','-')[:18]}")
        print(f"  wires={n.get('wires')}")

print("\n=== config/update 처리 함수 (houseConfig refresh 하는지) ===")
for n in flows:
    if n.get("type") != "function":
        continue
    code = n.get("func", "") or ""
    if ("houseConfig" in code or "config/farm" in code) and ("config/update" in code or n.get("z") == "tab_modules_sync" or n.get("z") == "config_sync_flow"):
        print(f"\n--- {n.get('name')} (id={n['id'][:18]}, z={n.get('z','-')[:18]}) ---")
        print(code[:600])
