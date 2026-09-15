# -*- coding: utf-8 -*-
"""표준 노드 통신 설정 — 포트 목록·검증·영속·연결 시험 판정 (2026-09-15).

왜:
  KOAT SPS-7466 §5.4.1 연결시험 b) 는 사람이 통신 설정값(포트·9600)을 장비에서 직접 맞추는 단계다.
  예전엔 포트·속도가 ks3267d 실행 인자에 박혀 있어 SSH 로 들어가 인자를 고치고 재시작해야 했다.
  실 노드가 오면 시뮬레이터에서 RS485 로 바꾸는 일도 같은 작업이다. 화면에서 바꾸게 한다.

원칙:
  - 자체 장치 버스(/dev/smartfarm-485, CH340)는 절대 고를 수 없다. Node-RED 가 릴레이·센서에 쓰는
    버스라 겹치면 기존 제어가 멈춘다.
  - 데이터 형식은 KS X 3267 표준 고정값 8N1 RTU. 속도는 9600 이 표준이고, 다른 값은 경고와 함께만.
  - 시뮬레이터(TCP)는 이 제어기 안(127.0.0.1)만 — 시험과 30일 데이터 유지용.
  - pymodbus 를 import 하지 않는다. 시험이 시리얼·라이브러리 없이 돈다 (test_comm.py).
"""
import json
import os

STANDARD = {"baud": 9600, "bytesize": 8, "parity": "N", "stopbits": 1, "framer": "RTU"}
ALLOWED_BAUDS = (9600, 19200, 38400, 57600, 115200)
CHIPS = {"0403": "FTDI", "1a86": "CH340"}
STANDARD_LINK = "/dev/smartfarm-485-std"
VENDOR_LINK = "/dev/smartfarm-485"

_ROLE_LABEL = {"standard": "표준 노드 포트", "vendor": "자체 장치 버스 · 선택 불가", "other": "기타 시리얼"}


def classify_ports(entries, std_real=None, vendor_real=None, std_link=STANDARD_LINK):
    """entries: [{path, real, vid, pid, product, serial}] → 역할·칩·라벨·선택 가능 여부를 붙여 정렬한다."""
    out = []
    for e in entries:
        real = e.get("real")
        if std_real and real == std_real:
            role = "standard"
        elif vendor_real and real == vendor_real:
            role = "vendor"
        else:
            role = "other"
        chip = CHIPS.get((e.get("vid") or "").lower()) or (e.get("product") or "").strip() or "알 수 없음"
        dev = os.path.basename(real or e.get("path") or "")
        out.append({
            **e,
            "role": role,
            "chip": chip,
            "selectable": role != "vendor",
            # 표준 포트는 USB 재인식으로 ttyUSB 번호가 바뀌어도 따라가는 고정 이름으로 저장한다
            "stable": std_link if role == "standard" else e.get("path"),
            "label": f"{_ROLE_LABEL[role]} · {chip} · {dev}",
        })
    order = {"standard": 0, "other": 1, "vendor": 2}
    return sorted(out, key=lambda p: (order[p["role"]], p.get("path") or ""))


def _read(path):
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    except OSError:
        return ""


def list_ports(dev_root="/dev", sys_root="/sys/class/tty"):
    """제어기의 USB 시리얼 포트를 찾는다 (파일시스템을 읽는다). ttyAMA(보드 내장 디버그 UART)는 뺀다."""
    try:
        names = sorted(n for n in os.listdir(sys_root) if n.startswith(("ttyUSB", "ttyACM")))
    except OSError:
        names = []
    entries = []
    for n in names:
        u = os.path.realpath(os.path.join(sys_root, n, "device"))
        for _ in range(5):
            if os.path.exists(os.path.join(u, "idVendor")):
                break
            u = os.path.dirname(u)
        path = os.path.join(dev_root, n)
        entries.append({
            "path": path, "real": os.path.realpath(path),
            "vid": _read(os.path.join(u, "idVendor")), "pid": _read(os.path.join(u, "idProduct")),
            "product": _read(os.path.join(u, "product")), "serial": _read(os.path.join(u, "serial")),
        })

    def real_of(link):
        p = os.path.join(dev_root, link)
        return os.path.realpath(p) if os.path.exists(p) else None

    return classify_ports(entries,
                          std_real=real_of(os.path.basename(STANDARD_LINK)),
                          vendor_real=real_of(os.path.basename(VENDOR_LINK)))


