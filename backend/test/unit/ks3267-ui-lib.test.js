// 설정 UI(표준노드 탭)·제어판 배지가 쓰는 순수 로직 — frontend/src/lib/ks3267.js 를 그대로 실행한다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(join(here, "..", "..", "..", "frontend", "src", "lib", "ks3267.js")).href);

const ACT = { unit: 1, kind: "actuator", supported: true, default_map: true, protocol_version: 10, channels: 24, serial: 1234, company_code: 0, product_type: 2, product_code: 1, notes: [],
  devices: [
    { index: 3, code: 102, kind: "switch", n: 3, name: "스위치3", level: 1, supported: true, status: { opid: 211, status: 212, remain: [213, 214] }, cmd: { cmd: 511, opid: 512, time: [513, 514] } },
    { index: 18, code: 112, kind: "opener", n: 2, name: "개폐기2", level: 1, supported: true, status: { opid: 271, status: 272, remain: [273, 274] }, cmd: { cmd: 571, opid: 572, time: [573, 574] } },
    { index: 5, code: 103, kind: "switch", n: 5, name: "switch5", supported: false, note: "디바이스 코드 103 — 레벨2" },
  ] };
const SEN = { unit: 2, kind: "sensor", supported: true, default_map: true, protocol_version: 10, channels: 30, devices: [
  { index: 1, code: 1, name: "온도", value_reg: 203, status_reg: 205 }, { index: 4, code: 4, name: "습도", value_reg: 212, status_reg: 214 } ] };

describe("describeStatus — 표준 상태코드", () => {
  test("대표 코드", () => {
    assert.equal(lib.describeStatus(0).text, "정상"); assert.equal(lib.describeStatus(201).tone, "on");
    assert.equal(lib.describeStatus(301).text, "열리는 중"); assert.equal(lib.describeStatus(103).tone, "warn");
    assert.equal(lib.describeStatus(950).text, "제조사 오류 950"); assert.equal(lib.describeStatus("x").text, "—");
    assert.equal(lib.describeStatus(null).text, "—");
  });
});

describe("프로필 검증", () => {
  test("올바른 스위치/개폐기 통과", () => {
    assert.deepEqual(lib.validateKsProfile({ protocol: "ks3267", unit: 1, kind: "switch", n: 16 }), []);
    assert.deepEqual(lib.validateKsProfile({ protocol: "ks3267", unit: 247, kind: "opener", n: 8 }), []);
  });
  test("범위 밖은 막는다 — 개폐기 9, 스위치 17, unit 0", () => {
    assert.ok(lib.validateKsProfile({ protocol: "ks3267", unit: 1, kind: "opener", n: 9 }).length);
    assert.ok(lib.validateKsProfile({ protocol: "ks3267", unit: 1, kind: "switch", n: 17 }).length);
    assert.ok(lib.validateKsProfile({ protocol: "ks3267", unit: 0, kind: "switch", n: 1 }).length);
    assert.ok(lib.validateKsProfile({ unitId: 2, address: 0 }).length, "vendor 프로필은 표준 검증 대상이 아니다");
  });
  test("센서 매핑 1~30", () => {
    assert.deepEqual(lib.validateKsSensor({ unit: 2, index: 30 }), []);
    assert.ok(lib.validateKsSensor({ unit: 2, index: 31 }).length);
  });
  test("라벨", () => {
    assert.equal(lib.ksDeviceLabel({ protocol: "ks3267", unit: 1, kind: "opener", n: 2 }), "표준 U1 개폐기2");
    assert.equal(lib.ksDeviceLabel({ unitId: 2 }), "");
  });
});

describe("discoveryRows / nodeSummary", () => {
  test("구동기: 지원·미지원 구분 + 레지스터 표기", () => {
    const rows = lib.discoveryRows(ACT);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].registers, "상태 211~214 / 명령 511~514");
    assert.equal(rows[2].supported, false); assert.match(rows[2].note, /레벨2/);
  });
  test("센서: 순번=n, 값/상태 레지스터", () => {
    const rows = lib.discoveryRows(SEN);
    assert.equal(rows[0].n, 1); assert.equal(rows[0].registers, "값 203~204 / 상태 205"); assert.equal(rows[1].kind, "sensor");
  });
  test("요약", () => {
    const s = lib.nodeSummary(ACT);
    assert.equal(s.kind, "구동기 노드"); assert.equal(s.defaultMap, true); assert.equal(s.product, "2/1");
    assert.equal(lib.nodeSummary(null), null); assert.deepEqual(lib.discoveryRows(undefined), []);
  });
});

