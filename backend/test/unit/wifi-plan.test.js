// 키오스크 WiFi 연결 판단 — rpi-files/master/rpi-server/src/wifiPlan.js
// 2026-09-15 사고: 비밀번호를 한 번 틀리자 틀린 값이 저장됐고, 고친 비밀번호가 끝까지 전달되지 않았다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isEverConnected, planConnect, stateCode, classifyState, failureMessage, describeLink } =
  require("../../../rpi-files/master/rpi-server/src/wifiPlan.js");

describe("describeLink — 화면의 '현재 연결' 은 장치가 실제로 연결된 망만", () => {
  const ap603 = ["*", "603ho", "85", "2412 MHz", "1", "130 Mbit/s", "WPA2 WPA3"];

  test("사고 재현: 실패한 703HO 가 끊기는 중 → '연결됨' 이 아니다", () => {
    const l = describeLink({ device: ["wlan0", "wifi", "disconnecting", "703HO"], apRows: [], ipText: "", connectivity: "none" });
    assert.equal(l.state, "connecting", "예전엔 활성 연결 목록에 남은 703HO 를 현재 연결로 표시했다");
    assert.equal(l.ip, null);
  });

  test("인증 대기 중 → 연결 중", () => {
    assert.equal(describeLink({ device: ["wlan0", "wifi", "connecting (need authentication)", "703HO"] }).state, "connecting");
  });

  test("연결됨 → 이름·신호·대역·채널·보안·주소·공유기·인터넷", () => {
    const l = describeLink({
      device: ["wlan0", "wifi", "connected", "603ho"], apRows: [ap603],
      ipText: "192.168.0.83/24\n192.168.0.1", connectivity: "full",
    });
    assert.equal(l.state, "connected");
    assert.equal(l.ssid, "603ho");
    assert.equal(l.signal, 85);
    assert.equal(l.band, "2.4GHz");
    assert.equal(l.channel, 1);
    assert.equal(l.security, "WPA2 WPA3");
    assert.equal(l.ip, "192.168.0.83");
    assert.equal(l.prefix, 24);
    assert.equal(l.gateway, "192.168.0.1");
    assert.equal(l.internet, "정상");
  });

  test("5GHz·공개 망·인터넷 제한", () => {
    const l = describeLink({
      device: ["wlan0", "wifi", "connected", "cafe"], apRows: [["*", "cafe", "60", "5745 MHz", "149", "270 Mbit/s", "--"]],
      ipText: "10.0.0.5/24\n10.0.0.1", connectivity: "limited",
    });
    assert.equal(l.band, "5GHz");
    assert.equal(l.security, "없음");
    assert.match(l.internet, /제한/);
  });

  test("연결 안 됨이면 주소·인터넷을 보여주지 않는다 (변이 프로브: 옛 주소가 남아 있어도)", () => {
    const l = describeLink({ device: ["wlan0", "wifi", "disconnected", ""], ipText: "192.168.0.83/24\n192.168.0.1", connectivity: "full" });
    assert.equal(l.state, "disconnected");
    assert.equal(l.ip, null);
    assert.equal(l.internet, "없음");
  });

  test("'connected (externally)' 도 연결됨", () => {
    assert.equal(describeLink({ device: ["wlan0", "wifi", "connected (externally)", "x"] }).state, "connected");
  });
});

describe("isEverConnected — '저장됨' 은 실제로 연결에 성공한 프로필만", () => {
  test("NetworkManager timestamp 0 은 한 번도 활성화된 적 없음", () => {
    assert.equal(isEverConnected("0"), false);
    assert.equal(isEverConnected(""), false);
    assert.equal(isEverConnected(null), false);
    assert.equal(isEverConnected("1789429174"), true);
  });
});

