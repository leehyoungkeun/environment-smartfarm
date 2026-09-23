# -*- coding: utf-8 -*-
"""오류 보고(GlitchTip) — 2026-09-23. 표준노드 드라이버만 센트리에 빠져 있었다.

보고 자체가 드라이버를 멈추면 안 되므로, 어떤 실패에도 예외가 밖으로 나가지 않는 것이 핵심이다.
sentry_sdk 가 설치되지 않은 환경(개발 PC)에서도 이 테스트는 그대로 돈다.
"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import obs  # noqa: E402


def env_file(text):
    fd, p = tempfile.mkstemp(suffix=".env")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    return p


class FakeScope:
    def __init__(self): self.tags = {}
    def set_tag(self, k, v): self.tags[k] = v
    def __enter__(self): return self
    def __exit__(self, *a): return False


class FakeSentry:
    """sentry_sdk 대역 — 보낸 것만 기록한다."""
    def __init__(self, fail=False):
        self.sent = []
        self.scope = FakeScope()
        self.fail = fail
    def push_scope(self):
        if self.fail:
            raise RuntimeError("스코프 실패")
        return self.scope
    def capture_exception(self, exc): self.sent.append(exc)


class LoadDsn(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("GLITCHTIP_DSN", None)

    def test_env_파일에서_읽는다(self):
        p = env_file("FARM_ID=farm_0001\nGLITCHTIP_DSN=https://k@sentry.example/3\nOTHER=1\n")
        self.assertEqual(obs._load_dsn(p), "https://k@sentry.example/3")
        os.unlink(p)

    def test_파일이_없으면_환경변수로(self):
        os.environ["GLITCHTIP_DSN"] = "https://env@sentry.example/9"
        self.assertEqual(obs._load_dsn("/없는/경로/.env"), "https://env@sentry.example/9")

    def test_어디에도_없으면_빈값(self):
        self.assertEqual(obs._load_dsn("/없는/경로/.env"), "")


class Init(unittest.TestCase):
    def setUp(self):
        obs._sentry = None

    def tearDown(self):
        obs._sentry = None
        os.environ.pop("GLITCHTIP_DSN", None)

    def test_DSN_없으면_끈다(self):
        self.assertFalse(obs.init(env_path="/없는/경로/.env"))
        self.assertFalse(obs.enabled())

    def test_DSN_없을_때_capture_는_조용히_무시(self):
        self.assertFalse(obs.capture(RuntimeError("x")))


class Capture(unittest.TestCase):
    def setUp(self):
        self.fake = FakeSentry()
        obs._sentry = self.fake

    def tearDown(self):
        obs._sentry = None

    def test_예외를_보낸다(self):
        e = RuntimeError("포트 사라짐")
        self.assertTrue(obs.capture(e, where="poll_loop", unit=2))
        self.assertEqual(self.fake.sent, [e])

    def test_태그가_붙는다(self):
        obs.capture(RuntimeError("x"), where="local_snapshot", unit=1)
        self.assertEqual(self.fake.scope.tags["where"], "local_snapshot")
        self.assertEqual(self.fake.scope.tags["unit"], "1")

    def test_값이_None_인_태그는_안_붙인다(self):
        obs.capture(RuntimeError("x"), where="api_get", unit=None)
        self.assertNotIn("unit", self.fake.scope.tags)

    def test_보고가_실패해도_예외를_밖으로_안_낸다(self):
        obs._sentry = FakeSentry(fail=True)
        self.assertFalse(obs.capture(RuntimeError("x")))   # 던지지 않고 False


class Release(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("GIT_SHA", None)

    def test_GIT_SHA_우선(self):
        os.environ["GIT_SHA"] = "abc1234"
        self.assertEqual(obs._release(), "ks3267d@abc1234")

    def test_version_파일(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "version.txt"), "w", encoding="utf-8") as f:
            f.write("deadbee\n")
        self.assertEqual(obs._release(d), "ks3267d@deadbee")

    def test_둘_다_없으면_기본값(self):
        self.assertEqual(obs._release(tempfile.mkdtemp()), "ks3267d@1.0.0")


class WiredIn(unittest.TestCase):
    """드라이버가 실제로 보고를 부르는지 — 모듈만 있고 아무도 안 부르면 의미가 없다."""

    def _src(self, name):
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        with open(p, encoding="utf-8") as f:
            return f.read()

    def test_데몬_시작_시_init(self):
        self.assertIn('obs.init("ks3267d")', self._src("ks3267d.py"))

    def test_폴링_루프와_로컬저장_실패를_보고한다(self):
        s = self._src("ks3267d.py")
        self.assertIn('where="poll_loop"', s)
        self.assertIn('where="local_snapshot"', s)

    def test_REST_500_을_보고한다(self):
        self.assertIn('where="api_get"', self._src("api.py"))

    def test_requirements_에_sentry_sdk(self):
        self.assertIn("sentry-sdk", self._src("requirements.txt"))


if __name__ == "__main__":
    unittest.main()
