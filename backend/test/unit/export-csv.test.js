// 데이터 추출(116 검정: 1분 단위·조회기간·csv/txt) — 순수 변환 로직. 값을 지어내지 않고(빈 셀), 이스케이프가 정확해야 한다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toDelimited, sensorTable, controlLogTable, actuatorStatusTable, exportFilename, resolveRange, formatTs, formatSpec } from "../../src/utils/exportCsv.js";

describe("csvCell / toDelimited", () => {
  test("따옴표·구분자·개행 이스케이프 (RFC 4180)", () => {
    assert.equal(csvCell('a"b'), '"a""b"');
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell("a\nb"), '"a\nb"');
    assert.equal(csvCell("a,b", "\t"), "a,b", "탭 구분에서는 쉼표를 감싸지 않는다");
    assert.equal(csvCell(null), ""); assert.equal(csvCell(undefined), ""); assert.equal(csvCell(0), "0");
  });
  test("BOM + CRLF + 헤더", () => {
    const s = toDelimited([{ a: 1, b: "x" }], [{ key: "a", label: "A" }, { key: "b", label: "B" }], "csv");
    assert.ok(s.startsWith("﻿A,B\r\n1,x\r\n"));
    const t = toDelimited([{ a: 1, b: "x" }], [{ key: "a", label: "A" }, { key: "b", label: "B" }], "txt");
    assert.ok(t.includes("A\tB\r\n1\tx"));
    assert.equal(formatSpec("bogus").ext, "csv", "모르는 형식은 csv");
    assert.equal(formatSpec("xls").ext, "xls");
  });
});

describe("sensorTable — 1분 1행, 센서별 열", () => {
  const rows = [
    { timestamp: new Date(2026, 7, 30, 9, 0, 0), data: { temp_0001: 28.8, humidity_0001: 61.5 } },
    { timestamp: new Date(2026, 7, 30, 9, 1, 0), data: { temp_0001: 28.9 } },                       // 습도 결측
  ];
  test("열 자동 검출(이름순) + 결측은 빈 셀 (0 아님)", () => {
    const { columns, rows: t } = sensorTable(rows);
    assert.deepEqual(columns.map((c) => c.key), ["timestamp", "humidity_0001", "temp_0001"]);
    assert.equal(t[0].timestamp, "2026-08-30 09:00:00");
    assert.equal(t[1].humidity_0001, "", "결측을 0 이나 이전 값으로 채우면 손실률 계산이 거짓이 된다");
    assert.equal(t[1].temp_0001, 28.9);
  });
  test("sensorIds 지정 시 그 순서·그 열만", () => {
    const { columns, rows: t } = sensorTable(rows, ["temp_0001", "co2_0001"]);
    assert.deepEqual(columns.map((c) => c.key), ["timestamp", "temp_0001", "co2_0001"]);
    assert.equal(t[0].co2_0001, "");
  });
});

describe("controlLogTable / actuatorStatusTable", () => {
  test("제어 이력 열과 Y/N", () => {
    const { rows } = controlLogTable([{ timestamp: "2026-08-30T00:00:00Z", houseId: "house_0001", deviceId: "fan1", command: "on", success: false, isAutomatic: true, error: "timeout" }]);
    assert.equal(rows[0].success, "N"); assert.equal(rows[0].isAutomatic, "Y"); assert.equal(rows[0].error, "timeout");
  });
  test("구동기 상태 열", () => {
    const { columns, rows } = actuatorStatusTable([{ timestamp: new Date(2026, 7, 30, 9, 0), house_id: "house_0001", device_id: "fan1", unit: 1, kind: "switch", n: 3, status: 201, status_name: "ON", remain: 25, opid: 7 }]);
    assert.ok(columns.some((c) => c.label === "remain_sec")); assert.equal(rows[0].status, 201); assert.equal(rows[0].timestamp, "2026-08-30 09:00:00");
  });
});

describe("resolveRange / exportFilename", () => {
  test("기본 24시간, 최대 31일, 역전 거부", () => {
    const [s, e] = resolveRange(undefined, undefined);
    assert.ok(Math.abs(e - s - 86400000) < 1000);
    assert.throws(() => resolveRange("2026-07-01", "2026-08-30"), /최대 31일/);
    assert.throws(() => resolveRange("2026-08-30", "2026-08-01"), /앞선다/);
    assert.throws(() => resolveRange("x", "y"), /형식 오류/);
    const [a, b] = resolveRange("2026-08-01", "2026-08-31"); assert.ok(b > a);
  });
  test("파일명은 ASCII + 기간", () => {
    const f = exportFilename("sensor", "farm_0001", "house_0001", new Date(2026, 7, 1), new Date(2026, 7, 30), "txt");
    assert.equal(f, "sensor_farm_0001_house_0001_20260801-20260830.txt");
    assert.equal(formatTs("not a date"), "");
  });
});
