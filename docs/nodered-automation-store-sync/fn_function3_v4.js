// ============================================================
// 「function 3」(자동화 평가 탭) 교체본 — 노드 id: 29efa2673f7cea1c
// 버전: v4 (2026-08-30 밤) — 비활성 규칙도 미러링, '로컬 미전송' 판별을 synced 가 아니라 id 형식으로
//
// 왜 바꾸나:
//   자동화 규칙이 RPi 안에서 두 곳에 따로 살고 있었다.
//     · global.automationRules      ← 클라우드에서 받은 것. 엔진(②/④/⑤)이 쓴다.
//     · SQLite automation_rules     ← 로컬 REST(GET /api/automation/:farmId)가 읽는다.
//   이 함수는 global 에만 넣고 SQLite 에는 쓰지 않았다. 그 결과 팜로컬 모드에서
//   자동화 화면이 "규칙 0개"로 보였다 — 엔진은 5개를 돌리고 있는데도.
//
// 무엇이 달라지나:
//   출력 1 (기존) — ④ 시간 스케줄러로 규칙 전달. 그대로다.
//   출력 2 (신규) — 같은 규칙을 SQLite 에 복사한다.
//       · INSERT OR REPLACE 로 전부 넣고(멱등), 이번 목록에 없는 id 만 지운다.
//       · sqlite 노드는 문장을 직렬로 처리하지 않는다. v2 처럼 "DELETE 먼저, INSERT 뒤"로
//         보내면 DELETE 가 첫 INSERT 뒤에 실행돼 규칙 하나가 사라졌다(5개 중 4개).
//         v3 는 어느 순서로 실행돼도 결과가 같다.
//       · synced=1 로 넣는다 — 클라우드에서 내려온 것이라 되돌려 보낼 필요가 없다.
//         이 표시를 빠뜨리면 「미동기화 규칙 조회」가 같은 규칙을 서버로 되쏘아 에코가 생긴다.
//       · v4: 서버가 아는 규칙은 enabled 와 무관하게 전부 미러링한다(비활성도 enabled=0 으로).
//         엔진(global)에는 켜진 것만 넣는다.
//       · '로컬에서 만들어 아직 서버로 못 보낸 규칙'은 synced=0 이 아니라 **id 형식**으로 가른다.
//         클라우드 규칙 id 는 UUID(36자), 로컬 생성 id 는 base36 짧은 문자열이다.
//         synced 로 가르면 안 되는 이유: ② 규칙 평가가 '수동 모드 스킵' 한 규칙에도
//         last_triggered_at + synced=0 을 써서, 서버가 비활성화한 규칙이 로컬에서 영영 안 지워졌다(2026-08-30 20:43 재현).
//       · last_triggered_at 을 함께 넣어야 ② 의 쿨다운이 미러링 때마다 초기화되지 않는다.
//
// 노드 설정: 출력 개수 2, 출력 2 → 「규칙 캐시 미러 (클라우드→SQLite)」.
// ============================================================

var body = msg.payload;
var apiRules = [];   // 서버가 아는 전부 (SQLite 미러용)
var allRules = [];   // 켜진 것만 (엔진용)

if (body && body.success && Array.isArray(body.data)) {
    apiRules = body.data
        .map(function (r) {
            return {
                id: r._id || r.id,
                farm_id: r.farmId,
                house_id: r.houseId,
                name: r.name,
                enabled: r.enabled === true ? 1 : 0,
                condition_logic: r.conditionLogic || 'AND',
                group_logic: r.groupLogic || 'AND',
                conditions: JSON.stringify(r.conditions),
                actions: JSON.stringify(r.actions),
                cooldown_seconds: r.cooldownSeconds || 60,
                priority: r.priority || 10,
                last_triggered_at: r.lastTriggeredAt,
                trigger_count: r.triggerCount || 0
            };
        });
    allRules = apiRules.filter(function (r) { return r.enabled === 1; });
}

global.set('automationRules', allRules);
global.set('automationRulesUpdatedAt', new Date().toISOString());
node.warn('📋 자동화 규칙 캐시: ' + allRules.length + '개 (API)');
node.status({
    fill: 'green', shape: 'dot',
    text: allRules.length + '개 규칙 (' + new Date().toLocaleTimeString() + ')'
});

// ── 출력 2: SQLite 미러링 (v3, 순서 무관) ─────────────────
var farmId = (apiRules[0] && apiRules[0].farm_id)
    || env.get('FARM_ID')
    || global.get('farmId')
    || 'farm_0001';

var dbMsgs = [];
var ids = [];
var nowIso = new Date().toISOString();

for (var i = 0; i < apiRules.length; i++) {
    var r = apiRules[i];
    ids.push(r.id);
    dbMsgs.push({
        topic: 'INSERT OR REPLACE INTO automation_rules '
            + '(id, farm_id, house_id, name, description, enabled, condition_logic, group_logic, '
            + 'conditions, actions, cooldown_seconds, priority, trigger_count, last_triggered_at, synced, created_at, updated_at) '
            + 'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16)',
        payload: [
            r.id, r.farm_id, r.house_id, r.name, '',
            r.enabled, r.condition_logic, r.group_logic,
            r.conditions, r.actions, r.cooldown_seconds, r.priority,
            r.trigger_count || 0, r.last_triggered_at || null, nowIso, nowIso
        ]
    });
}

// 서버에서 사라진 규칙만 로컬에서 제거. UUID(36자) = 클라우드가 발급한 id 만 대상 —
// 짧은 base36 id 는 로컬에서 만들어 아직 안 올라간 규칙이므로 남긴다. 목록이 비면 UUID 행 전부.
var placeholders = ids.map(function (_, k) { return '$' + (k + 2); }).join(',');
dbMsgs.push({
    topic: 'DELETE FROM automation_rules WHERE farm_id = $1 AND length(id) = 36'
        + (ids.length ? ' AND id NOT IN (' + placeholders + ')' : ''),
    payload: [farmId].concat(ids)
});

// 출력 1: ④ 시간 스케줄러
msg.automationRules = allRules;
return [msg, dbMsgs];