describe("nodeReadRows — §5.1.3 b·c) 노드 데이터 읽기 시험표", () => {
  const ST_ACT = { t: 1788500000, node_status: 0, kind: "actuator", devices: { 3: { status: 201, remain: 25, opid: 9 }, 18: { status: 0, remain: 0, opid: 0 }, 5: { status: 777 } } };
  const ST_SEN = { t: 1788500000, node_status: 0, kind: "sensor", sensors: { 1: { value: 28.8, status: 0, code: 1 }, 4: { value: 60.1, status: 102, code: 2 } } };
  test("구동기: 노드 상태 0 정상 ✓, 스위치3 201 켜짐+남은 25s ✓, 미정의 코드 777 ✗", () => {
    const r = lib.nodeReadRows(ACT, ST_ACT);
    assert.equal(r.node.code, 0); assert.equal(r.node.meaning, "정상"); assert.equal(r.node.ok, true);
    const sw3 = r.rows.find(x => x.index === 3); assert.equal(sw3.code, 201); assert.equal(sw3.meaning, "켜짐"); assert.equal(sw3.remain, 25); assert.equal(sw3.opid, 9); assert.equal(sw3.ok, true);
    const bad = r.rows.find(x => x.index === 5); assert.equal(bad.ok, false, "표에 없는 777 은 부적절"); assert.match(bad.meaning, /알 수 없음/);
    assert.equal(r.fail, 1); assert.equal(r.readAt.getTime(), 1788500000 * 1000);
  });
  test("센서: 관측치+단위, 상태 102(보정 필요)도 정의된 값이라 ✓, 값 없는 센서는 미읽음(null)", () => {
    const r = lib.nodeReadRows(SEN, ST_SEN);
    const t1 = r.rows.find(x => x.index === 1); assert.equal(t1.value, 28.8); assert.equal(t1.unit, "°C"); assert.equal(t1.ok, true);
    const h1 = r.rows.find(x => x.index === 4); assert.equal(h1.code, 102); assert.equal(h1.meaning, "보정 필요"); assert.equal(h1.unit, "%"); assert.equal(h1.ok, true);
    assert.equal(r.fail, 0);
  });
  test("센서 관측치가 숫자가 아니면 ✗ (변이 프로브)", () => {
    const r = lib.nodeReadRows(SEN, { t: 1, node_status: 0, kind: "sensor", sensors: { 1: { value: "NaN?", status: 0, code: 1 } } });
    assert.equal(r.rows.find(x => x.index === 1).ok, false);
  });
  test("노드 응답 없음(timeout) → 노드 판정 null·의미 '응답 없음', 행은 전부 미읽음; node 없으면 null", () => {
    const r = lib.nodeReadRows(ACT, { error: "timeout" });
    assert.equal(r.node.ok, null); assert.equal(r.node.meaning, "응답 없음"); assert.ok(r.rows.every(x => x.ok === null)); assert.equal(r.unread, r.rows.length);
    assert.equal(lib.nodeReadRows(null, ST_ACT), null);
  });
});

describe("ksRemainNow — 📐 배지 로컬 카운트다운", () => {
  test("읽은 시각 이후 흐른 만큼 뺀다: remain 12 @t → 5초 뒤 7", () => {
    assert.equal(lib.ksRemainNow({ remain: 12, t: 1000 }, 1005_000), 7);
  });
  test("클램프: 시계 편차로 미래 시각이어도 remain 초과 안 함, 다 흐르면 0", () => {
    assert.equal(lib.ksRemainNow({ remain: 12, t: 1000 }, 990_000), 12, "브라우저 시계가 RPi 보다 느려도 remain 을 넘지 않는다");
    assert.equal(lib.ksRemainNow({ remain: 12, t: 1000 }, 1020_000), 0);
  });
  test("t 없음/0 이면 remain 그대로, remain 0·없음이면 0 (변이 프로브)", () => {
    assert.equal(lib.ksRemainNow({ remain: 9 }, 5_000_000), 9);
    assert.equal(lib.ksRemainNow({ remain: 0, t: 1000 }, 1001_000), 0);
    assert.equal(lib.ksRemainNow(null, 1), 0);
  });
});

