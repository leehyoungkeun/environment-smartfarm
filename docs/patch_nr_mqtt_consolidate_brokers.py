#!/usr/bin/env python3
"""Consolidate all mqtt-in nodes to Primary broker (mqtt_broker_aws).
Removes Secondary broker (mqtt_broker_aws_sec) entirely since chunked SUBSCRIBE patch makes it unnecessary."""
import json, sys

PATH = "/home/lhk/.node-red/flows.json"
PRIMARY_ID = "mqtt_broker_aws"
SECONDARY_ID = "mqtt_broker_aws_sec"

with open(PATH) as f:
    flows = json.load(f)

# Count before
mqtt_in = [n for n in flows if n.get('type') == 'mqtt in']
sec_count_before = sum(1 for n in mqtt_in if n.get('broker') == SECONDARY_ID)
print(f"Before: {len(mqtt_in)} mqtt-in total, {sec_count_before} on Secondary")

# Migrate all Secondary refs → Primary
migrated = 0
for n in flows:
    if n.get('type') in ('mqtt in', 'mqtt out') and n.get('broker') == SECONDARY_ID:
        n['broker'] = PRIMARY_ID
        migrated += 1
print(f"Migrated {migrated} nodes to Primary")

# Remove Secondary broker config
before = len(flows)
flows = [n for n in flows if not (n.get('type') == 'mqtt-broker' and n.get('id') == SECONDARY_ID)]
removed = before - len(flows)
print(f"Removed {removed} broker config (Secondary)")

# Verify
mqtt_in_after = [n for n in flows if n.get('type') == 'mqtt in']
pri_count = sum(1 for n in mqtt_in_after if n.get('broker') == PRIMARY_ID)
orphan = sum(1 for n in mqtt_in_after if n.get('broker') != PRIMARY_ID)
print(f"After: {len(mqtt_in_after)} mqtt-in total, {pri_count} on Primary, {orphan} orphan")

if orphan > 0:
    print("ERROR: orphan mqtt-in nodes still exist", file=sys.stderr)
    for n in mqtt_in_after:
        if n.get('broker') != PRIMARY_ID:
            print(f"  orphan: {n.get('topic')} broker={n.get('broker')}", file=sys.stderr)
    sys.exit(1)

with open(PATH, 'w') as f:
    json.dump(flows, f, indent=4)
print("OK — flows.json saved")
