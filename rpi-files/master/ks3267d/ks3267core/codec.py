# -*- coding: utf-8 -*-
"""KS X 3267 4.3.3 레지스터 값 표현 — 워드 내 big-endian, 워드 간 little-endian (CDAB).

표준 예시: 28.8°C = 0x41E66666 → reg 372 = 0x6666 (하위 워드), reg 373 = 0x41E6 (상위 워드).
uint32 도 같은 규칙 (하위 워드 먼저).
"""
import struct


def float_to_regs(value):
    """float → (low_word, high_word)"""
    raw = struct.unpack(">I", struct.pack(">f", float(value)))[0]
    return raw & 0xFFFF, (raw >> 16) & 0xFFFF


def regs_to_float(low_word, high_word):
    raw = ((high_word & 0xFFFF) << 16) | (low_word & 0xFFFF)
    return struct.unpack(">f", struct.pack(">I", raw))[0]


def uint32_to_regs(value):
    """uint32 → (low_word, high_word)"""
    v = int(value) & 0xFFFFFFFF
    return v & 0xFFFF, (v >> 16) & 0xFFFF


def regs_to_uint32(low_word, high_word):
    return ((high_word & 0xFFFF) << 16) | (low_word & 0xFFFF)


def int16_to_reg(value):
    """int16 (동작강도 -100..100 등) → uint16 2의 보수"""
    return int(value) & 0xFFFF


def reg_to_int16(reg):
    v = reg & 0xFFFF
    return v - 0x10000 if v & 0x8000 else v
