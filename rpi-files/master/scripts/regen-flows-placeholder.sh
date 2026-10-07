#!/bin/bash
# 현재 flows.json 에서 마스터 이미지용 placeholder 원본을 생성한다.
#
# 왜 필요한가:
#   wrapper.sh 가 NR 시작 시 flows.json 의 ${FARM_ID} 를 실제 농장ID로 sed 치환한다(편도).
#   따라서 에디터에서 플로우를 고치고 재시작하면 placeholder 가 소비되어 사라진다.
#   이미지를 뜨기 전에 이 스크립트로 원본을 다시 만들어야 한다.
#
# 안전장치:
#   mqtt-in 노드의 topic 필드만 되돌린다.
#   함수 코드의 `|| farm_0001` fallback 은 정상 패턴이므로 건드리지 않는다.
set -e
SRC=/home/lhk/.node-red/flows.json
OUT=/home/lhk/smartfarm/master-template/flows.json.placeholder
FARM_ID=$(tr -d [:space:] < /home/lhk/smartfarm/.farm-id)

[ -n "$FARM_ID" ] || { echo "❌ .farm-id 를 읽을 수 없다"; exit 1; }
mkdir -p "$(dirname "$OUT")"

python3 - "$SRC" "$OUT" "$FARM_ID" <<"PY"
import json, sys
src, out, farm = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(src, encoding="utf-8"))
n = 0
for node in d:
    if node.get("type") == "mqtt in":
        t = node.get("topic") or ""
        if farm in t:
            node["topic"] = t.replace(farm, "${FARM_ID}")
            n += 1
json.dump(d, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=4)
print(f"  mqtt-in 토픽 {n} 개를 ${{FARM_ID}} 로 되돌림")
PY

CNT=$(grep -o "\${FARM_ID}" "$OUT" | wc -l)
echo "✅ 생성: $OUT  (placeholder ${CNT} 개)"
[ "$CNT" -gt 0 ] || { echo "⚠️ placeholder 가 0 개다 — 확인 필요"; exit 1; }