describe("ksAnchorEnd / ksRemainFromEnd — 규칙적 카운트다운 앵커", () => {
  test("첫 샘플로 종료 시각 고정, 1.5초 이내 흔들리는 후속 샘플은 앵커 유지", () => {
    const a = lib.ksAnchorEnd(null, 12, 100_000);            // 종료 112_000
    assert.equal(a, 112_000);
    assert.equal(lib.ksAnchorEnd(a, 10, 102_400), a, "샘플 위상 +0.4s 흔들림 → 유지");
    assert.equal(lib.ksAnchorEnd(a, 9, 102_300), a, "정수 초 반올림 차이(종료 111_300, 0.7s) → 유지");
  });
  test("재명령처럼 크게 바뀌면 새 앵커, remain 0 이면 해제", () => {
    const a = lib.ksAnchorEnd(null, 3, 100_000);
    assert.equal(lib.ksAnchorEnd(a, 12, 101_000), 113_000, "3초 남은 상태에서 12초 재명령 → 재고정");
    assert.equal(lib.ksAnchorEnd(a, 0, 101_000), null);
    assert.equal(lib.ksAnchorEnd(null, 0, 1), null);
  });
  test("표시는 ceil — 초 경계에서만 바뀌고 0 에서 끝난다 (변이 프로브: round/floor 면 실패)", () => {
    const end = 112_000;
    assert.equal(lib.ksRemainFromEnd(end, 100_000), 12);
    assert.equal(lib.ksRemainFromEnd(end, 100_250), 12);
    assert.equal(lib.ksRemainFromEnd(end, 100_999), 12);
    assert.equal(lib.ksRemainFromEnd(end, 101_000), 11);
    assert.equal(lib.ksRemainFromEnd(end, 111_600), 1);
    assert.equal(lib.ksRemainFromEnd(end, 112_000), 0);
    assert.equal(lib.ksRemainFromEnd(end, 120_000), 0);
    assert.equal(lib.ksRemainFromEnd(null, 1), 0);
  });
  test("앵커가 유지되면 폴링 샘플이 와도 카운트다운이 끊기지 않는다 (시나리오)", () => {
    let a = null; const seen = []; let samples = 0;
    // 노드의 진짜 종료 112_000. 2초마다 폴링하되 위상이 +0.25s / +0.75s 로 번갈아 흔들리고(정수 초 반올림 포함), 250ms 마다 표시
    for (let t = 100_250; t <= 112_500; t += 250) {
      const phase = (t - 100_250) % 2000;
      if (phase === 0 || phase === 500) { a = lib.ksAnchorEnd(a, Math.round((112_000 - t) / 1000), t); samples++; }
      const v = lib.ksRemainFromEnd(a, t); if (seen[seen.length - 1] !== v) seen.push(v);
    }
    assert.ok(samples >= 12, "폴링 샘플이 충분히 들어가야 시나리오가 의미 있다: " + samples);
    assert.deepEqual(seen, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0], "건너뜀·되돌림 없이 1씩 감소");
  });
});

describe("샘플 나이 보정 — 20→19→20 재시작·OFF 후 부활 재현", () => {
  test("ksSampleAgeSec: RPi now − t, now 없으면 0", () => {
    assert.ok(Math.abs(lib.ksSampleAgeSec(1000.6, { t: 998.5 }) - 2.1) < 1e-9);
    assert.equal(lib.ksSampleAgeSec(undefined, { t: 998.5 }), 0);
    assert.equal(lib.ksSampleAgeSec(990, { t: 998.5 }), 0, "음수 나이는 0");
  });
  test("사고 1: 클릭 앵커 20s, 2.5초 뒤 '2초 전 폴링된 remain 20' 샘플 → 나이 보정하면 앵커 유지(재시작 없음)", () => {
    const click = 100_000; const a = lib.ksAnchorEnd(null, 20, click);      // 120_000
    const now = click + 2500;
    assert.notEqual(lib.ksAnchorEnd(a, 20, now), a, "보정 없이는 122_500 으로 재고정된다 (사고 재현)");
    assert.equal(lib.ksAnchorFromSample(a, 20, 2.0, now), a, "나이 2초 보정 → 120_500, 차이 0.5s → 유지");
  });
  test("사고 2: OFF 뒤 도착한 옛 샘플(remain 12, 명령 이전에 폴링)은 stale → 앵커 부활 금지", () => {
    const off = 100_000, now = off + 900;
    assert.equal(lib.ksSampleIsStaleForCommand(2.0, off, now), true, "샘플 시각 = 98_900 < OFF 시각");
    assert.equal(lib.ksSampleIsStaleForCommand(0.2, off, now), false, "OFF 뒤 0.7초에 찍힌 샘플은 유효");
    assert.equal(lib.ksSampleIsStaleForCommand(0.5, 0, now), false, "명령 이력 없으면 항상 유효");
  });
  test("나이가 remain 을 넘으면(이미 끝난 샘플) 앵커 null", () => {
    assert.equal(lib.ksAnchorFromSample(123, 1, 1.5, 100_000), null);
  });
});

