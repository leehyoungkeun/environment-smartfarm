# -*- coding: utf-8 -*-
"""KS X 3267 디폴트맵 노드 시뮬레이터 — pymodbus 3.13 SimDevice 위에 node.py 모델을 얹는다.

동작 원리 (pymodbus simulator 런타임):
  SimDevice.action(func_code, start_address, address, count, registers, values) 가
  모든 읽기/쓰기 직전에 awaited 된다. `registers` 는 실제 저장 리스트(start_address 오프셋).
  - 읽기: 노드 모델의 레지스터를 요청 범위만큼 registers 에 미러링 → 런타임이 그 값을 응답
  - 쓰기: 노드 모델에 먼저 적용(opid 활성화·상태 전이) → 예외면 ExcCodes 반환(예외응답)
  - 주기 tick: 남은시간 카운트다운·완료 전이 (asyncio task)

사용:
  python sim.py --tcp 5020 --unit 1 --type actuator
  python sim.py --port COM7 --unit 1 --type sensor --baud 9600
  python sim.py --port /dev/ttyUSB1 --unit 2 --type actuator --opener-time 30 --log-frames
"""
import argparse
import asyncio
import logging
import random
import sys
import time

from pymodbus.constants import ExcCodes
from pymodbus.framer import FramerType
from pymodbus.server import StartAsyncSerialServer, StartAsyncTcpServer
from pymodbus.simulator import DataType, SimData, SimDevice

import _paths  # noqa: F401
from ks3267core import ksmap as M
from node import DefaultMapNode, IllegalDataValue

REG_FIRST = 1
REG_COUNT = 600  # 1..600 (디폴트맵 최대 598)

log = logging.getLogger("ks3267-sim")


class NodeAdapter:
    """node.DefaultMapNode ↔ pymodbus SimDevice action 브리지"""

    def __init__(self, node, fault="none", frame_log=False):
        self.node = node
        self.fault = fault
        self.frame_log = frame_log
        self.stats = {"reads": 0, "writes": 0, "exceptions": 0}

    async def action(self, func_code, start_address, address, count, registers, values):
        # ── 결함 주입 (시험 §5.3 비정상 시나리오 재현용) ──
        if self.fault == "illegal_addr":
            self.stats["exceptions"] += 1
            return ExcCodes.ILLEGAL_ADDRESS
        if self.fault == "slave_failure":
            self.stats["exceptions"] += 1
            return ExcCodes.DEVICE_FAILURE
        if self.fault == "timeout":
            await asyncio.sleep(3.0)  # 마스터 타임아웃(보통 1초)보다 길게 — 응답 없음과 동치
            return ExcCodes.DEVICE_FAILURE

        if values is None:  # 읽기 (0x03/0x04)
            self.stats["reads"] += 1
            vals = self.node.read(address, count)
            off = address - start_address
            registers[off:off + count] = vals
            return None

        # 쓰기 (0x06/0x10)
        self.stats["writes"] += 1
        try:
            self.node.write(address, list(values))
        except IllegalDataValue as e:
            self.stats["exceptions"] += 1
            log.warning("예외응답 0x03 (illegal data value): %s", e)
            return ExcCodes.ILLEGAL_VALUE
        # 런타임도 같은 값을 쓰므로 미러링은 다음 읽기에서 자연히 맞는다
        return None

    def trace_packet(self, sending, data):
        if self.frame_log:
            direction = "TX" if sending else "RX"
            log.info("%s %s", direction, " ".join(f"{b:02X}" for b in data))
        return data


async def ticker(node, period=0.5):
    while True:
        node.tick()
        await asyncio.sleep(period)


async def sensor_noise(node, period=2.0):
    """센서 노드: 온습도 등을 살아 있는 값처럼 흔든다 (시험용 고정값은 --sensor-noise 미지정)"""
    base = {1: 25.0, 2: 24.5, 3: 25.5, 4: 60.0, 13: 800.0, 14: 1.8, 18: 6.2, 19: 21.0}
    while True:
        for i, b in base.items():
            node.set_sensor(i, round(b + random.uniform(-0.3, 0.3), 2))
        await asyncio.sleep(period)


def build_device(args):
    devices = None
    if args.devices:
        devices = {int(x) for x in args.devices.split(",") if x.strip()}
    node = DefaultMapNode(args.type, unit=args.unit, serial=args.serial,
                          opener_full_time=args.opener_time, devices=devices)
    if args.type == "sensor":
        # 시험 기본값: 온도 25.0 / 습도 60.0 (표준 예시 28.8 도 검증용으로 온도3 에)
        node.set_sensor(1, 25.0); node.set_sensor(4, 60.0); node.set_sensor(3, 28.8)
    adapter = NodeAdapter(node, fault=args.fault, frame_log=args.log_frames)
    simdata = [SimData(address=REG_FIRST, count=REG_COUNT, values=0, datatype=DataType.REGISTERS)]
    device = SimDevice(id=args.unit, simdata=simdata, action=adapter.action)
    return node, adapter, device


async def main(args):
    node, adapter, device = build_device(args)
    tasks = [asyncio.create_task(ticker(node))]
    if args.type == "sensor" and args.sensor_noise:
        tasks.append(asyncio.create_task(sensor_noise(node)))
    log.info("KS X 3267 디폴트맵 %s 노드 시뮬레이터 — unit=%d, fault=%s", args.type, args.unit, args.fault)
    if args.tcp:
        log.info("TCP 0.0.0.0:%d (framer=socket)", args.tcp)
        await StartAsyncTcpServer(context=[device], address=("0.0.0.0", args.tcp),
                                  trace_packet=adapter.trace_packet)
    else:
        log.info("RTU %s %d 8N1", args.port, args.baud)
        await StartAsyncSerialServer(context=[device], framer=FramerType.RTU,
                                     port=args.port, baudrate=args.baud, bytesize=8,
                                     parity="N", stopbits=1, timeout=1,
                                     trace_packet=adapter.trace_packet)
    for t in tasks:
        t.cancel()


def parse():
    p = argparse.ArgumentParser(description="KS X 3267 default-map node simulator")
    p.add_argument("--type", choices=["sensor", "actuator"], default="actuator")
    p.add_argument("--unit", type=int, default=1, help="모드버스 슬레이브 주소 1~247")
    p.add_argument("--serial", type=lambda v: int(v, 0), default=0, help="노드 시리얼(uint32)")
    p.add_argument("--port", help="시리얼 포트 (COM7, /dev/ttyUSB1)")
    p.add_argument("--baud", type=int, default=9600)
    p.add_argument("--tcp", type=int, help="TCP 포트로 띄우기 (개발 편의, RTU 대신)")
    p.add_argument("--opener-time", type=int, default=30, help="개폐기 완전 열림/닫힘 소요 초")
    p.add_argument("--devices", help="부착 디바이스 순번 (예: 1,2,17). 미지정=전부")
    p.add_argument("--fault", choices=["none", "illegal_addr", "slave_failure", "timeout"], default="none")
    p.add_argument("--sensor-noise", action="store_true")
    p.add_argument("--log-frames", action="store_true", help="TX/RX hex 프레임 로그 (시험 증적)")
    a = p.parse_args()
    if not a.tcp and not a.port:
        p.error("--port 또는 --tcp 필요")
    if not 1 <= a.unit <= 247:
        p.error("unit 은 1~247")
    return a


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(main(parse()))
    except KeyboardInterrupt:
        pass
