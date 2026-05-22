#!/usr/bin/env python3
"""
Patch NR 10-mqtt.js — chunked re-subscribe (8 topics per chunk, 250ms delay).
Replaces the synchronous re-subscribe for-loop with a chunked async version
that respects AWS IoT 8-topic-per-SUBSCRIBE-packet limit.
"""
import re, sys

PATH = "/usr/lib/node_modules/node-red/node_modules/@node-red/nodes/core/network/10-mqtt.js"

with open(PATH, 'r', encoding='utf-8') as f:
    src = f.read()

ORIGINAL = """                        // Re-subscribe to stored topics
                        for (var s in node.subscriptions) {
                            if (node.subscriptions.hasOwnProperty(s)) {
                                for (var r in node.subscriptions[s]) {
                                    if (node.subscriptions[s].hasOwnProperty(r)) {
                                        node.subscribe(node.subscriptions[s][r])
                                    }
                                }
                            }
                        }"""

PATCHED = """                        // Re-subscribe to stored topics — CHUNKED for AWS IoT 8-topic-per-SUBSCRIBE-packet limit
                        // PATCH: chunked subscribe (8 per group, 250ms stagger between groups)
                        {
                            const __allSubs = [];
                            for (var s in node.subscriptions) {
                                if (node.subscriptions.hasOwnProperty(s)) {
                                    for (var r in node.subscriptions[s]) {
                                        if (node.subscriptions[s].hasOwnProperty(r)) {
                                            __allSubs.push(node.subscriptions[s][r]);
                                        }
                                    }
                                }
                            }
                            const __CHUNK = 8;
                            const __DELAY = 250;
                            const __subscribeChunk = function(startIdx) {
                                if (startIdx >= __allSubs.length) return;
                                const end = Math.min(startIdx + __CHUNK, __allSubs.length);
                                for (var i = startIdx; i < end; i++) {
                                    try { node.subscribe(__allSubs[i]); } catch (e) { node.error("subscribe chunk error: " + e.toString()); }
                                }
                                if (end < __allSubs.length) {
                                    setTimeout(function(){ __subscribeChunk(end); }, __DELAY);
                                }
                            };
                            __subscribeChunk(0);
                        }"""

if ORIGINAL not in src:
    print("ERROR: original code block not found — patch already applied or NR version differs", file=sys.stderr)
    sys.exit(1)

if PATCHED in src:
    print("ALREADY PATCHED — skipping", file=sys.stderr)
    sys.exit(0)

new_src = src.replace(ORIGINAL, PATCHED, 1)
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(new_src)

print(f"PATCHED — size {len(src)} -> {len(new_src)} bytes")
