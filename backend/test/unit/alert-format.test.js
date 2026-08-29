// GlitchTip → Discord 변환 — 알림이 "왔지만 쓸모없는" 상태를 막는다.
//
// 2026-08-26~29: 변환기가 GlitchTip 의 실제 페이로드 형식을 모른 채 필드명을 추측해,
// Discord 에 항상 "GlitchTip alert / 프로젝트 — / error / 1" 만 갔다. 오류 이름도,
// 어느 서비스인지도, 링크도 없는 알림이었다. 도달은 되니 아무도 몰랐다.
//
// 아래 입력은 GlitchTip 소스(apps/alerts/webhooks.py, apps/uptime/webhooks.py)에서 확인한
// 실제 형식이다. 형식이 바뀌거나 파싱이 깨지면 여기서 먼저 드러난다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatGlitchTipForDiscord } from "../../src/routes/webhook.routes.js";

const issuePayload = {
  text: "GlitchTip Alert",
  attachments: [
    {
      title: "TimeoutError: timed out",
      title_link: "https://sentry.smartgreen.kr/smartfarm/issues/62",
      text: "d16_daemon.py in loop",
      color: "#e52b50",
      fields: [
        { title: "Project", value: "smartfarm-rpi", short: true },
        { title: "Environment", value: "production", short: true },
        { title: "Server Name", value: "pi", short: true },
        { title: "Release", value: "d16-display@1.0.0", short: false },
        { title: "Service", value: "d16-display", short: false },
        { title: "Farm_id", value: "farm_0001", short: false },
      ],
      mrkdown_in: ["text"],
    },
  ],
};

const uptimeDown = {
  text: "GlitchTip Uptime Alert",
  attachments: [
    {
      title: "Alertmanager 생존 신호 (dead man)",
      title_link: "https://sentry.smartgreen.kr/smartfarm/uptime-monitors/9",
      text: "The monitored site has gone down.",
    },
  ],
};

const uptimeUp = {
  ...uptimeDown,
  attachments: [{ ...uptimeDown.attachments[0], text: "The monitored site is back up." }],
};

describe("오류 알림 — 무엇이 어디서 났는지 담긴다", () => {
  const r = formatGlitchTipForDiscord(issuePayload);
  const e = r.embeds[0];

  test("오류 이름이 제목에 들어간다 (폴백 문구가 아니라)", () => {
    assert.match(e.title, /TimeoutError: timed out/);
    assert.doesNotMatch(e.title, /GlitchTip alert$/i, "폴백 제목이면 실패");
  });

  test("클릭해서 갈 링크가 있다", () => {
    assert.equal(e.url, "https://sentry.smartgreen.kr/smartfarm/issues/62");
  });

  test("오류 위치(culprit)가 보인다", () => {
    assert.match(e.description, /d16_daemon\.py in loop/);
  });

  test("서비스와 농장을 한글 이름으로 보여준다", () => {
    const names = e.fields.map((f) => f.name);
    assert.ok(names.includes("서비스"), `서비스 필드 없음: ${names}`);
    assert.ok(names.includes("농장"), `농장 필드 없음: ${names}`);
    const svc = e.fields.find((f) => f.name === "서비스");
    assert.equal(svc.value, "d16-display");
  });

  test("GlitchTip 이 준 색을 그대로 쓴다", () => {
    assert.equal(e.color, 0xe52b50);
  });
});

describe("업타임 알림 — 다운과 복구를 구분한다", () => {
  test("다운은 빨강 + '다운' 표시", () => {
    const e = formatGlitchTipForDiscord(uptimeDown).embeds[0];
    assert.match(e.title, /다운/);
    assert.equal(e.color, 0xed4245);
    assert.match(e.title, /Alertmanager 생존 신호/);
  });

  test("복구는 초록 + '복구' 표시", () => {
    const e = formatGlitchTipForDiscord(uptimeUp).embeds[0];
    assert.match(e.title, /복구/);
    assert.equal(e.color, 0x57f287);
  });
});

describe("망가진 입력에도 무언가는 보낸다", () => {
  test("빈 본문이어도 embed 를 만든다 (조용히 사라지지 않는다)", () => {
    const r = formatGlitchTipForDiscord({});
    assert.equal(r.embeds.length, 1);
    assert.ok(r.embeds[0].title.length > 0);
  });

  test("attachments 가 없어도 죽지 않는다", () => {
    const r = formatGlitchTipForDiscord({ text: "GlitchTip Alert" });
    assert.ok(Array.isArray(r.embeds));
  });
});
