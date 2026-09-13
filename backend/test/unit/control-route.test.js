// 제어 경로 결정 — frontend/src/lib/controlRoute.js 를 그대로 실행한다.
// 2026-09-13 키오스크 먹통 사고: nginx→NR 502 인데 키오스크가 모드를 무시하고 로컬로만 보내 제어가 전부 실패했다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { useLocalControl } = await import(pathToFileURL(join(here, "..", "..", "..", "frontend", "src", "lib", "controlRoute.js")).href);

const KIOSK = { rpiBase: "http://localhost/api", pcBase: "https://api.smartgreen.kr/api" };   // 키오스크 빌드(--mode rpi)
const HTTPS_PC = { rpiBase: "https://api.smartgreen.kr/api", pcBase: "https://api.smartgreen.kr/api" }; // https → Mixed Content 로 RPi 직접 불가

describe("useLocalControl — 사용자가 고른 모드를 따른다", () => {
  test("사고 재현: 키오스크 + 클라우드 모드 → 클라우드 경로 (로컬 강제 금지)", () => {
    assert.equal(useLocalControl({ ...KIOSK, isFarmLocal: false, manualOverride: false }), false,
      "키오스크라는 이유로 로컬을 강제하면 nginx→NR 장애 때 제어가 통째로 막힌다");
  });
  test("팜로컬을 명시 선택하면 로컬 경로", () => {
    assert.equal(useLocalControl({ ...KIOSK, isFarmLocal: true }), true);
  });
  test("수동 오프라인(명시)도 로컬 경로", () => {
    assert.equal(useLocalControl({ ...KIOSK, manualOverride: true }), true);
  });
  test("헬스체크 실패만으로는 경로를 바꾸지 않는다 — 자동 전환 금지 (변이 프로브)", () => {
    // serverOnline=false 여도 명시 선택이 아니면 클라우드 유지. 배너로 알리고 농장주가 전환한다.
    assert.equal(useLocalControl({ ...KIOSK, isFarmLocal: false, manualOverride: false, serverOnline: false }), false);
  });
  test("로컬 경로가 없으면(https PC) 팜로컬이어도 클라우드 — 백엔드 404 방지", () => {
    assert.equal(useLocalControl({ ...HTTPS_PC, isFarmLocal: true }), false);
    assert.equal(useLocalControl({ ...HTTPS_PC, manualOverride: true }), false);
  });
  test("입력 누락에 안전", () => {
    assert.equal(useLocalControl(null), false);
    assert.equal(useLocalControl({ isFarmLocal: true }), false, "base 가 없으면 로컬로 보내지 않는다");
    assert.equal(useLocalControl({ isFarmLocal: true, rpiBase: "http://localhost/api" }), false);
  });
});
