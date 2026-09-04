# -*- coding: utf-8 -*-
"""전송 계층 — 마스터 드라이버가 보는 모드버스 인터페이스.

read(unit, addr, count) -> list[int]      # FC 0x03
write(unit, addr, values)                 # FC 0x10 (values 1개면 0x06 도 가능하나 표준 기본은 0x10)

예외 응답은 ModbusExc(code) 로, 응답 없음/IO 오류는 TransportTimeout 으로 올린다 — 마스터는 이 둘만
구분하면 된다 (4.2 메시지 플로우: 정상 / 예외 응답 / 타임아웃).

프레임 링버퍼: 시험 증적·진단 UI 용으로 최근 TX/RX hex 를 보관한다 (메모리만).
"""
import collections
import threading
import time


class ModbusExc(Exception):
    """슬레이브의 예외 응답 (4.3.1.2.2). code: 0x01 illegal function … 0x04 slave failure"""
    NAMES = {1: "illegal_function", 2: "illegal_data_address", 3: "illegal_data_value", 4: "slave_device_failure"}

    def __init__(self, code, fc=None):
        self.code = int(code)
        self.fc = fc
        super().__init__(f"exception 0x{self.code:02X} ({self.NAMES.get(self.code, 'unknown')})")


class TransportTimeout(Exception):
    """응답 없음 (4.2 패킷 에러 → timeout)"""


class FrameLog:
    def __init__(self, size=200):
        self.buf = collections.deque(maxlen=size)
        self.lock = threading.Lock()
        # exceptions/timeouts = 폴링·명령 중 실제 장애. scan_misses = 자동스캔이 두드린 빈 주소의 무응답/예외(장애 아님)
        self.stats = {"tx": 0, "rx": 0, "exceptions": 0, "timeouts": 0, "scan_misses": 0}

    def trace_packet(self, sending, data):
        with self.lock:
            self.buf.append({"t": time.time(), "dir": "TX" if sending else "RX",
                             "hex": " ".join(f"{b:02X}" for b in data)})
            self.stats["tx" if sending else "rx"] += 1
        return data

    def recent(self, n=50):
        with self.lock:
            return list(self.buf)[-n:]


class PymodbusTransport:
    """pymodbus 3.x 동기 클라이언트 래퍼 — RTU(시리얼) 또는 TCP(시뮬레이터/개발)"""

    def __init__(self, port=None, baud=9600, tcp=None, timeout=1.0, retries=0, frames=None):
        from pymodbus.client import ModbusSerialClient, ModbusTcpClient
        from pymodbus.framer import FramerType
        self.frames = frames or FrameLog()
        self.probing = False   # master.scan() 이 켠다 — 그동안의 실패는 scan_misses 로 집계
        if tcp:
            host, _, p = tcp.partition(":")
            self.client = ModbusTcpClient(host, port=int(p or 502), timeout=timeout, retries=retries,
                                          trace_packet=self.frames.trace_packet)
            self.desc = f"tcp {tcp}"
        else:
            self.client = ModbusSerialClient(port, framer=FramerType.RTU, baudrate=baud, bytesize=8,
                                             parity="N", stopbits=1, timeout=timeout, retries=retries,
                                             trace_packet=self.frames.trace_packet)
            self.desc = f"rtu {port} {baud} 8N1"

    def connect(self):
        return self.client.connect()

    def close(self):
        self.client.close()

    def _count(self, kind):
        # 스캔 중 빈 주소의 실패는 장애 지표(exceptions/timeouts)를 오염시키지 않는다
        self.frames.stats["scan_misses" if self.probing else kind] += 1

    def _check(self, rr, fc):
        from pymodbus.pdu import ExceptionResponse
        if isinstance(rr, ExceptionResponse):
            self._count("exceptions")
            raise ModbusExc(rr.exception_code, fc)
        if rr is None or rr.isError():
            self._count("timeouts")
            raise TransportTimeout(str(rr))
        return rr

    def read(self, unit, addr, count):
        from pymodbus.exceptions import ModbusException
        try:
            rr = self.client.read_holding_registers(addr, count=count, device_id=unit)
        except ModbusException as e:
            self._count("timeouts")
            raise TransportTimeout(str(e))
        return list(self._check(rr, 3).registers)

    def write(self, unit, addr, values):
        from pymodbus.exceptions import ModbusException
        try:
            rr = self.client.write_registers(addr, list(values), device_id=unit)
        except ModbusException as e:
            self._count("timeouts")
            raise TransportTimeout(str(e))
        self._check(rr, 16)
        return True
