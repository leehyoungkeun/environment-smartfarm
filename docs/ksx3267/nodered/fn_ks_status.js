// ============================================================
// "표준 상태 반영" (fn_ks_status) — ks3267d 데몬이 POST /api/ks3267/status 로 밀어주는 상태를
// NR 전역에 반영한다. (KS X 3267 표준노드 탭, 2026-08-30 P3)
//
// 입력 msg.payload = { source:'ks3267d', unit, state }   (데몬 poll 결과)
//   state.kind === 'sensor'   → state.sensors[index] = { value, status, status_name }
//   state.kind === 'actuator' → state.devices[index] = { kind, n, opid, status, status_name, remain }
//
// 매핑 근거는 houseConfig:
//   센서:  house.sensors[].ks3267 = { unit, index }            → 값을 global.ks3267Readings.values 에
//          **정규 복합키 'houseId:sensorId'** 로 (sensorId 만 쓰면 다른 하우스의 같은 id 와 충돌 —
//          2026-09-04 house_0002 표준 temp_0001 이 house_0001 벤더 temp_0001 값으로 덮인 사고).
//          레거시 sensorId 키도 같이 남긴다(호환) — ③ 은 복합키를 먼저 본다.
//   구동기: house.devices[].modbus = { protocol:'ks3267', unit, kind:'switch'|'opener', n }
//          → deviceStates['house_0001:fan1'] 갱신 (정규키, dkey)
// 원본 상태는 global.ks3267State[unit] 에 그대로 보관 (진단 UI·남은시간 표시용).
//
// 2026-09-19 출력 2 추가 — 구동기 상태를 AWS IoT 로 발행 (smartfarm/{farmId}/ks3267/status).
//   비표준 릴레이는 MQTT 로 화면에 실시간 반영되는데 표준 장치는 백엔드→Tailscale 폴링뿐이라, Tailscale 이 끊기면
//   표준 장치 배지만 멈췄다. 이제 같은 AWS IoT → 백엔드 → WebSocket 경로. 폴링은 폴백으로 남는다.
//   발행은 구동기만, 장치 상태코드·OPID 가 바뀔 때 + 60초 하트비트 (남은시간 감소만으로는 안 보낸다 — 화면이 셈).
//   센서는 보내지 않는다(센서는 기존 수집 파이프라인). 출력 2 → mqtt out (AWS IoT Core, 토픽 비움).
// ============================================================
const body = msg.payload || {};
const st = body.state || {};
const unit = Number(body.unit);
if (!unit || !st.kind) {
    msg.statusCode = 400; msg.payload = { success: false, error: 'unit/state 필요' };
    return [msg, null];
}

const config = global.get('houseConfig') || {};
const houses = config.houses || [];
const dkey = global.get('dkey') || function (h, dv) { return (h || 'house_0001') + ':' + dv; };

// 원본 보관 (진단·UI)
const all = global.get('ks3267State') || {};
all[unit] = Object.assign({ receivedAt: new Date().toISOString() }, st);
global.set('ks3267State', all);

let sensorsMapped = 0, devicesMapped = 0;

if (st.kind === 'sensor') {
    // 센서 → 수집 파이프라인(③)이 읽는 전역. TTL 은 ③ 쪽에서 t 로 판단한다.
    const cur = global.get('ks3267Readings') || { values: {}, t: 0 };
    const values = Object.assign({}, cur.values || {});
    for (const house of houses) {
        for (const s of (house.sensors || [])) {
            const k = s.ks3267;
            if (!k || Number(k.unit) !== unit) continue;
            const r = (st.sensors || {})[String(k.index)] || (st.sensors || {})[k.index];
            if (!r || typeof r.value !== 'number') continue;
            if (r.status >= 100) {
                // NEED_REPLACE(101)/CALIBRATION(102)/CHECK(103): 값은 있으나 신뢰 낮음 — 기록은 남기고 값은 넣지 않는다
                node.warn('⚠️ 표준 센서 ' + s.sensorId + ' 상태 ' + (r.status_name || r.status) + ' — 값 생략');
                continue;
            }
            values[dkey(house.houseId, s.sensorId)] = r.value;   // 정규 복합키 (하우스 구분)
            values[s.sensorId] = r.value;                         // 레거시 키 (호환 — ③ 은 복합키 우선)
            sensorsMapped++;
        }
    }
    global.set('ks3267Readings', { values: values, t: Date.now(), unit: unit });
} else if (st.kind === 'actuator') {
    const states = global.get('deviceStates') || {};
    for (const house of houses) {
        for (const d of (house.devices || [])) {
            const m = d.modbus;
            if (!m || m.protocol !== 'ks3267' || Number(m.unit) !== unit) continue;
            const dev = Object.values(st.devices || {}).find(x => x.kind === m.kind && Number(x.n) === Number(m.n));
            if (!dev) continue;
            const DK = dkey(house.houseId, d.deviceId);
            const code = Number(dev.status);
            if (m.kind === 'switch') {
                states[DK] = (code === 201) ? 'on' : (code === 0 ? 'off' : states[DK]);
            } else {
                // 개폐형: 301 여는 중 → open, 302 닫는 중 → closed, 0 READY 는 명령 경로가 정한 상태 유지
                if (code === 301) states[DK] = 'open';
                else if (code === 302) states[DK] = 'closed';
            }
            devicesMapped++;
        }
    }
    global.set('deviceStates', states);
}

node.status({ fill: 'green', shape: 'dot', text: 'unit ' + unit + ' ' + st.kind + ' (센서 ' + sensorsMapped + ' / 장치 ' + devicesMapped + ')' });
// ── 출력 2: AWS IoT 실시간 보고 (구동기, 상태·OPID 변화 또는 60초) ──
let mqttMsg = null;
if (st.kind === 'actuator') {
    const sig = JSON.stringify(Object.keys(st.devices || {}).sort().map(function (k) { const d = st.devices[k]; return [k, d.status, d.opid]; }));
    const sigs = context.get('ksPubSig') || {};
    const ats = context.get('ksPubAt') || {};
    const nowMs = Date.now();
    if (sig !== sigs[unit] || nowMs - (ats[unit] || 0) >= 60000) {
        sigs[unit] = sig; ats[unit] = nowMs;
        context.set('ksPubSig', sigs); context.set('ksPubAt', ats);
        const farmId = global.get('farmId') || env.get('FARM_ID') || config.farmId;
        if (farmId) {
            mqttMsg = { topic: 'smartfarm/' + farmId + '/ks3267/status', qos: 1,
                        payload: JSON.stringify({ unit: unit, now: nowMs / 1000, state: st }) };
        }
    }
}

msg.statusCode = 200;
msg.payload = { success: true, unit: unit, kind: st.kind, sensorsMapped: sensorsMapped, devicesMapped: devicesMapped, published: !!mqttMsg };
return [msg, mqttMsg];
