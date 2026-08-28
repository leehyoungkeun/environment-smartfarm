# -*- coding: utf-8 -*-
"""Node-RED flows.json 완결성 감사 (읽기 전용).

끊긴 선·고아 노드·짝 없는 link·탭별 Catch·HTTP in↔response·금지 패턴(FC5, modbus-client 다중,
${FARM_ID} 템플릿)·중복 mqtt 구독·하드코딩을 검사한다. flows.json 을 바꾸지 않는다 — 수정은 에디터에서.

실행 (RPi):  python3 nr-audit.py [/home/lhk/.node-red/flows.json]
결과 예시:   docs/nodered-audit-2026-08-28.md
"""
import json, re, sys, collections
fl = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/home/lhk/.node-red/flows.json"))
byid = {n["id"]: n for n in fl}
tabs = {n["id"]: n for n in fl if n["type"] == "tab"}
subflows = {n["id"]: n for n in fl if n["type"] == "subflow"}
nodes = [n for n in fl if n["type"] not in ("tab", "subflow", "group")]
CONFIG_TYPES = {"mqtt-broker", "modbus-client", "serial-port", "ui_tab", "ui_group", "ui_base", "tls-config", "http proxy", "websocket-listener", "websocket-client", "sqlitedb", "postgresql-config", "e-mail", "telegram bot", "ui_spacer"}
def is_config(n): return "z" not in n or n.get("z") == "" or n["type"] in CONFIG_TYPES
flow_nodes = [n for n in nodes if not is_config(n) and n.get("z") in tabs]
cfg_nodes = [n for n in nodes if is_config(n)]
tabname = lambda z: tabs.get(z, {}).get("label", "?")

print("== 개요 ==")
print("  탭 %d (비활성 %d) · 흐름 노드 %d · 설정 노드 %d · 서브플로 %d" % (
    len(tabs), sum(1 for t in tabs.values() if t.get("disabled")), len(flow_nodes), len(cfg_nodes), len(subflows)))
per_tab = collections.Counter(n["z"] for n in flow_nodes)
for z, t in tabs.items():
    print("   %-32s %3d노드%s" % (t["label"][:32], per_tab[z], "  [비활성]" if t.get("disabled") else ""))

# 입력/출력 연결 맵
incoming = collections.Counter()
for n in flow_nodes:
    for port in n.get("wires", []):
        for tgt in port: incoming[tgt] += 1
outgoing = {n["id"]: sum(len(p) for p in n.get("wires", [])) for n in flow_nodes}

print("\n== 1. 끊긴 선 (존재하지 않는 노드로 향함) ==")
bad = [(n, tgt) for n in flow_nodes for port in n.get("wires", []) for tgt in port if tgt not in byid]
for n, tgt in bad: print("   [%s] %s(%s) → %s 없음" % (tabname(n["z"]), n.get("name") or n["type"], n["id"], tgt))
print("   없음" if not bad else "   %d건" % len(bad))

SOURCE_TYPES = {"inject", "mqtt in", "http in", "modbus-read", "modbus-flex-getter", "link in", "catch", "status", "complete", "serial in", "websocket in", "tcp in", "udp in", "cron-plus", "ui_button", "ui_switch", "ui_slider", "ui_text_input", "ui_dropdown", "ui_form", "ui_numeric", "exec", "watch", "file in", "tail", "rbe", "trigger", "http request"}
SINK_TYPES = {"debug", "http response", "mqtt out", "link out", "modbus-write", "modbus-flex-write", "file", "ui_text", "ui_gauge", "ui_chart", "ui_toast", "ui_led", "ui_table", "ui_template", "exec", "serial out", "tcp out", "udp out", "e-mail", "telegram sender", "comment", "link call", "status"}
print("\n== 2. 고아 노드 (입력도 출력도 없음, 소스/싱크 제외) ==")
orph = [n for n in flow_nodes if incoming[n["id"]] == 0 and outgoing[n["id"]] == 0 and n["type"] not in SOURCE_TYPES | SINK_TYPES and not n["type"].startswith("ui_")]
for n in orph: print("   [%s] %s: %s" % (tabname(n["z"]), n["type"], n.get("name") or n["id"]))
print("   없음" if not orph else "   %d건" % len(orph))

print("\n== 3. 입력 없는 처리 노드 (아무도 안 부름) ==")
dead = [n for n in flow_nodes if incoming[n["id"]] == 0 and n["type"] not in SOURCE_TYPES and not n["type"].startswith("ui_") and n["type"] not in ("comment", "link out", "junction") and not (n["type"] == "debug")]
for n in dead: print("   [%s] %s: %s" % (tabname(n["z"]), n["type"], n.get("name") or n["id"]))
print("   없음" if not dead else "   %d건" % len(dead))

print("\n== 4. 출력이 끊긴 처리 노드 (결과가 어디로도 안 감) ==")
dang = [n for n in flow_nodes if outgoing[n["id"]] == 0 and n["type"] in ("function", "switch", "change", "json", "template", "split", "join", "delay", "modbus-flex-getter", "http request", "link in") and (n.get("outputs", 1) or 1) > 0]
for n in dang: print("   [%s] %s: %s" % (tabname(n["z"]), n["type"], n.get("name") or n["id"]))
print("   없음" if not dang else "   %d건" % len(dang))

