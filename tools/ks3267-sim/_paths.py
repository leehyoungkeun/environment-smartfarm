# -*- coding: utf-8 -*-
"""공유 코어(ks3267core)를 import 경로에 올린다 — 시뮬레이터는 드라이버 패키지의 공식을 그대로 쓴다."""
import os, sys
_here = os.path.dirname(os.path.abspath(__file__))
# 리포 배치(tools/ks3267-sim ↔ rpi-files/master/ks3267d) 와 RPi 배치(ks3267-sim ↔ ks3267d 형제) 둘 다 지원
for _cand in (os.path.join(_here, "..", "..", "rpi-files", "master", "ks3267d"), os.path.join(_here, "..", "ks3267d")):
    _core = os.path.normpath(_cand)
    if os.path.isdir(os.path.join(_core, "ks3267core")):
        if _core not in sys.path:
            sys.path.insert(0, _core)
        break
