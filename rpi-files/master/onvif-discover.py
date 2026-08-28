#!/usr/bin/env python3
"""ONVIF WS-Discovery — LAN 의 카메라를 찾는다.  stdout: "ip mac model" 한 줄씩.

→ /usr/local/lib/smartfarm/onvif-discover.py
smartfarm-camera-setup.sh 와 smartfarm-camera-probe.sh 가 공용으로 쓴다.

ARP 는 최근 통신 이력이 있어야 보이지만, 멀티캐스트 Probe 에는 카메라가 어느 IP 에 있든
직접 응답한다 — 2026-08-28 에 .39 로 알던 Tapo C200 을 .36 에서 찾아낸 방법.
응답 직후 커널 neighbor 테이블에 MAC 이 채워지므로 그것으로 MAC 을 붙인다.
"""
import re
import socket
import subprocess
import sys
import time
import uuid

PROBE = (
    '<?xml version="1.0"?>'
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" '
    'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
    'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" '
    'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
    "<e:Header><w:MessageID>uuid:%s</w:MessageID>"
    "<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>"
    "<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>"
    "<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>"
)


def discover(rounds=2, wait=2.5):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    s.settimeout(wait)
    found = {}
    for _ in range(rounds):
        s.sendto((PROBE % uuid.uuid4()).encode(), ("239.255.255.250", 3702))
        try:
            while True:
                data, addr = s.recvfrom(65535)
                text = data.decode(errors="ignore")
                if "onvif" not in text.lower():
                    continue
                scopes = " ".join(re.findall(r"Scopes>([^<]+)", text))
                model = [w.rsplit("/", 1)[-1] for w in scopes.split() if "/hardware/" in w or "/name/" in w]
                found[addr[0]] = model[0] if model else "?"
        except socket.timeout:
            pass
    time.sleep(0.3)  # neighbor 테이블 반영 대기
    neigh = {}
    for line in subprocess.run(["ip", "neigh"], capture_output=True, text=True).stdout.splitlines():
        f = line.split()
        if len(f) > 4 and "lladdr" in f:
            neigh[f[0]] = f[f.index("lladdr") + 1].lower()
    for ip in sorted(found, key=lambda x: [int(p) for p in x.split(".")]):
        print(ip, neigh.get(ip, "?"), found[ip])


if __name__ == "__main__":
    try:
        discover()
    except OSError as e:  # 네트워크 없음 등 — 빈 출력이 곧 "못 찾음"
        print(f"discover: {e}", file=sys.stderr)