describe("ksMotionProgress — 레벨1 개폐기 진행(시간)·위치 추정", () => {
  const m = { direction: 'open', startAt: 100_000, totalSec: 12, startPos: 20 };
  test("시간 진행은 fullSec 없어도 계산, 위치는 undefined", () => {
    const p = lib.ksMotionProgress(m, 106_000, null);
    assert.equal(p.percent, 50); assert.equal(p.remainSec, 6); assert.equal(p.actualPos, undefined);
  });
  test("완전 개폐 30초면 12초 열기 = +40% → 20 → 60 (절반 시점 40)", () => {
    assert.equal(lib.ksMotionProgress(m, 106_000, 30).actualPos, 40);
    assert.equal(lib.ksMotionProgress(m, 112_000, 30).actualPos, 60);
    assert.equal(lib.ksMotionProgress(m, 130_000, 30).actualPos, 60, "총 시간 넘어도 더 안 움직인다");
  });
  test("닫기는 감소, 0~100 클램프 (변이 프로브)", () => {
    const c = { direction: 'close', startAt: 100_000, totalSec: 12, startPos: 10 };
    assert.equal(lib.ksMotionProgress(c, 106_000, 30).actualPos, 0, "10 − 20 → 0 클램프");
    assert.equal(lib.ksMotionProgress({ ...m, startPos: 90 }, 112_000, 30).actualPos, 100);
  });
  test("motion 없음 → null, 총시간 미정 → 방향만 있는 미정 객체(클릭 즉시 '여는 중' 표시용)", () => {
    assert.equal(lib.ksMotionProgress(null, 1, 30), null);
    const p = lib.ksMotionProgress({ ...m, totalSec: 0 }, 1, 30);
    assert.equal(p.indeterminate, true); assert.equal(p.direction, 'open'); assert.equal(p.remainSec, undefined); assert.equal(p.actualPos, undefined);
  });
});

describe("ksNeededSec / ksReachedEnd — 끝까지 필요한 시간·끝 도달 (과주행 방지)", () => {
  test("82% 에서 열기, 완전 30초 → 6초(5.4 올림); 40% 에서 닫기 → 12초", () => {
    assert.equal(lib.ksNeededSec('open', 82, 30), 6);
    assert.equal(lib.ksNeededSec('close', 40, 30), 12);
  });
  test("이미 끝이면 0, 정보 없으면 null(일반 301/302 로), 최소 1초 (변이 프로브)", () => {
    assert.equal(lib.ksNeededSec('open', 100, 30), 0);
    assert.equal(lib.ksNeededSec('close', 0, 30), 0);
    assert.equal(lib.ksNeededSec('open', 50, null), null);
    assert.equal(lib.ksNeededSec('open', undefined, 30), null);
    assert.equal(lib.ksNeededSec('open', 99.9, 30), 1);
  });
  test("끝 도달 판정", () => {
    assert.equal(lib.ksReachedEnd('open', 100), true); assert.equal(lib.ksReachedEnd('open', 99), false);
    assert.equal(lib.ksReachedEnd('close', 0), true); assert.equal(lib.ksReachedEnd('close', undefined), false);
  });
});

