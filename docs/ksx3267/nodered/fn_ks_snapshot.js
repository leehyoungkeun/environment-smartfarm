// ============================================================
// "표준 구동기 1분 스냅샷" (fn_ks_snapshot) — KS X 3267 표준노드 탭 (2026-08-30, 116 검정)
// inject(60초) → 이 함수 → http request(서버 POST /internal/actuator-status) → "스냅샷 전송 결과"
//
// 왜: KOAT 116 「통합제어기」는 구동기 상태정보를 1분 단위로 저장·조회·추출하고 24시간 손실률(≤3%)을 잰다.
//      드라이버(ks3267d)는 상태 변화 + 60초 하트비트로 NR 전역 ks3267State 를 갱신한다.
// 원칙: 값을 지어내지 않는다 — 3분 넘게 갱신 없는 노드(데몬 중단·버스 단선)는 행을 만들지 않는다 (= 손실로 드러난다).
//       전송 실패분은 flow 큐에 남겨 다음 분에 함께 재전송 (서버는 PK 로 중복 무시 → 멱등). 큐 상한 20,000행.
//
// 2026-09-19 표준·비표준 저장 정책 통일:
//   · 비표준(Waveshare 릴레이) 장치도 같은 1분 행을 만든다 — 「응답 포맷」(릴레이 MQTT 상태 탭)이 30초마다 FC1 로 읽어
//     global.vendorCoils 에 둔 실제 코일 상태로. 상태코드는 표준과 같게: 스위치 켜짐 201 / 꺼짐 0, 개폐기 열림 코일 301 /
//     닫힘 코일 302 / 둘 다 꺼짐 0. 3분 넘게 못 읽었으면 행을 만들지 않는다(손실로 드러남). source='vendor'.
//   · 출력 2 → 드라이버 POST /local/vendor-actuator {rows, retentionDays}: 제어기 로컬 1분 저장도 표준과 한곳에,
//     로컬 보관 일수는 서버 설정(global.retentionDays, 매일 03:00 갱신)을 따른다. 드라이버가 살아 있을 때만 보낸다.
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

// 비표준(벤더) 구동기 1분 행 — 실제로 읽은 코일 상태로 (2026-09-19)
const vc = global.get('vendorCoils') || {};
const vendorRows = [];
for (const house of (config.houses || [])) {
    for (const d of (house.devices || [])) {
        const m = d.modbus;
        if (!m || m.protocol === 'ks3267' || m.unitId === undefined || m.unitId === null || m.address === undefined || m.address === null) continue;
        const cs = vc[String(m.unitId)];
        if (!cs || !cs.coils || now - (cs.t || 0) > STALE_MS) continue;   // 못 읽은 모듈은 기록하지 않는다
        const bidir = m.controlType === 'bidir';
        const on = !!cs.coils[String(m.address)];
        const close = bidir && m.address2 !== undefined && m.address2 !== null && !!cs.coils[String(m.address2)];
        const status = bidir ? (on ? 301 : (close ? 302 : 0)) : (on ? 201 : 0);
        const row = {
            timestamp: minuteIso, houseId: house.houseId, deviceId: d.deviceId, name: d.name || d.deviceId,
            unit: Number(m.unitId), kind: bidir ? 'opener' : 'switch', n: Number(m.address) + 1,
            status: status, statusName: status === 201 ? 'ON' : status === 301 ? 'OPENING' : status === 302 ? 'CLOSING' : 'READY',
            remain: 0, opid: 0, source: 'vendor'
        };
        rows.push(row);
        vendorRows.push(row);
    }
}

// 표준 센서 1분 스냅샷 (SPS-7466 §5.4.4 c·d, 2026-09-15) — 탐색된 표준 센서 노드의 **모든** 센서 관측치·상태를 매분 남긴다.
// 운영 파이프라인(③ 수집)은 상태 101~103 인 값을 일부러 생략하지만, 여기는 상태가 무엇이든 그대로 기록한다(시험·116 센서 상태정보).
// 매핑(하우스/센서)이 있으면 house_id/sensor_id 를 같이 적는다. 같은 요청의 sensorRows 로 보낸다(서버 표 ks_sensor_status).
const sensorRows = [];
const mapOf = {};
for (const house of (config.houses || [])) {
    for (const s of (house.sensors || [])) {
        if (s.ks3267) mapOf[Number(s.ks3267.unit) + ':' + Number(s.ks3267.index)] = { houseId: house.houseId, sensorId: s.sensorId };
    }
}
for (const unitKey of Object.keys(all)) {
    const st = all[unitKey];
    if (!st || st.kind !== 'sensor' || !st.sensors) continue;
    const rec = Date.parse(st.receivedAt || '') || 0;
    if (now - rec > STALE_MS) continue;
    for (const idxKey of Object.keys(st.sensors)) {
        const r = st.sensors[idxKey];
        if (!r || r.status === undefined) continue;
        const m = mapOf[Number(unitKey) + ':' + Number(idxKey)] || {};
        sensorRows.push({
            timestamp: minuteIso, unit: Number(unitKey), idx: Number(idxKey), code: Number(r.code) || null, name: r.name || null,
            value: (typeof r.value === 'number' && isFinite(r.value)) ? r.value : null,
            status: Number(r.status), statusName: r.status_name || null, houseId: m.houseId || null, sensorId: m.sensorId || null
        });
    }
}

let queue = (flow.get('ksSnapshotQueue') || []).concat(rows);
if (queue.length > 20000) queue = queue.slice(queue.length - 20000);
flow.set('ksSnapshotQueue', queue);
let squeue = (flow.get('ksSensorSnapshotQueue') || []).concat(sensorRows);
if (squeue.length > 60000) squeue = squeue.slice(squeue.length - 60000);   // 30센서 × 2000분
flow.set('ksSensorSnapshotQueue', squeue);

// 출력 2 — 드라이버 로컬 저장(비표준 행) + 보관 일수 동기화. 드라이버가 상태를 보내오고 있을 때만(없는 농장에서 매분 오류 방지)
let local = null;
if (Object.keys(all).length > 0) {
    local = { method: 'POST', url: (env.get('KS3267_API') || 'http://127.0.0.1:3002') + '/local/vendor-actuator',
              headers: { 'Content-Type': 'application/json' }, requestTimeout: 5000,
              payload: { rows: vendorRows, retentionDays: global.get('retentionDays') || 60 } };
}

if (queue.length === 0 && squeue.length === 0) {
    node.status({ fill: 'grey', shape: 'ring', text: '장치·센서 없음/상태 낡음 — 기록 없음' });
    return [null, local];
}

const BATCH = 5000;
const pcServer = global.get('pcServerUrl') || 'https://api.smartgreen.kr';
msg.method = 'POST';
msg.url = pcServer + '/internal/actuator-status';
msg.headers = { 'Content-Type': 'application/json', 'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || '' };
msg.payload = { farmId: global.get('farmId') || env.get('FARM_ID') || 'farm_0001', rows: queue.slice(0, BATCH), sensorRows: squeue.slice(0, BATCH) };
msg.requestTimeout = 10000;
msg._sent = Math.min(queue.length, BATCH);
msg._sentSensors = Math.min(squeue.length, BATCH);
node.status({ fill: 'blue', shape: 'dot', text: '전송 장치 ' + msg._sent + '·센서 ' + msg._sentSensors + '행 (이번 분 ' + rows.length + '(비표준 ' + vendorRows.length + ')/' + sensorRows.length + ')' });
return [msg, local];
