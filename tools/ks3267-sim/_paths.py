# -*- coding: utf-8 -*-
"""공유 코어(ks3267core)를 import 경로에 올린다 — 시뮬레이터는 드라이버 패키지의 공식을 그대로 쓴다."""
import os, sys
_core = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "rpi-files", "master", "ks3267d"))
if _core not in sys.path:
    sys.path.insert(0, _core)
