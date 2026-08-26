#!/usr/bin/env python3
"""D16 전광판 자동 온습도 표시 daemon.
NR 로그에서 최신 Modbus 실측 → config 반영 → D16 전송.
config: /home/lhk/smartfarm/d16-display/config.json (없으면 기본값).
"""
import time
import subprocess
import re
import socket
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── 오류 보고 (GlitchTip/Sentry) ────────────────────────────
# 2026-08-26 추가. 그전까지 이 daemon 의 오류는 어디에도 보고되지 않았다 —
# 랜선이 빠진 4주 동안 [LOOP ERR] 를 로그에만 쏟았고, 사람이 로그를 직접
# 읽고서야 고장을 알았다.
#
# DSN 은 rpi-server/.env 를 공유한다(같은 농장, 같은 프로젝트).
# 값이 없으면 조용히 건너뛴다 — 보고 실패가 전광판 동작을 막으면 안 된다.
try:
    import sentry_sdk

    def _load_dsn():
        try:
            with open("/home/lhk/smartfarm/rpi-server/.env", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("GLITCHTIP_DSN="):
                        return line.split("=", 1)[1].strip()
        except OSError:
            pass
        return os.environ.get("GLITCHTIP_DSN", "")

    _dsn = _load_dsn()
    if _dsn:
        sentry_sdk.init(
            dsn=_dsn,
            environment=os.environ.get("NODE_ENV", "production"),
            release="d16-display@1.0.0",
            # 같은 오류는 GlitchTip 이 하나의 이슈로 묶지만,
            # 초당 여러 번 나는 것까지 보낼 이유는 없어 표본만 보낸다.
            sample_rate=0.25,
            traces_sample_rate=0.0,
            send_default_pii=False,
        )
        sentry_sdk.set_tag("service", "d16-display")
        sentry_sdk.set_tag("farm_id", os.environ.get("FARM_ID", "farm_0001"))
        sentry_sdk.set_tag("hostname", socket.gethostname())
    else:
        sentry_sdk = None
except Exception:
    sentry_sdk = None

from huidu_d16_display import Conn, display_text, DEVICE_IP, DEVICE_PORT

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, 'config.json')
LOG_PATH = '/home/lhk/.pm2/logs/node-red-out.log'
PATTERN = re.compile(r'Modbus 실측: ([\d.]+)°C, ([\d.]+)%RH')

DEFAULTS = {
    'enabled': True,
    'ip': DEVICE_IP,
    'interval': 300,
    'items': ['temp', 'humidity'],
    'format': '{temp:.1f}C {humid:.0f}%',
}


def load_config():
    """config.json 읽기 + 기본값 병합."""
    cfg = dict(DEFAULTS)
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH) as f:
                cfg.update(json.load(f))
    except Exception as e:
        print(f'[CFG ERR] {e}', flush=True)
    return cfg


def fetch_latest():
    """NR 로그에서 최신 실측 값 파싱."""
    try:
        result = subprocess.run(
            ['tail', '-n', '2000', LOG_PATH],
            capture_output=True, text=True, timeout=10, errors='ignore'
        )
        for line in reversed(result.stdout.split('\n')):
            m = PATTERN.search(line)
            if m:
                return float(m.group(1)), float(m.group(2))
    except Exception as e:
        print(f'[FETCH ERR] {e}', flush=True)
    return None, None


def format_text(t, h, fmt):
    if t is None or h is None:
        return '-.- C -- %'
    try:
        return fmt.format(temp=t, humid=h, time=time.strftime('%H:%M'))
    except Exception:
        return f'{t:.1f}C {h:.0f}%'


def send_to_d16(text, ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(10.0)
    try:
        sock.connect((ip, DEVICE_PORT))
        conn = Conn(sock)
        return display_text(conn, text)
    finally:
        sock.close()


def main():
    print(f'[START] D16 daemon config={CONFIG_PATH}', flush=True)
    while True:
        cfg = load_config()
        try:
            if not cfg.get('enabled', True):
                print(f'[{time.strftime("%H:%M:%S")}] disabled — skip', flush=True)
                time.sleep(60)
                continue
            t, h = fetch_latest()
            text = format_text(t, h, cfg.get('format', DEFAULTS['format']))
            ip = cfg.get('ip') or DEVICE_IP
            ok = send_to_d16(text, ip)
            stamp = time.strftime('%Y-%m-%d %H:%M:%S')
            print(f'[{stamp}] {text} -> {"OK" if ok else "FAIL"} (ip={ip})', flush=True)
        except Exception as e:
            print(f'[LOOP ERR] {e}', flush=True)
            if sentry_sdk is not None:
                # 로그에만 남기지 않고 보고한다 — 4주간 아무도 몰랐던 그 오류다
                sentry_sdk.capture_exception(e)
        time.sleep(max(30, int(cfg.get('interval', 300))))


if __name__ == '__main__':
    main()