describe("nodeInfoRows — §5.1.2 c) 노드정보 1~8 시험표", () => {
  // 디폴트 완전 일치 노드 (센서 타입1, 채널 30)
  const GOOD = { cert_authority: 0, company_code: 0, product_type: 1, product_code: 0, protocol_version: 10, channels: 30, serial: 987654 };
  test("전 항목 일치 판정 + 시리얼은 참고", () => {
    const r = lib.nodeInfoRows(GOOD);
    assert.equal(r.length, 7);
    assert.deepEqual(r.map(x => x.label), ["기관코드", "회사코드", "제품타입", "제품코드", "프로토콜버전", "채널수", "시리얼번호"]);
    assert.ok(r.slice(0, 6).every(x => x.ok === true), "1~6 모두 일치여야 함");
    assert.equal(r[5].expect, "30 (타입1)");       // 채널수 기대: 타입1→30
    assert.equal(r[6].ok, null); assert.equal(r[6].read, "987654"); // 시리얼 참고
  });
  test("구동기 타입2 → 채널수 기대 24", () => {
    const r = lib.nodeInfoRows({ ...GOOD, product_type: 2, channels: 24 });
    assert.equal(r[5].expect, "24 (타입2)"); assert.equal(r[5].ok, true);
  });
  test("불일치 낱낱이 잡는다 — 기관≠0·버전101·채널 어긋남", () => {
    const r = lib.nodeInfoRows({ cert_authority: 5, company_code: 0, product_type: 2, product_code: 0, protocol_version: 101, channels: 30, serial: 1 });
    assert.equal(r[0].ok, false, "기관코드 5 → 불일치");   // 변이 프로브: eq() 가 0 만 통과해야
    assert.equal(r[4].ok, false, "버전 101 → 10 아님");
    assert.equal(r[5].ok, false, "타입2인데 채널 30 → 24 기대 불일치");
    assert.equal(r[2].ok, true, "제품타입 2 는 1또는2 → 일치");
  });
  test("값 없음/누락은 판정 불일치·표시 —, node 없으면 빈 배열", () => {
    const r = lib.nodeInfoRows({ product_type: 1 });
    assert.equal(r[0].read, "—"); assert.equal(r[0].ok, false);
    assert.deepEqual(lib.nodeInfoRows(null), []);
  });
});

describe("mappingIndex — 우리 장치 ↔ 표준 디바이스", () => {
  const houses = [{ houseId: "house_0001", name: "1동",
    devices: [{ deviceId: "fan1", name: "환풍기", modbus: { protocol: "ks3267", unit: 1, kind: "switch", n: 3 } },
              { deviceId: "win1", name: "측창", modbus: { unitId: 2, address: 0, controlType: "bidir" } }],
    sensors: [{ sensorId: "temp_std", name: "표준 온도", ks3267: { unit: 2, index: 1 } }] },
    { houseId: "house_0002", name: "2동", devices: [{ deviceId: "fan9", name: "중복", modbus: { protocol: "ks3267", unit: 1, kind: "switch", n: 3 } }] }];
  test("색인과 중복 감지", () => {
    const { map, duplicates } = lib.mappingIndex(houses);
    assert.equal(map[lib.mappingKey(1, "switch", 3)].length, 2);
    assert.equal(map["U2:sensor:1"][0].sensorId, "temp_std");
    assert.equal(map["U2:switch:0"], undefined, "vendor 장치가 표준 색인에 섞였다");
    assert.deepEqual(duplicates, ["U1:switch:3"]);
  });
});

describe("deviceKsStatus — 제어판 배지", () => {
  const state = { 1: { kind: "actuator", t: 1, devices: { 3: { kind: "switch", n: 3, status: 201, remain: 25, opid: 9 }, 18: { kind: "opener", n: 2, status: 0, remain: 0 } } }, 5: { error: "timeout" } };
  test("켜짐 + 남은시간", () => {
    const s = lib.deviceKsStatus(state, { protocol: "ks3267", unit: 1, kind: "switch", n: 3 });
    assert.equal(s.text, "켜짐"); assert.equal(s.remain, 25);
  });
  test("응답 없는 노드 → stale, 비표준·미존재 → null", () => {
    assert.equal(lib.deviceKsStatus(state, { protocol: "ks3267", unit: 5, kind: "switch", n: 1 }).stale, true);
    assert.equal(lib.deviceKsStatus(state, { unitId: 2, address: 0 }), null);
    assert.equal(lib.deviceKsStatus(state, { protocol: "ks3267", unit: 1, kind: "opener", n: 7 }), null);
  });
  test("프레임 행 hex 띄어쓰기", () => {
    assert.equal(lib.frameRows([{ t: 1, dir: "tx", unit: 1, fc: 3, hex: "010300c9", ms: 3.6 }])[0].hex, "01 03 00 C9");
    assert.equal(lib.frameRows([{ dir: "RX", hex: "01 03 02 41 E6" }])[0].hex, "01 03 02 41 E6", "데몬은 이미 띄어쓴 hex 를 준다");
  });
});
