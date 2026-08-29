// MQTT 메시지 분배 (mqttClient._handleMessage) — 브로커 없이 실제 분배 로직을 실행한다.
//
// 근거가 된 실제 사고:
//   - farm_0006 MQTT clientId 중복 → 3.5개월 플래핑 328,243회, relay_status 행 없음.
//     그동안 아무도 몰랐다 — 분배·캐시가 조용히 죽으면 화면은 그냥 '옛 상태' 를 보여준다.
//   - NR 응답 포맷 fan-out: unitId 없는 잡다한 페이로드가 relay_status 를 오염시키던 문제
//     (DB UPSERT 는 unitId+coils 명시된 것만 — 그 가드를 여기서 잠근다)
//
// connect() 는 인증서·브로커가 필요해 테스트 불가 — 분배 로직을 _handleMessage 로
// 추출했다(2026-08-29, 로직 무변경). 여기서 가짜 토픽·페이로드로 직접 부른다.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mqttService from "../../src/services/mqttClient.js";

const buf = (obj) => Buffer.from(JSON.stringify(obj));

/** 한 번의 emit 을 붙잡는다 */
function capture(event) {
  const got = [];
  const fn = (p) => got.push(p);
  mqttService.on(event, fn);
  return { got, off: () => mqttService.off(event, fn) };
}

beforeEach(() => {
  // 싱글톤 캐시 초기화 — 테스트 간 간섭 방지
  mqttService.latestRelayStatus = {};
  mqttService.latestSensorStatus = {};
  mqttService.latestSyncStatus = {};
  mqttService.latestSystemStatus = {};
});

describe("토픽 분배", () => {
  test("relay/status → 캐시 + relay:status emit", () => {
    const c = capture("relay:status");
    mqttService._handleMessage("smartfarm/farm_0001/relay/status", buf({ unitId: 2, coils: [true, false] }));
    c.off();
    assert.equal(c.got.length, 1);
    assert.equal(c.got[0].farmId, "farm_0001");
    const cached = mqttService.getRelayStatus("farm_0001");
    assert.ok(cached, "캐시가 비었다 — WS 구독자가 옛 상태를 본다");
    assert.deepEqual(cached["2"].coils, [true, false]);
    assert.ok(cached["2"].receivedAt, "수신 시각이 없으면 신선도 판단을 못 한다");
  });

  test("relay/response 도 같은 캐시를 갱신한다 (조회 응답)", () => {
    const c = capture("relay:response");
    mqttService._handleMessage("smartfarm/farm_0001/relay/response", buf({ unitId: 2, coils: [false] }));
    c.off();
    assert.equal(c.got.length, 1);
    assert.deepEqual(mqttService.getRelayStatus("farm_0001")["2"].coils, [false]);
  });

  test("sensor/sync/system status 는 각자의 캐시로", () => {
    mqttService._handleMessage("smartfarm/farm_0001/sensor/status", buf({ unitId: 1, registers: [231, 550] }));
    mqttService._handleMessage("smartfarm/farm_0001/sync/status", buf({ unsynced: 3, total: 100 }));
    mqttService._handleMessage("smartfarm/farm_0001/system/status", buf({ nodeRed: { status: "online" } }));
    assert.deepEqual(mqttService.getSensorStatus("farm_0001")["1"].registers, [231, 550]);
    assert.equal(mqttService.getSyncStatus("farm_0001").unsynced, 3);
    assert.equal(mqttService.getSystemStatus("farm_0001").nodeRed.status, "online");
  });

  test("제어 응답 (5-seg) → control:response 에 farm/house/device 가 붙는다", () => {
    const c = capture("control:response");
    mqttService._handleMessage(
      "smartfarm/farm_0001/house_0001/window1/response",
      buf({ request_id: "r1", status: "received" })
    );
    c.off();
    assert.equal(c.got.length, 1);
    assert.equal(c.got[0].farmId, "farm_0001");
    assert.equal(c.got[0].houseId, "house_0001");
    assert.equal(c.got[0].deviceId, "window1");
  });

  test("모르는 토픽은 조용히 무시 (emit 없음)", () => {
    const c = capture("relay:status");
    mqttService._handleMessage("smartfarm/farm_0001/unknown/thing", buf({ a: 1 }));
    c.off();
    assert.equal(c.got.length, 0);
  });

  test("깨진 JSON 이 분배기를 죽이지 않는다", () => {
    // 여기서 throw 나면 mqtt 라이브러리의 message 핸들러가 죽어 이후 모든 수신이 멈춘다
    mqttService._handleMessage("smartfarm/farm_0001/relay/status", Buffer.from("not-json{{{"));
    assert.equal(mqttService.getRelayStatus("farm_0001"), null);
  });
});

describe("캐시 격리·키", () => {
  test("농장별 캐시가 분리된다", () => {
    mqttService._handleMessage("smartfarm/farm_0001/relay/status", buf({ unitId: 2, coils: [true] }));
    mqttService._handleMessage("smartfarm/farm_0006/relay/status", buf({ unitId: 2, coils: [false] }));
    assert.deepEqual(mqttService.getRelayStatus("farm_0001")["2"].coils, [true]);
    assert.deepEqual(mqttService.getRelayStatus("farm_0006")["2"].coils, [false]);
  });

  test("모르는 농장은 null (undefined 아님)", () => {
    assert.equal(mqttService.getRelayStatus("farm_none"), null);
  });

  test("unitId 가 다르면 다른 키 (모듈 2개 공존)", () => {
    mqttService._handleMessage("smartfarm/farm_0001/relay/status", buf({ unitId: 2, coils: [true] }));
    mqttService._handleMessage("smartfarm/farm_0001/relay/status", buf({ unitId: 3, coils: [false] }));
    const cached = mqttService.getRelayStatus("farm_0001");
    assert.deepEqual(cached["2"].coils, [true]);
    assert.deepEqual(cached["3"].coils, [false]);
  });

  test("houseId 가 있으면 houseId 키 우선", () => {
    mqttService._handleMessage("smartfarm/farm_0001/relay/status", buf({ houseId: "house_0001", unitId: 2, coils: [true] }));
    assert.ok(mqttService.getRelayStatus("farm_0001")["house_0001"]);
  });
});
