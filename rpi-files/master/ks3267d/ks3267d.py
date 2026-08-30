# -*- coding: utf-8 -*-
"""ks3267d — KS X 3267 마스터 드라이버 데몬 (pm2 관리, D16 데몬 패턴).

  python ks3267d.py --port /dev/smartfarm-485-std --units 1,2 --api-port 3002
  python ks3267d.py --tcp 127.0.0.1:5020 --units 1            # 시뮬레이터 상대 (개발)

시작 시 --units 를 탐색·등록하고, --poll 주기로 상태를 읽어 변화가 있으면 --nr-url 로 POST 한다.
NR 은 이 데몬의 REST 를 부르는 오케스트레이터다 (제어 판단·자동화는 NR/백엔드에 그대로).
"""
import argparse
import json
import logging
import os
import sys
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from api import serve  # noqa: E402
from master import KsMaster  # noqa: E402
from transport import FrameLog, ModbusExc, PymodbusTransport, TransportTimeout  # noqa: E402

log = logging.getLogger("ks3267d")


def push_status(url, payload):
    try:
        req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
    except Exception as e:
        log.warning("NR push 실패 (%s): %s", url, e)


def poll_loop(master, units, interval, nr_url, stop):
    last = {}
    while not stop.is_set():
        for unit in list(units):
            if unit not in master.nodes:
                try:
                    master.discover(unit)
                except (ModbusExc, TransportTimeout) as e:
                    log.warning("unit %d 탐색 실패: %s", unit, e)
                    continue
            st = master.poll(unit)
            if st is None:
                continue
            key = json.dumps({k: v for k, v in st.items() if k != "t"}, sort_keys=True, default=str)
            if key != last.get(unit):
                last[unit] = key
                log.info("unit %d 상태 변화: %s", unit, key[:200])
                if nr_url:
                    push_status(nr_url, {"source": "ks3267d", "unit": unit, "state": st})
        stop.wait(interval)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", help="RS485 시리얼 포트 (예: /dev/smartfarm-485-std)")
    p.add_argument("--baud", type=int, default=9600)
    p.add_argument("--tcp", help="host:port — 시뮬레이터/개발용")
    p.add_argument("--units", default="", help="시작 시 탐색할 슬레이브 주소, 예: 1,2")
    p.add_argument("--api-port", type=int, default=3002)
    p.add_argument("--poll", type=float, default=2.0, help="폴링 주기(초)")
    p.add_argument("--timeout", type=float, default=1.0)
    p.add_argument("--retries", type=int, default=0, help="기본 0 — 버스 문제를 재시도로 가리지 않는다")
    p.add_argument("--state-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "state"))
    p.add_argument("--nr-url", default="", help="상태 변화 POST 대상 (예: http://127.0.0.1:1880/api/ks3267/status)")
    a = p.parse_args()
    if not a.port and not a.tcp:
        p.error("--port 또는 --tcp 필요")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.makedirs(a.state_dir, exist_ok=True)

    t = PymodbusTransport(port=a.port, baud=a.baud, tcp=a.tcp, timeout=a.timeout, retries=a.retries,
                          frames=FrameLog())
    if not t.connect():
        log.error("전송 연결 실패: %s", t.desc); sys.exit(1)
    master = KsMaster(t, state_dir=a.state_dir)
    units = [int(x) for x in a.units.split(",") if x.strip()]
    srv = serve(master, port=a.api_port)
    log.info("ks3267d 시작 — %s, units=%s, api=127.0.0.1:%d, retries=%d", t.desc, units, a.api_port, a.retries)
    stop = threading.Event()
    th = threading.Thread(target=poll_loop, args=(master, units, a.poll, a.nr_url, stop), daemon=True)
    th.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        stop.set(); srv.shutdown(); t.close()


if __name__ == "__main__":
    main()