def validate_comm(req, ports):
    """화면이 보낸 설정을 검증·정규화한다. → (cfg, None) 또는 (None, 사람이 읽을 오류)"""
    r = req or {}
    try:
        timeout = float(r.get("timeout", 1.0))
    except (TypeError, ValueError):
        return None, "응답 대기 시간은 숫자여야 합니다"
    if not 0.2 <= timeout <= 5.0:
        return None, "응답 대기 시간은 0.2~5초입니다"

    mode = r.get("mode")
    if mode == "serial":
        want = str(r.get("port") or "")
        match = next((p for p in ports if want and want in (p.get("path"), p.get("real"), p.get("stable"))), None)
        if not match:
            return None, f"포트를 찾을 수 없습니다: {want or '(비어 있음)'}"
        if match.get("role") == "vendor":
            return None, "자체 장치 버스(릴레이·센서용)는 선택할 수 없습니다. 고르면 기존 제어가 멈춥니다"
        try:
            baud = int(r.get("baud", STANDARD["baud"]))
        except (TypeError, ValueError):
            return None, "통신 속도는 숫자여야 합니다"
        if baud not in ALLOWED_BAUDS:
            return None, "통신 속도는 " + ", ".join(str(b) for b in ALLOWED_BAUDS) + " 중 하나입니다"
        return {"mode": "serial", "port": match.get("stable") or match.get("path"), "baud": baud,
                "timeout": timeout, "tcp": None, "nonStandard": baud != STANDARD["baud"]}, None

    if mode == "tcp":
        host, _, pn = str(r.get("tcp") or "").partition(":")
        if host not in ("127.0.0.1", "localhost"):
            return None, "시뮬레이터 연결은 이 제어기 안(127.0.0.1)만 허용합니다"
        try:
            port_no = int(pn)
        except ValueError:
            return None, "시뮬레이터 포트 번호가 잘못됐습니다"
        if not 1 <= port_no <= 65535:
            return None, "시뮬레이터 포트 번호가 잘못됐습니다"
        return {"mode": "tcp", "port": None, "baud": None, "timeout": timeout,
                "tcp": f"127.0.0.1:{port_no}", "nonStandard": False}, None

    return None, "연결 방식은 serial(RS485) 또는 tcp(시뮬레이터) 입니다"


def load_comm(path):
    """저장된 설정. 없거나 깨졌으면 None — 실행 인자를 쓴다."""
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and d.get("mode") in ("serial", "tcp") else None


