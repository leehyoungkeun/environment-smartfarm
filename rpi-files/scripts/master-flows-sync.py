# -*- coding: utf-8 -*-
"""1호 flows.json -> 마스터 사본 동기화 (2026-08-29).

1호의 flows.json 은 wrapper.sh 가 `${FARM_ID}` 를 `farm_0001` 로 치환한 상태다(편도).
그대로 마스터에 넣으면 **모든 신규 농장이 farm_0001 토픽을 구독한다** — 제어 오작동(치명).
따라서 mqtt in 노드의 `topic` 필드만 역치환하고, 함수 코드 안의 `|| 'farm_0001'` 폴백은 건드리지 않는다.

사용: python master_sync.py <live_flows.json> <master_flows.json> [--write]
"""
import io, json, re, sys

live_p, master_p = sys.argv[1], sys.argv[2]
write = "--write" in sys.argv

raw = io.open(live_p, encoding="utf-8").read()
fl = json.loads(raw)
tabs = {n["id"]: n.get("label") for n in fl if n.get("type") == "tab"}

topic_hits, other_hits, code_lines = [], [], 0
for n in fl:
    t = n.get("type")
    if t == "mqtt in" and "farm_0001" in (n.get("topic") or ""):
        topic_hits.append((tabs.get(n.get("z")), n.get("name"), n["topic"]))
    if t == "function":
        code_lines += sum(1 for l in n.get("func", "").splitlines() if "farm_0001" in l)
    for k, v in n.items():
        if k not in ("topic", "func") and isinstance(v, str) and "farm_0001" in v:
            other_hits.append((t, n.get("name"), k, v[:60]))

print("[live] mqtt in topic  : %d" % len(topic_hits))
print("[live] function code  : %d lines (fallback - keep)" % code_lines)
print("[live] other props    : %d" % len(other_hits))
for o in other_hits:
    print("   other: type=%s name=%s key=%s val=%s" % o)
print("[live] total farm_0001: %d" % raw.count("farm_0001"))

# 역치환: mqtt in 의 topic 필드에서만
converted = 0
for n in fl:
    if n.get("type") == "mqtt in" and "farm_0001" in (n.get("topic") or ""):
        n["topic"] = n["topic"].replace("farm_0001", "${FARM_ID}")
        converted += 1

out = json.dumps(fl, ensure_ascii=False, indent=4)
print("[out ] topic converted : %d" % converted)
print("[out ] ${FARM_ID} count: %d" % out.count("${FARM_ID}"))
print("[out ] farm_0001 left  : %d (fallback only)" % out.count("farm_0001"))

# 안전 검증
errs = []
if converted != len(topic_hits):
    errs.append("converted != topic hits")
if out.count('"topic": "smartfarm/farm_0001') != 0:
    errs.append("topic with farm_0001 remains")
if json.loads(out) != fl:
    errs.append("json roundtrip mismatch")
node_n = len(fl)
if node_n < 400:
    errs.append("node count too small: %d" % node_n)
print("[out ] nodes           : %d" % node_n)
print("[chk ] %s" % ("OK" if not errs else "FAIL: " + "; ".join(errs)))

if write and not errs:
    io.open(master_p, "w", encoding="utf-8", newline="\n").write(out + "\n")
    print("[write] master updated: %s" % master_p)
elif write:
    print("[write] skipped due to check failure")
