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


WRITE_FCS = (0x06, 0x10)


class FrameLog:
    def __init__(self, size=400, write_size=200):
        self.buf = collections.deque(maxlen=size)
        # 명령 프레임(FC06/16 쓰기)과 그 응답은 따로 오래 보관한다 — 폴링 프레임이 3초마다 쌓여 링버퍼(400 ≈ 10분)에서
        # 명령이 금방 밀려나 실노드 증적 frames.txt 에서 빠졌다 (2026-09-19). 같은 dict 를 두 버퍼에 넣어 RX 병합도 함께 반영.
        self.writes = collections.deque(maxlen=write_size)
        self._await_write_rx = False
        self.lock = threading.Lock()
        # exceptions/timeouts = 폴링·명령 중 실제 장애. scan_misses = 자동스캔이 두드린 빈 주소의 무응답/예외(장애 아님)
        self.stats = {"tx": 0, "rx": 0, "exceptions": 0, "timeouts": 0, "scan_misses": 0}

    RX_MERGE_SEC = 2.0   # 한 응답의 수신 조각들이 이 안에 들어온다 (9600 bps 최대 프레임 256B ≈ 0.27 s + 타임아웃 여유)

    def trace_packet(self, sending, data):
        """pymodbus trace_packet 훅. 시리얼(RTU)에서는 pymodbus 가 응답을 **조각마다** 이 훅에 넘겨(누적 버퍼를 반복해서
        주기도 한다) 같은 응답이 여러 줄로 찍히고 rx 가 tx 의 몇 배로 부풀었다(2026-09-19 실노드에서 발견).
        RX 는 직전 RX 항목과 같은 응답의 조각이면(같거나 한쪽이 다른쪽의 앞부분) 한 항목으로 합친다 — 긴 쪽을 남긴다."""
        if not data:
            return data
        hx = " ".join(f"{b:02X}" for b in data)
        now = time.time()
        with self.lock:
            if not sending and self.buf:
                last = self.buf[-1]
                if last["dir"] == "RX" and now - last["t"] < self.RX_MERGE_SEC and \
                        (hx == last["hex"] or hx.startswith(last["hex"]) or last["hex"].startswith(hx)):
                    if len(hx) > len(last["hex"]):
                        last["hex"] = hx
                    return data
            item = {"t": now, "dir": "TX" if sending else "RX", "hex": hx}
            self.buf.append(item)
            self.stats["tx" if sending else "rx"] += 1
            if sending:
                self._await_write_rx = len(data) > 1 and data[1] in WRITE_FCS
                if self._await_write_rx:
                    self.writes.append(item)
            elif self._await_write_rx:
                self.writes.append(item)          # 쓰기 요청의 응답(정상 에코 또는 예외 0x86/0x90)
                self._await_write_rx = False
        return data

    def recent_writes(self, n=200):
        with self.lock:
            return list(self.writes)[-n:]

    def recent(self, n=50):
        with self.lock:
            return list(self.buf)[-n:]

    def reset_stats(self):
        """통계만 0 으로 (프레임 버퍼는 유지) — 시험 준비가 끝난 뒤 §5.3 의 의도된 예외·연결 전 타임아웃 숫자가 화면에 빨갛게 남지 않게 (2026-09-16)"""
        with self.lock:
            for k in self.stats:
                self.stats[k] = 0
            return dict(self.stats)


class PymodbusTransport:
    """pymodbus 3.x 동기 클라이언트 래퍼 — RTU(시리얼) 또는 TCP(시뮬레이터/개발)"""

    def __init__(self, port=None, baud=9600, tcp=None, timeout=1.0, retries=0, frames=None):
        from pymodbus.client import ModbusSerialClient, ModbusTcpClient
        from pymodbus.framer import FramerType
        self.frames = frames or FrameLog()
        self.probing = False   # master.scan() 이 켠다 — 그동안의 실패는 scan_misses 로 집계
        # 화면의 통신 설정·§5.4.1 연결 시험이 읽는다 (2026-09-15)
        self.mode = "tcp" if tcp else "serial"
        self.port = None if tcp else port
        self.baud = None if tcp else baud
        self.tcp = tcp
        self.timeout = timeout
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

    def is_connected(self):
        return bool(getattr(self.client, "connected", False))

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
