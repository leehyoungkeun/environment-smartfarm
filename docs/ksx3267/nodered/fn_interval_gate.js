// 「센서 수집」 탭 · ⓪ 주기 게이팅 — 교체본 (2026-09-27)
//
// 왜 고치나: 다음 수집 시각을 "틱이 도착한 시각 + 주기" 로 잡았다. 틱(inject repeat 60초 =
// setInterval)은 매번 몇 ms 씩 흔들리는데, 다음 틱이 그 마감보다 아주 조금 **이르게** 오면
// 그 분을 통째로 건너뛰었다. 실측: 7일간 결손 316건이 전부 정확히 1분짜리, 하루 40분 안팎(≈3%).
// 그래서 KOAT 116 「30일·하루 손실 3% 이내」 창이 9/25 에 5.97% 로 끊겨 입고일이 밀렸다.
// (표준 센서 저장이 매일 1440행으로 온전한 것은 드라이버가 2초 폴링에서 분이 바뀔 때 기록해서다.)
//
// 고치는 법: 마감을 **벽시계 격자**에 맞춘다. 주기 60초면 마감은 항상 :00 이므로,
// :01 에 오는 틱은 빠르든 늦든 늘 통과한다. 10분 주기면 10분 격자에 맞는다.
// (에폭 기준 나눗셈이라 KST(+9:00) 처럼 분 단위 오프셋에서는 벽시계 격자와 같다.)

// 수동 수집은 즉시 통과
if (msg.topic === 'manual') return msg;

const now = Date.now();
const nextCollectAt = global.get('nextCollectAt') || 0;

if (now < nextCollectAt) {
    const remain = Math.round((nextCollectAt - now) / 1000);
    node.status({ fill: 'blue', shape: 'ring', text: '대기 (' + remain + '초 후)' });
    return null; // 스킵
}

// houseConfig에서 최소 intervalSeconds 읽기
const config = global.get('houseConfig');
const houses = config && config.houses ? config.houses : [];
let interval = 600; // 기본 10분
for (const h of houses) {
    const hi = (h.collection && h.collection.intervalSeconds) || 600;
    if (hi < interval) interval = hi;
}
if (interval < 10) interval = 10; // 최소 10초 보장

// 다음 마감 = 지금이 속한 격자 칸의 끝. "now + 주기" 로 잡으면 틱 흔들림에 1분씩 빠진다.
const period = interval * 1000;
global.set('nextCollectAt', Math.floor(now / period) * period + period);
global.set('appliedIntervalSeconds', interval);
node.status({ fill: 'green', shape: 'dot', text: '수집 (' + interval + '초 주기)' });
return msg;
