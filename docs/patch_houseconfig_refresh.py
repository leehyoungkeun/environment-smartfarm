#!/usr/bin/env python3
"""RPi flows.json 의 'houseConfig 갱신' function 노드 코드를 v2 로 교체.
v2: 옛 modbus_cfg_* 캐시 자동 정리 로직 추가.

운영 영향:
- 함수 1개의 func 필드만 정확히 교체
- 다른 노드·flow·context 영향 0
- 양액 시뮬·자동화·제어 모두 그대로 동작
"""
import json, shutil, sys, os

FLOWS = "/home/lhk/.node-red/flows.json"
NEW_CODE = "/tmp/houseconfig_refresh_v2.js"

if not os.path.exists(NEW_CODE):
    print(f"❌ 새 코드 파일 없음: {NEW_CODE}")
    sys.exit(1)

with open(NEW_CODE) as f:
    new_code = f.read()

# 백업
backup = FLOWS + ".bak.hcrefresh"
shutil.copy(FLOWS, backup)
print(f"✓ flows.json 백업: {backup}")

flows = json.load(open(FLOWS))

target = None
for n in flows:
    if (n.get("type") == "function"
        and n.get("name") == "houseConfig 갱신"
        and n.get("z") == "tab_modules_sync"):
        target = n
        break

if not target:
    print("❌ 'houseConfig 갱신' 노드 (tab_modules_sync) 찾을 수 없음")
    sys.exit(1)

old_len = len(target.get("func", ""))
target["func"] = new_code
new_len = len(new_code)

json.dump(flows, open(FLOWS, "w"), ensure_ascii=False, indent=4)
print(f"✓ 함수 코드 교체 완료: {old_len} → {new_len}자")
print(f"  노드: {target.get('name')} (id={target.get('id')[:8]}...)")
print(f"  탭: tab_modules_sync (모듈 동기화)")
print()
print("다음 단계: pm2 restart node-red 또는 NR 에디터에서 Deploy")
