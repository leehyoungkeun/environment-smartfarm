#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==================================================================
 Huidu HD-D16  텍스트 표시 v8  (PC가 직접 접속하는 방식)
==================================================================
 v7까지의 근본 오류 수정:
   - v7: PC가 서버 열고 D16이 접속해오게 유도 (→ 버전 0x06, 명령 거부)
   - v8: PC가 클라이언트로 D16:9527 에 직접 접속 (HDPlayer 실제 방식!)
         → 버전 0x09 정상 협상 → 명령 통과

 캡처 분석 결과:
   1. D16이 UDP 9527→9526 으로 자기존재 브로드캐스트
   2. PC가 TCP로 D16의 9527 포트에 직접 connect
   3. 08000b0009000001 핸드셰이크 → 이후 명령들

 필요: pip install pillow
 사용법: python huidu_d16_display.py "표시할텍스트"
==================================================================
"""

import socket
import struct
import time
import hashlib
import base64
import os
import sys

DEVICE_IP  = "169.254.255.254"
DEVICE_PORT = 9527                  # ★ D16이 여는 TCP 포트 (직접 접속)
LOCAL_IP   = "169.254.75.142"

PANEL_W, PANEL_H = 128, 64
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def log(m): print(m)


def render_text_png(text, out_path):
    from PIL import Image, ImageDraw, ImageFont
    # literal "\n" 문자열을 실제 개행으로 변환 (config JSON 저장 시 이스케이프)
    text = text.replace('\\n', '\n')
    lines = text.split('\n')
    n = len(lines)
    # 라인 수에 따라 폰트 크기 자동
    font_size = 28 if n == 1 else 24 if n == 2 else 16

    img = Image.new('RGBA', (PANEL_W, PANEL_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = None
    for fname in ("malgun.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            font = ImageFont.truetype(fname, font_size); break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    metrics = []
    for line in lines:
        try:
            bbox = d.textbbox((0, 0), line, font=font)
            tw, th, ox, oy = bbox[2]-bbox[0], bbox[3]-bbox[1], bbox[0], bbox[1]
        except Exception:
            tw, th, ox, oy = 60, font_size, 0, 0
        metrics.append((line, tw, th, ox, oy))

    spacing = max(2, int(font_size * 0.15))
    total_h = sum(m[2] for m in metrics) + spacing * (n - 1)
    y = (PANEL_H - total_h) // 2

    for line, tw, th, ox, oy in metrics:
        x = (PANEL_W - tw) // 2 - ox
        d.text((x, y - oy), line, fill=(255, 255, 255, 255), font=font)
        y += th + spacing

    img.save(out_path)
    return out_path


def build_program_xml(text, png_md5):
    # 바이너리로 읽어 CRLF(\r\n) 보존 - 이게 깨지면 D16이 로딩 실패함
    tpl = open(os.path.join(SCRIPT_DIR, "program_template.xml"), 'rb').read()
    b64 = base64.b64encode(text.encode('utf-8'))  # 이미 bytes
    xml = tpl.replace(b'@@PLAYTEXT@@', b64).replace(b'@@MD5@@', png_md5.encode())
    return xml  # bytes 반환


class Conn:
    def __init__(self, sock):
        self.sock = sock; self.buf = b''
    def recv_packet(self, timeout=8.0):
        self.sock.settimeout(timeout)
        try:
            while len(self.buf) < 2:
                c = self.sock.recv(4096)
                if not c: return None
                self.buf += c
            plen = struct.unpack('<H', self.buf[:2])[0]
            while len(self.buf) < plen:
                c = self.sock.recv(4096)
                if not c: break
                self.buf += c
            pkt = self.buf[:plen]; self.buf = self.buf[plen:]
            return pkt
        except socket.timeout:
            return None
    def send_cmd(self, cmd, payload=b""):
        length = 4 + len(payload)
        self.sock.sendall(struct.pack('<HH', length, cmd) + payload)


def display_text(conn, text):
    png_path = os.path.join(SCRIPT_DIR, "d16_text.png")
    render_text_png(text, png_path)
    png_data = open(png_path, 'rb').read()
    png_md5 = hashlib.md5(png_data).hexdigest()
    log(f" [PNG] '{text}' -> {len(png_data)}B md5={png_md5[:8]}")

    xml_data = build_program_xml(text, png_md5)  # 이미 bytes (CRLF 보존)
    boot_md5 = hashlib.md5(xml_data).hexdigest()
    log(f" [XML] {len(xml_data)}B boot_md5={boot_md5[:8]}")

    total_size = len(png_data) + len(xml_data)

    # 핸드셰이크 (버전 0x09)
    conn.send_cmd(0x000b, struct.pack('<I', 0x01000009))
    r = conn.recv_packet()
    if r is None:
        log(" [핸드셰이크] 응답없음"); return False
    ver = struct.unpack('<I', r[4:8])[0] if len(r) >= 8 else 0
    log(f" [핸드셰이크] D16 버전=0x{ver:08x} {'✓' if ver==0x01000009 else '⚠️'}")

    def send_expect(cmd, payload=b"", label=""):
        conn.send_cmd(cmd, payload)
        rr = conn.recv_packet()
        if rr is None:
            log(f"   {label or hex(cmd)} → 응답없음!"); return None
        rcmd = struct.unpack('<H', rr[2:4])[0]
        if rcmd == cmd + 1:
            log(f"   0x{cmd:04x} → OK {label}")
        elif rcmd == 0x2000:
            log(f"   0x{cmd:04x} → ⚠️거부 {label}  {rr.hex()[:20]}")
        else:
            log(f"   0x{cmd:04x} → 0x{rcmd:04x} {label}  {rr.hex()[:20]}")
        return rr

    # 준비 명령들
    send_expect(0x0730, bytes.fromhex("0200000000000000"))
    send_expect(0x0410, (f"Windows,HDPlayer,User,PC,,,_,{time.strftime('%Y-%m-%d_%H:%M:%S')},"
                         f"ethernet_0-{LOCAL_IP}-00:00:00:00:00:00,wireless").encode())
    send_expect(0x000d)
    send_expect(0x040a)
    send_expect(0x000f, struct.pack('<II', total_size, 0), "파일크기선언")

    # ★ 0x0011 = 파일 목록 조회 (D16이 가진 파일 MD5 반환)
    conn.send_cmd(0x0011)
    r1 = conn.recv_packet()
    file_count = 0
    if r1 and len(r1) > 6:
        data = r1[4:]
        md5s = [p.decode('utf-8', 'ignore') for p in data.split(b'\x00') if len(p) == 32]
        file_count = len(md5s)
        log(f"   0x0011 → D16에 파일 {file_count}개 존재")
    else:
        log(f"   0x0011 → 파일 없음/파싱실패")
    # 두 번째 0x0011 (캡처 패턴)
    send_expect(0x0011)

    send_expect(0x0013)

    # ★ 0x0015 = D16 파일 개수만큼 인덱스 [0,1,...,N-1] 전송
    # 내가 보낼 파일 2개(png,xml)를 포함한 총 개수 기준
    # 캡처 규칙: 현재 D16 파일수 기준. 없으면 최소 우리 파일 반영.
    idx_count = file_count if file_count > 0 else 2
    idx_payload = b''.join(struct.pack('<I', i) for i in range(idx_count))
    send_expect(0x0015, idx_payload, f"인덱스[0..{idx_count-1}]")

    # PNG 전송
    send_expect(0x0017, (png_md5 + ".png").encode() + b'\x00', "PNG선언")
    send_expect(0x0019, png_data, "PNG데이터")
    send_expect(0x001b, b"", "PNG종료")

    # XML 전송 (확장자는 .boo — D16이 재생 프로그램으로 인식하는 확장자)
    send_expect(0x0017, (boot_md5 + ".boo").encode() + b'\x00', "XML선언")
    send_expect(0x0019, xml_data, "XML데이터")
    send_expect(0x001b, b"", "XML종료")

    # 재생 트리거
    send_expect(0x001d, b"", "재생1")
    send_expect(0x001f, b"", "재생2")

    log(" [완료] 전송 끝")
    return True


def main():
    text = sys.argv[1] if len(sys.argv) > 1 else "25.3 C"
    print("="*60)
    print(f" HD-D16 텍스트 표시 v8 (직접접속): '{text}'")
    print("="*60)

    # D16의 9527 포트로 직접 TCP 접속
    log(f" [1] D16({DEVICE_IP}:{DEVICE_PORT})로 직접 접속 시도...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10.0)
    try:
        sock.connect((DEVICE_IP, DEVICE_PORT))
    except Exception as e:
        log(f" [실패] 접속 안됨: {e}")
        log("   - D16이 살아있는지 test2로 확인")
        log("   - 방화벽이 아웃바운드를 막는지 확인")
        input("\n[Enter] 종료..."); return
    log(" [2] 접속 성공!")

    conn = Conn(sock)
    try:
        ok = display_text(conn, text)
        print("\n" + "="*60)
        if ok:
            print(" [성공] 모든 명령 정상! D16 화면 확인!")
        else:
            print(" 일부 명령 거부됨. 로그의 ⚠️ 줄을 알려주세요.")
        print("="*60)
    except Exception:
        import traceback; traceback.print_exc()
    finally:
        sock.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n중단됨.")
    input("\n[Enter] 종료...")