def save_comm(path, cfg):
    keep = {k: cfg.get(k) for k in ("mode", "port", "baud", "timeout", "tcp")}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(keep, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def probe_serial_open(path, baud=STANDARD["baud"], opener=None):
    """포트를 표준값(9600 8N1)으로 잠깐 열었다 닫는다 — 당일 준비 점검용. 드라이버가 쓰고 있는 포트엔 호출하지 않는다(prep_rows 가 가린다).
    opener(path, baud) 는 시험용 주입; 기본은 pyserial (pymodbus 의존성으로 이미 설치돼 있다)."""
    try:
        if opener is None:
            import serial

            def opener(p, b):
                s = serial.Serial(p, b, bytesize=8, parity="N", stopbits=1, timeout=0.2)
                s.close()
        opener(path, baud)
        return {"ok": True, "error": None}
    except Exception as e:  # 장치 없음·권한·사용 중 — 원인을 그대로 보여 준다
        return {"ok": False, "error": str(e)}


def prep_rows(ports, info, probe=None):
    """당일 준비 점검 (2026-09-15) — a)~d) 판정과 별개로, 시험 당일 RS485 로 바꾸면 곧바로 통과할 상태인지 미리 본다.
    시뮬레이터로 운영하는 동안엔 a)b) 가 실패로 나오는 게 맞아서, 그 대신 '표준 포트가 꽂혀 있고 9600 으로 열리는가' 를 여기서 증명한다.
    ok: True 준비됨 / False 미비 / None 안내"""
    i = info or {}
    std = next((p for p in (ports or []) if p.get("role") == "standard"), None)
    rows = [{
        "title": f"표준 노드 포트(FTDI, 고정 이름 {STANDARD_LINK}) 인식",
        "ok": std is not None,
        "detail": std["label"] if std else "USB-RS485(FTDI) 변환기가 안 보입니다 — 꽂혀 있는지, udev 규칙(99-smartfarm-485-std)이 있는지 확인",
    }]
    title = "표준 포트 열림 시험 (9600 8N1)"
    if std is None:
        rows.append({"title": title, "ok": False, "detail": "포트가 없어 시험하지 않음"})
    elif i.get("mode") == "serial" and i.get("port") in (std.get("stable"), std.get("path"), std.get("real")):
        rows.append({"title": title, "ok": bool(i.get("connected")),
                     "detail": "드라이버가 이 포트를 사용 중 · " + ("열림" if i.get("connected") else "닫힘")})
    else:
        r = probe(std.get("stable") or std.get("path"), STANDARD["baud"]) if probe else {"ok": None, "error": "시험 안 함"}
        rows.append({"title": title, "ok": r.get("ok"),
                     "detail": "열고 닫음 · 정상" if r.get("ok") else f"열지 못함: {r.get('error')}"})
    if i.get("mode") == "serial":
        rows.append({"title": "연결 방식", "ok": i.get("baud") == STANDARD["baud"], "detail": f"RS485 · {i.get('desc')}"})
    else:
        rows.append({"title": "연결 방식", "ok": None,
                     "detail": f"지금은 {i.get('desc') or '시뮬레이터'} — 시험 당일 「시험 당일 값으로」 를 눌러 RS485 · 표준 포트 · 9600 으로 바꾼 뒤 적용"})
    return rows


def conn_test_rows(info, unit, discovery, prep=None):
    """SPS-7466 §5.4.1 연결시험 a)~d) 판정표 (+ prep: 당일 준비 점검, 판정과 별개).
    info: {mode, port, baud, connected, desc}   discovery: {ok, node} | {ok: False, error}
    """
    i = info or {}
    serial = i.get("mode") == "serial"
    rows = [{
        "step": "a", "title": "RS485 케이블로 노드와 연결", "expected": "표준 노드 포트 열림",
        "actual": (i.get("desc") or "-") + (" · 열림" if i.get("connected") else " · 닫힘"),
        "ok": bool(serial and i.get("connected")),
        "note": None if serial else "시뮬레이터(TCP)에 연결돼 있습니다. 실제 RS485 가 아닙니다",
    }, {
        "step": "b", "title": "통신 설정값 세팅 (포트·보레이트)", "expected": "9600 bps · 8N1 · RTU",
        "actual": f"{i.get('baud')} bps · 8N1 · RTU" if serial else "TCP (시뮬레이터)",
        "ok": bool(serial and i.get("baud") == STANDARD["baud"]),
        "note": None,
    }]

    valid_unit = isinstance(unit, int) and not isinstance(unit, bool) and 1 <= unit <= 247
    rows.append({"step": "c", "title": "노드 슬레이브 아이디 입력", "expected": "1~247",
                 "actual": "-" if unit is None else str(unit), "ok": valid_unit, "note": None})

    d = discovery or {}
    node = d.get("node") or {}
    if d.get("ok") and node:
        kind = {"sensor": "센서 노드", "actuator": "구동기 노드"}.get(node.get("kind"), node.get("kind") or "노드")
        actual = f"{kind} · 프로토콜 {node.get('protocol_version')} · 채널 {node.get('channels')}"
        ok = bool(node.get("default_map"))
        note = None if ok else "응답했지만 디폴트 레지스터맵 노드가 아닙니다"
    else:
        actual = d.get("error") or ("주소가 잘못돼 시도하지 않음" if not valid_unit else "응답 없음")
        ok = False
        note = "주소·배선(A/B 극성)·종단저항·노드 전원을 확인하세요" if valid_unit else None
    rows.append({"step": "d", "title": "통신 연결 수행 (노드 정보 수신)", "expected": "노드 응답",
                 "actual": actual, "ok": ok, "note": note})
    return {"rows": rows, "passed": all(r["ok"] for r in rows), "prep": prep or []}
