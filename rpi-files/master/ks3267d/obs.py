# -*- coding: utf-8 -*-
"""오류 보고 — GlitchTip(sentry.smartgreen.kr). 표준노드 드라이버가 조용히 죽는 것을 막는다.

2026-09-23: 백엔드·프론트·rpi-server·시스템API·D16 은 연결돼 있었는데 이 드라이버만 빠져 있었다.
KS X 3267 검정의 핵심 구성품이고 30일 데이터 창을 지켜야 하는데, 예외로 죽어도 pm2 로그에만
남았다 (창이 끊기는 것 자체는 KsDataWindowBroken 경보가 따로 잡는다).

원칙
  · 보고가 드라이버 동작을 막으면 안 된다 — 모든 경로에서 예외를 삼킨다.
  · sentry_sdk 가 없거나 DSN 이 비면 조용히 끈다 (개발 PC·시뮬레이터 환경).
  · 예상된 실패(Modbus 타임아웃·노드 무응답)는 보내지 않는다. 그건 상태이지 오류가 아니다.
"""
import os
import socket

_ENV_PATH = "/home/lhk/smartfarm/rpi-server/.env"   # DSN 은 rpi-server 와 공유 (같은 농장·같은 프로젝트)
_sentry = None


def _load_dsn(env_path=_ENV_PATH):
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                if line.startswith("GLITCHTIP_DSN="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return os.environ.get("GLITCHTIP_DSN", "")


def _release(base_dir=None):
    """릴리스 = 배포된 커밋. 배포 스크립트가 version.txt 를 쓰고, 없으면 기본값."""
    sha = os.environ.get("GIT_SHA", "").strip()
    if not sha:
        d = base_dir or os.path.dirname(os.path.abspath(__file__))
        try:
            with open(os.path.join(d, "version.txt"), encoding="utf-8") as f:
                sha = f.read().strip()
        except OSError:
            sha = ""
    return "ks3267d@" + (sha or "1.0.0")


def init(service="ks3267d", env_path=_ENV_PATH):
    """DSN 이 있을 때만 켠다. 켜졌으면 True."""
    global _sentry
    dsn = _load_dsn(env_path)
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        return False
    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get("NODE_ENV", "production"),
            release=_release(),
            traces_sample_rate=0.0,
            send_default_pii=False,
        )
        sentry_sdk.set_tag("service", service)
        sentry_sdk.set_tag("farm_id", os.environ.get("FARM_ID", "farm_0001"))
        sentry_sdk.set_tag("hostname", socket.gethostname())
        _sentry = sentry_sdk
        return True
    except Exception:
        _sentry = None
        return False


def capture(exc, **tags):
    """예상 못 한 예외를 보고한다. 보고 실패는 삼킨다 — 드라이버가 우선."""
    if _sentry is None:
        return False
    try:
        with _sentry.push_scope() as scope:
            for k, v in tags.items():
                if v is not None:
                    scope.set_tag(k, str(v))
            _sentry.capture_exception(exc)
        return True
    except Exception:
        return False


def enabled():
    return _sentry is not None
