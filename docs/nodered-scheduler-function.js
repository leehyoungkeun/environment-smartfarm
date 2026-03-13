// ================================================================
// ④ 시간 스케줄러 v4 (Node-RED function 노드)
// ================================================================
// ★ v4: 세대(generation) 메커니즘 완전 제거
//   - 매 폴링마다 타이머 설정 (Deploy 후에도 즉시 복구)
//   - 실행 시점에서 30초 이내 중복 방지 (dedup)
//   - setTimeout 타이머는 Deploy 시 소멸하지만 context는 남음
//     → scheduleInfo 비교 대신 항상 타이머 생성 + 실행 dedup
// ================================================================

const FARM_ID = global.get('farmId') || env.get('FARM_ID') || 'farm_0001';

// --- 규칙 로드 ---
var rules = msg.automationRules || global.get('automationRules') || [];
if (typeof rules === 'string') {
    try { rules = JSON.parse(rules); } catch(e) { rules = []; }
}

// --- autoDevices 확인 ---
var autoDevices = global.get('autoDevices') || [];
if (autoDevices.length === 0) {
    context.set('scheduleInfo', {});
    global.set('automationSchedule', {});
    node.send([null, { payload: '자동화 미적용 — 대기 중', topic: 'schedule_info' }]);
    return;
}

// --- 다음 실행 시각 계산 함수 (자정 넘기기 지원) ---
function calculateNextRunTime(timeConds, fromDate) {
    var now = fromDate || new Date();
    var nowDay = now.getDay();
    var nowMinutes = now.getHours() * 60 + now.getMinutes();
    var nowSeconds = now.getSeconds();
    var bestTime = null;

    for (var i = 0; i < timeConds.length; i++) {
        var cond = timeConds[i];
        var days = (cond.days && cond.days.length > 0)
            ? cond.days.map(Number)
            : [0, 1, 2, 3, 4, 5, 6];

        var times = [];
        if (cond.timeMode === 'specific') {
            (cond.times || []).forEach(function(t) {
                var p = t.split(':').map(Number);
                times.push(p[0] * 60 + (p[1] || 0));
            });
        } else if (cond.timeMode === 'interval') {
            var sp = (cond.startTime || '00:00').split(':').map(Number);
            var ep = (cond.endTime || '23:59').split(':').map(Number);
            var start = sp[0] * 60 + sp[1];
            var end = ep[0] * 60 + ep[1];
            var interval = cond.intervalMinutes || 30;

            if (start <= end) {
                for (var t = start; t <= end; t += interval) {
                    times.push(t);
                }
            } else {
                for (var t = start; t < 1440; t += interval) {
                    times.push(t);
                }
                var lastBefore = times[times.length - 1];
                var firstAfter = (lastBefore + interval) - 1440;
                if (firstAfter < 0) firstAfter = 0;
                for (var t2 = firstAfter; t2 <= end; t2 += interval) {
                    times.push(t2);
                }
            }
        } else if (cond.time) {
            var p = cond.time.split(':').map(Number);
            times.push(p[0] * 60 + (p[1] || 0));
        }

        if (times.length === 0) continue;
        times.sort(function(a, b) { return a - b; });

        for (var dayOffset = 0; dayOffset < 7; dayOffset++) {
            var checkDay = (nowDay + dayOffset) % 7;
            if (days.indexOf(checkDay) === -1) continue;

            for (var j = 0; j < times.length; j++) {
                var targetMin = times[j];
                if (dayOffset === 0 && (targetMin < nowMinutes || (targetMin === nowMinutes && nowSeconds > 0))) {
                    continue;
                }
                var targetDate = new Date(now);
                targetDate.setDate(targetDate.getDate() + dayOffset);
                targetDate.setHours(Math.floor(targetMin / 60), targetMin % 60, 0, 0);

                if (!bestTime || targetDate < bestTime) {
                    bestTime = targetDate;
                }
                break;
            }
            if (bestTime) break;
        }
    }
    return bestTime;
}

// --- 각 규칙에 대해 스케줄 설정 ---
var scheduleInfo = {};
var scheduledCount = 0;
// ★ 같은 시각 규칙 stagger: delay별 카운터 → 500ms씩 간격 추가
var staggerMap = {}; // { delayKey: count }

