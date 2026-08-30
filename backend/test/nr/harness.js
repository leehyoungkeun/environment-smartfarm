// Node-RED 함수 노드 테스트 하네스.
//
// 자동화 엔진(② 규칙 평가, ④ 시간 스케줄러, ⑤ 스케줄 실행 핸들러)은 사람 없이
// 밤새 모터를 돌리는 코드인데 지금까지 커버리지가 0 이었다. docs/ 의 사본은
// 3~5월 것이라 이미 표류했으므로, 여기서는 **실제로 도는 코드** —
// rpi-files/master/flows.json (RPi 1호에서 동기화) — 에서 함수 본문을 꺼내 실행한다.
// 사본을 테스트하면 통과해도 아무것도 지키지 못한다.
//
// 함수 노드가 쓰는 NR 런타임(node/global/context/flow/env/RED)과 시계·타이머를
// 전부 가짜로 주입한다. 시계는 고정하고 타이머는 손으로 진행시켜, 자정 넘기기나
// duration 역명령 같은 시간 의존 로직을 결정적으로 검증한다.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const FLOWS_PATH = join(here, "..", "..", "..", "rpi-files", "master", "flows.json");

let _flows;
function flows() {
  if (!_flows) _flows = JSON.parse(readFileSync(FLOWS_PATH, "utf8"));
  return _flows;
}

/** 마스터 flows.json 전체 (배선·옵션 검증용) */
export function readFlows() {
  return flows();
}

/** flows.json 에서 function 노드 본문을 id 로 꺼낸다 */
export function functionBody(nodeId) {
  const n = flows().find((x) => x.id === nodeId && x.type === "function");
  if (!n) throw new Error(`flows.json 에 function 노드 ${nodeId} 가 없다 — id 가 바뀌었으면 하네스를 갱신할 것`);
  return { func: n.func, outputs: n.outputs, name: n.name };
}

/** 조작 가능한 시계 + 타이머. NR 함수가 보는 Date/setTimeout 을 전부 이걸로 바꾼다. */
export function makeClock(startIso = "2026-08-29T10:00:00.000Z") {
  let nowMs = Date.parse(startIso);
  const timers = []; // { fireAt, fn, cleared }
  let seq = 0;

  const RealDate = Date;
  // 함수 노드 안의 `new Date()` / `Date.now()` 는 고정 시각을 보고,
  // `new Date(iso)` 처럼 인자가 있으면 진짜 Date 그대로 동작한다.
  function FakeDate(...args) {
    if (args.length === 0) return new RealDate(nowMs);
    return new RealDate(...args);
  }
  FakeDate.now = () => nowMs;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;

  return {
    Date: FakeDate,
    get nowMs() {
      return nowMs;
    },
    setTimeout(fn, ms) {
      const t = { id: ++seq, fireAt: nowMs + (ms || 0), fn, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.cleared = true;
    },
    /** 대기 중인 타이머 (아직 안 울리고 취소 안 된 것) */
    pending() {
      return timers.filter((t) => !t.cleared && !t.fired);
    },
    /** ms 만큼 시간을 진행시키며 도래한 타이머를 순서대로 실행 */
    advance(ms) {
      const until = nowMs + ms;
      for (;;) {
        const due = timers
          .filter((t) => !t.cleared && !t.fired && t.fireAt <= until)
          .sort((a, b) => a.fireAt - b.fireAt || a.id - b.id)[0];
        if (!due) break;
        nowMs = Math.max(nowMs, due.fireAt);
        due.fired = true;
        due.fn();
      }
      nowMs = until;
    },
  };
}

/**
 * 함수 노드 실행 환경을 만든다.
 * 반환된 env 로 여러 번 run() 해도 global/flow/context 스토어가 유지된다
 * (실제 NR 과 같다 — contextStorage=localfilesystem).
 */
export function makeEnv({ clock, globals = {}, flowVars = {}, contextVars = {}, tabEnv = {} } = {}) {
  const c = clock || makeClock();
  const globalStore = new Map(Object.entries(globals));
  const flowStore = new Map(Object.entries(flowVars));
  const contextStore = new Map(Object.entries(contextVars));

  const sent = []; // node.send 로 나간 것 전부, 호출 순서대로
  const warns = [];
  const statuses = [];

  const node = {
    send: (m) => sent.push(m),
    warn: (m) => warns.push(String(m)),
    error: (m) => warns.push("ERROR: " + String(m)),
    status: (s) => statuses.push(s),
  };
  const mkStore = (store) => ({
    get: (k) => store.get(k),
    set: (k, v) => {
      if (v === undefined || v === null) store.delete(k);
      else store.set(k, v);
    },
    keys: () => [...store.keys()],
  });
  const RED = {
    util: {
      cloneMessage: (m) => JSON.parse(JSON.stringify(m ?? {})),
    },
  };

  return {
    clock: c,
    sent,
    warns,
    statuses,
    global: mkStore(globalStore),
    flow: mkStore(flowStore),
    context: mkStore(contextStore),

    /** 함수 노드 본문을 실행하고 return 값을 돌려준다 */
    run(nodeId, msg = {}) {
      const { func } = functionBody(nodeId);
      return this.runCode(func, msg, `nr:${nodeId}`);
    },

    /** 파일(.js)에 담긴 함수 노드 코드를 실행 — 에디터 적용 전 교체본을 미리 검증할 때 */
    runFile(path, msg = {}) {
      return this.runCode(readFileSync(path, "utf8"), msg, `file:${path}`);
    },

    runCode(func, msg, filename) {
      const script = new vm.Script(
        "(function (msg, node, global, context, flow, env, RED, setTimeout, clearTimeout, setInterval, clearInterval, Date) {\n" +
          func +
          "\n})",
        { filename }
      );
      const fn = script.runInNewContext({ console });
      return fn(
        msg,
        node,
        mkStore(globalStore),
        mkStore(contextStore),
        mkStore(flowStore),
        { get: (k) => tabEnv[k] },
        RED,
        (f, ms) => c.setTimeout(f, ms),
        (t) => c.clearTimeout(t),
        () => {
          throw new Error("setInterval 은 함수 노드에서 쓰지 않기로 했다");
        },
        () => {},
        c.Date
      );
    },
  };
}

/** node.send 로 나간 것들 중, 다중 출력 배열의 idx 번째 포트로 나간 msg 만 모은다 */
export function port(sent, idx) {
  const out = [];
  for (const s of sent) {
    if (!Array.isArray(s)) {
      if (idx === 0 && s) out.push(s);
      continue;
    }
    const slot = s[idx];
    if (Array.isArray(slot)) out.push(...slot);
    else if (slot) out.push(slot);
  }
  return out;
}