print("\n== 5. link out ↔ link in 짝 ==")
lin = {n["id"]: n for n in flow_nodes if n["type"] == "link in"}
lout = [n for n in flow_nodes if n["type"] in ("link out", "link call")]
for n in lout:
    for t in n.get("links", []):
        if t not in lin: print("   [%s] link out '%s' → 없는 link in %s" % (tabname(n["z"]), n.get("name") or n["id"], t))
targeted = {t for n in lout for t in n.get("links", [])}
for i, n in lin.items():
    if i not in targeted and not n.get("links"): print("   [%s] link in '%s' 를 부르는 link out 없음" % (tabname(n["z"]), n.get("name") or i))
print("   (이상 없으면 위에 출력 없음)")

print("\n== 6. 탭별 Catch / Status 커버리지 ==")
for z, t in tabs.items():
    if t.get("disabled"): continue
    c = [n for n in flow_nodes if n["z"] == z and n["type"] == "catch"]
    scope = "전체" if c and (not c[0].get("scope") or c[0].get("uncaught")) else ("일부 노드" if c else "—")
    has_fn = any(n["z"] == z and n["type"] in ("function", "http request", "modbus-flex-getter", "modbus-flex-write") for n in flow_nodes)
    print("   %-32s catch %s%s" % (t["label"][:32], scope, "" if c or not has_fn else "   ⚠ 함수/IO 있는데 Catch 없음"))

print("\n== 7. HTTP in ↔ http response ==")
def reaches(start, want_type, limit=60):
    seen, q = set(), [start]
    while q and len(seen) < limit:
        i = q.pop(0)
        if i in seen: continue
        seen.add(i); n = byid.get(i)
        if not n: continue
        if n["type"] == want_type: return True
        if n["type"] == "link out":
            q += n.get("links", [])
        for p in n.get("wires", []): q += p
    return False
for n in flow_nodes:
    if n["type"] == "http in":
        ok = reaches(n["id"], "http response")
        print("   %-6s %-42s %s" % (n.get("method", "").upper(), n.get("url"), "OK" if ok else "⚠ 응답 노드에 닿지 않음"))

print("\n== 8. 금지·주의 패턴 ==")
mc = [n for n in cfg_nodes if n["type"] == "modbus-client"]
print("   modbus-client 설정: %d개 %s" % (len(mc), [m.get("name") for m in mc]), "" if len(mc) == 1 else "⚠ 1개여야 함")
used_mc = collections.Counter(n.get("server") for n in flow_nodes if n["type"].startswith("modbus"))
print("   modbus 노드가 쓰는 client:", dict(used_mc))
fc5 = [n for n in flow_nodes if n["type"] in ("function", "modbus-flex-write") and re.search(r"\bfc\s*[:=]\s*5\b|\"fc\"\s*:\s*5|'fc'\s*:\s*5", json.dumps(n, ensure_ascii=False))]
print("   FC5 사용: %s" % (["[%s] %s" % (tabname(n["z"]), n.get("name")) for n in fc5] or "없음"))
tl = [n for n in flow_nodes if n["type"] == "function" and "${FARM_ID}" in n.get("func", "") and "`" in n.get("func", "")]
print("   함수 안 `${FARM_ID}` 템플릿 리터럴: %s" % (["[%s] %s" % (tabname(n["z"]), n.get("name")) for n in tl] or "없음"))
hard = [n for n in flow_nodes if n["type"] == "function" and re.search(r"farm_000[1-9]|house_000[1-9]|192\.168\.\d+\.\d+|unitid\s*[:=]\s*\d|unitId\s*[:=]\s*\d", n.get("func", ""))]
print("   함수 안 하드코딩(farm/house id, IP, unitId): %d개" % len(hard))
for n in hard[:12]:
    m = re.findall(r"farm_000\d|house_000\d|192\.168\.\d+\.\d+|unit[iI]d\s*[:=]\s*\d+", n["func"]); print("     [%s] %s: %s" % (tabname(n["z"]), n.get("name"), sorted(set(m))[:4]))
brokers = [n for n in cfg_nodes if n["type"] == "mqtt-broker"]
print("   mqtt-broker 설정: %d개 %s" % (len(brokers), [(b.get("name"), b.get("broker"), b.get("clientid")) for b in brokers]))
topics = collections.Counter((n.get("topic"), n.get("broker")) for n in flow_nodes if n["type"] == "mqtt in")
dup = {k: v for k, v in topics.items() if v > 1}
print("   중복 mqtt in 구독: %s" % (dup or "없음"))
dbg = [n for n in flow_nodes if n["type"] == "debug" and n.get("active", True)]
print("   활성 debug 노드: %d개 (로그 소음)" % len(dbg))
nonames = sum(1 for n in flow_nodes if n["type"] in ("function", "switch", "change") and not n.get("name"))
print("   이름 없는 function/switch/change: %d개" % nonames)
unused_cfg = [c for c in cfg_nodes if c["type"] in ("mqtt-broker", "modbus-client", "serial-port") and not any(n.get("broker") == c["id"] or n.get("server") == c["id"] or n.get("serial") == c["id"] for n in flow_nodes)]
print("   아무도 안 쓰는 설정 노드: %s" % ([(c["type"], c.get("name")) for c in unused_cfg] or "없음"))

print("\n== 9. 레거시/비활성 탭 (메모리: f1~f7, f9, f10 삭제 예정) ==")
for z, t in tabs.items():
    if t.get("disabled") or re.match(r"^f\d+", t["label"]): print("   %s (%d노드)%s" % (t["label"], per_tab[z], " 비활성" if t.get("disabled") else ""))