rules.forEach(function(rule) {
    if (!rule.enabled) return;

    var conditions = (typeof rule.conditions === 'string') ? JSON.parse(rule.conditions) : (rule.conditions || []);
    var timeConds = conditions.filter(function(c) { return c.type === 'time'; });
    if (timeConds.length === 0) return;

    var ruleId = rule._id || rule.id;
    var cooldownSec = rule.cooldownSeconds || rule.cooldown_seconds || 300;

    // 쿨다운 체크
    var fromDate = new Date();
    if (rule.lastTriggeredAt) {
        var cooldownEnd = new Date(new Date(rule.lastTriggeredAt).getTime() + cooldownSec * 1000);
        if (cooldownEnd > fromDate) {
            fromDate = cooldownEnd;
        }
    }

    var nextRun = calculateNextRunTime(timeConds, fromDate);
    if (!nextRun) return;

    var delay = nextRun.getTime() - Date.now();
    if (delay < 0) delay = 0;
    if (delay > 24 * 60 * 60 * 1000) return;

    // ★ 같은 시각에 여러 규칙 → RS-485 충돌 방지를 위해 500ms씩 stagger
    var delayKey = Math.round(delay / 1000); // 초 단위로 그룹핑
    if (!staggerMap[delayKey]) staggerMap[delayKey] = 0;
    var staggerMs = staggerMap[delayKey] * 500;
    staggerMap[delayKey]++;
    var actualDelay = delay + staggerMs;

    scheduleInfo[ruleId] = {
        ruleName: rule.name,
        nextRunAt: nextRun.toISOString(),
        delayMs: actualDelay
    };

    // ★ 타이머 설정 (매 폴링마다 생성 — 실행 시 dedup으로 중복 방지)
    setTimeout(function() {
        // ★ 실행 중복 방지: 이 규칙이 30초 이내에 이미 실행됐으면 스킵
        var dedupKey = '_exec_' + ruleId;
        var lastExec = context.get(dedupKey) || 0;
        if (Date.now() - lastExec < 30000) return;
        context.set(dedupKey, Date.now());

        // autoDevices 재확인
        var currentAutoDevices = global.get('autoDevices') || [];
        var actions = (typeof rule.actions === 'string') ? JSON.parse(rule.actions) : (rule.actions || []);
        var executableActions = [];

        actions.forEach(function(action) {
            if (currentAutoDevices.indexOf(action.deviceId) === -1) {
                node.warn('⛔ 스케줄러: ' + action.deviceId + ' 수동 모드 → 스킵');
                return;
            }
            executableActions.push(action);
        });

        if (executableActions.length === 0) {
            node.warn('⏭️ 스케줄러: ' + rule.name + ' — 실행 가능한 액션 없음');
            return;
        }

        node.warn('🎯 스케줄러 실행: ' + rule.name + ' (' + new Date().toLocaleTimeString() + ')');

        node.send([{
            scheduledRule: rule,
            scheduledActions: executableActions,
            scheduledAt: new Date().toISOString(),
            topic: 'scheduled_execution'
        }, null]);

        // 재스케줄: scheduleInfo 업데이트 → 다음 폴링에서 자동으로 새 타이머 생성
        var nextFrom = new Date(Date.now() + cooldownSec * 1000);
        var nextNext = calculateNextRunTime(timeConds, nextFrom);
        if (nextNext) {
            var nd = nextNext.getTime() - Date.now();
            if (nd > 0 && nd <= 24 * 60 * 60 * 1000) {
                var si = context.get('scheduleInfo') || {};
                si[ruleId] = {
                    ruleName: rule.name,
                    nextRunAt: nextNext.toISOString(),
                    delayMs: nd
                };
                context.set('scheduleInfo', si);
                global.set('automationSchedule', si);
            }
        }
    }, actualDelay);

    scheduledCount++;
});

// --- 저장 ---
context.set('scheduleInfo', scheduleInfo);
global.set('automationSchedule', scheduleInfo);

node.warn('📅 스케줄러: ' + scheduledCount + '개 규칙 예약 완료');

// 디버그 출력
var debugInfo = Object.keys(scheduleInfo).map(function(id) {
    var s = scheduleInfo[id];
    return s.ruleName + ' → ' + s.nextRunAt + ' (' + Math.round(s.delayMs / 1000) + '초 후)';
}).join('\n');

node.send([null, { payload: debugInfo || '예약된 규칙 없음', topic: 'schedule_info' }]);
