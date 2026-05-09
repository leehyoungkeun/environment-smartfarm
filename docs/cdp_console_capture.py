#!/usr/bin/env python3
"""농장 chromium console 로그 캡처 — DevTools Protocol 사용"""
import asyncio
import json
import sys
import urllib.request

try:
    import websockets
except ImportError:
    print("ERROR: websockets module missing", file=sys.stderr)
    sys.exit(1)


async def capture(duration_sec=60, filter_keyword=None):
    targets = json.loads(urllib.request.urlopen("http://localhost:9222/json").read())
    page = next((t for t in targets if t["type"] == "page" and "smartfarm" in (t.get("title", "") + t.get("url", "")).lower()), None)
    if not page:
        page = next(t for t in targets if t["type"] == "page")
    ws_url = page["webSocketDebuggerUrl"]
    print(f"[CDP] connecting to {page['title']} ({page['url']})", flush=True)

    msg_id = 0
    async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
        for method in ("Runtime.enable", "Console.enable", "Log.enable"):
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method}))

        end = asyncio.get_event_loop().time() + duration_sec
        while asyncio.get_event_loop().time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=2)
            except asyncio.TimeoutError:
                continue
            data = json.loads(raw)
            if data.get("method") != "Runtime.consoleAPICalled":
                continue
            params = data.get("params", {})
            level = params.get("type", "log")
            args = params.get("args", [])
            parts = []
            for a in args:
                if "value" in a:
                    parts.append(str(a["value"]))
                elif "description" in a:
                    parts.append(a["description"])
                elif "preview" in a:
                    parts.append(json.dumps(a["preview"]))
            text = " ".join(parts)
            if filter_keyword and filter_keyword not in text:
                continue
            ts = params.get("timestamp", 0) / 1000
            print(f"[{level}] t={ts:.1f}s  {text}", flush=True)


if __name__ == "__main__":
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    keyword = sys.argv[2] if len(sys.argv) > 2 else None
    asyncio.run(capture(duration, keyword))