describe("planConnect", () => {
  test("사고 재현: 틀린 비밀번호로 저장만 되고 성공한 적 없는 프로필 → 쓰지 않고 지운 뒤 비밀번호를 받는다", () => {
    const p = planConnect({ password: "", profile: { name: "603ho", everConnected: false } });
    assert.equal(p.action, "need-password", "예전엔 이 경우 키보드를 숨기고 틀린 저장값으로 다시 붙었다");
    assert.equal(p.deleteStale, true);
  });

  test("성공한 적 있는 망은 비밀번호 없이 저장값으로 올린다", () => {
    assert.equal(planConnect({ profile: { name: "SK_DD74_2.4G", everConnected: true } }).action, "up-saved");
  });

  test("사고 재현: 새 비밀번호를 넣으면 저장된 프로필의 비밀번호를 명시적으로 바꾼다", () => {
    const p = planConnect({ password: "Correct#Pass9", profile: { name: "603ho", everConnected: false } });
    assert.equal(p.action, "modify-then-up");
    assert.equal(p.deleteOnFail, true, "성공한 적 없는 프로필은 또 틀리면 지운다 — 자동 연결로 무선을 붙잡지 않게");
    assert.equal(p.restorePskOnFail, false);
  });

  test("성공했던 망에 새 비밀번호가 틀리면 원래 비밀번호로 되돌린다 (변이 프로브)", () => {
    const p = planConnect({ password: "typo-password", profile: { name: "jamesroom", everConnected: true } });
    assert.equal(p.action, "modify-then-up");
    assert.equal(p.restorePskOnFail, true);
    assert.equal(p.deleteOnFail, false, "잘 되던 망의 프로필을 오타 한 번에 지우면 안 된다");
  });

  test("처음 보는 망 + 비밀번호 → 새로 만들고, 실패하면 지운다", () => {
    const p = planConnect({ password: "abcdefgh", profile: null });
    assert.equal(p.action, "add-connect");
    assert.equal(p.deleteOnFail, true);
  });

  test("처음 보는 공개 망 → 새로 만들고, 실패하면 흔적을 남기지 않는다", () => {
    const p = planConnect({ profile: null });
    assert.equal(p.action, "add-connect");
    assert.equal(p.deleteOnFail, true);
  });
});

describe("classifyState — 장치 상태로 결과 판정", () => {
  const base = { target: "603ho", limitMs: 30000 };

  test("stateCode 파싱", () => {
    assert.equal(stateCode("60 (need-auth)"), 60);
    assert.equal(stateCode("100 (connected)"), 100);
    assert.ok(Number.isNaN(stateCode("")));
  });

  test("시작 직후 순간적인 need-auth 는 기다린다 — 로그상 1ms 안에 prepare 로 돌아간다", () => {
    assert.equal(classifyState({ ...base, code: 60, connection: "603ho", elapsedMs: 500, needAuthStreak: 1 }), "waiting");
  });

  test("사고 재현: 7초째 need-auth 가 이어짐 → 비밀번호 틀림 (예전엔 2분을 기다렸다)", () => {
    assert.equal(classifyState({ ...base, code: 60, connection: "603ho", elapsedMs: 7000, needAuthStreak: 2 }), "wrong_password");
  });

  test("3초가 지났어도 한 번만 보인 need-auth 는 아직 판정하지 않는다 (변이 프로브)", () => {
    assert.equal(classifyState({ ...base, code: 60, connection: "603ho", elapsedMs: 5000, needAuthStreak: 1 }), "waiting");
  });

  test("대상 망으로 연결됨", () => {
    assert.equal(classifyState({ ...base, code: 100, connection: "603ho", elapsedMs: 4000, needAuthStreak: 0 }), "connected");
  });

  test("실패 뒤 NetworkManager 가 다른 저장 망(핫스팟)으로 넘어가면 실패", () => {
    assert.equal(classifyState({ ...base, code: 100, connection: "형근의 S25", elapsedMs: 9000, needAuthStreak: 0 }), "failed");
  });

  test("시작 직후 이전 망이 아직 붙어 있는 순간은 실패로 보지 않는다", () => {
    assert.equal(classifyState({ ...base, code: 100, connection: "형근의 S25", elapsedMs: 800, needAuthStreak: 0 }), "waiting");
  });

  test("제한 시간 초과", () => {
    assert.equal(classifyState({ ...base, code: 50, connection: "603ho", elapsedMs: 30000, needAuthStreak: 0 }), "timeout");
  });
});

describe("failureMessage", () => {
  test("비밀번호 틀림은 대소문자·기호 확인을 안내한다", () => {
    const m = failureMessage("wrong_password", "");
    assert.equal(m.reason, "wrong_password");
    assert.match(m.message, /대소문자/);
  });
  test("신호 없음", () => {
    assert.equal(failureMessage("failed", "Error: No network with SSID '603ho' found.").reason, "not_found");
  });
  test("시간 초과", () => {
    assert.equal(failureMessage("timeout", "").reason, "timeout");
  });
});
