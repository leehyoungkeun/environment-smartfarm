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
