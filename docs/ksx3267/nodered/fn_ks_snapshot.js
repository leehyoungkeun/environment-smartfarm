// ============================================================
// "표준 구동기 1분 스냅샷" (fn_ks_snapshot) — KS X 3267 표준노드 탭 (2026-08-30, 116 검정)
// inject(60초) → 이 함수 → http request(서버 POST /internal/actuator-status) → "스냅샷 전송 결과"
//
// 왜: KOAT 116 「통합제어기」는 구동기 상태정보를 1분 단위로 저장·조회·추출하고 24시간 손실률(≤3%)을 잰다.
//      드라이버(ks3267d)는 상태 변화 + 60초 하트비트로 NR 전역 ks3267State 를 갱신한다.
// 원칙: 값을 지어내지 않는다 — 3분 넘게 갱신 없는 노드(데몬 중단·버스 단선)는 행을 만들지 않는다 (= 손실로 드러난다).
//       전송 실패분은 flow 큐에 남겨 다음 분에 함께 재전송 (서버는 PK 로 중복 무시 → 멱등). 큐 상한 20,000행.
// ============================================================
const config = global.get('houseConfig') || {};
const all = global.get('ks3267State') || {};
const now = Date.now();
const STALE_MS = 180000;
const minuteIso = new Date(Math.floor(now / 60000) * 60000).toISOString();

const rows = [];
for (const house of (config.houses || [])) {
    for (const d of (house.devices || [])) {
        const m = d.modbus;
        if (!m || m.protocol !== 'ks3267') continue;
        const st = all[m.unit] || all[String(m.unit)];
        if (!st || !st.devices) continue;
        const rec = Date.parse(st.receivedAt || '') || 0;
        if (now - rec > STALE_MS) continue;                       // 낡은 상태는 기록하지 않는다
        const dev = Object.values(st.devices).find(x => x.kind === m.kind && Number(x.n) === Number(m.n));
        if (!dev) continue;
        rows.push({
            timestamp: minuteIso, houseId: house.houseId, deviceId: d.deviceId,
            unit: Number(m.unit), kind: m.kind, n: Number(m.n),
            status: Number(dev.status), statusName: dev.status_name || null,
            remain: Number(dev.remain) || 0, opid: Number(dev.opid) || 0
        });
    }
}

let queue = (flow.get('ksSnapshotQueue') || []).concat(rows);
if (queue.length > 20000) queue = queue.slice(queue.length - 20000);
flow.set('ksSnapshotQueue', queue);

if (queue.length === 0) {
    node.status({ fill: 'grey', shape: 'ring', text: '표준 장치 없음/상태 낡음 — 기록 없음' });
    return null;
}

const BATCH = 5000;
const pcServer = global.get('pcServerUrl') || 'https://api.smartgreen.kr';
msg.method = 'POST';
msg.url = pcServer + '/internal/actuator-status';
msg.headers = { 'Content-Type': 'application/json', 'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || '' };
msg.payload = { farmId: global.get('farmId') || env.get('FARM_ID') || 'farm_0001', rows: queue.slice(0, BATCH) };
msg.requestTimeout = 10000;
msg._sent = Math.min(queue.length, BATCH);
node.status({ fill: 'blue', shape: 'dot', text: '전송 ' + msg._sent + '행 (이번 분 ' + rows.length + ')' });
return msg;
