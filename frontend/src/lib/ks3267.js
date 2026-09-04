// KS X 3267:2022 표준 노드 — UI 순수 로직 (React 무의존, node:test 로 검증: backend/test/unit/ks3267-ui-lib.test.js)
// 데몬(ks3267d) 응답을 화면 표(row)로 바꾸고, houseConfig 매핑을 검증한다.

/** 상태 코드 → 사람이 읽는 표기 + 톤 (표 B.x 상태코드) */
export function describeStatus(code) {
  const c = Number(code);
  if (code === null || code === undefined || Number.isNaN(c)) return { text: '—', tone: 'muted' };
  const T = {
    0: ['정상', 'ok'], 1: ['오류', 'bad'], 2: ['동작중', 'busy'], 3: ['전압 이상', 'bad'], 4: ['전류 이상', 'bad'],
    5: ['온도 이상', 'bad'], 6: ['퓨즈 이상', 'bad'],
    101: ['교체 필요', 'warn'], 102: ['보정 필요', 'warn'], 103: ['점검 필요', 'warn'],
    201: ['켜짐', 'on'], 299: ['수동 조작중', 'warn'],
    301: ['열리는 중', 'busy'], 302: ['닫히는 중', 'busy'], 399: ['수동 조작중', 'warn'],
  };
  if (T[c]) return { text: T[c][0], tone: T[c][1], code: c };
  if (c >= 900 && c <= 999) return { text: `제조사 오류 ${c}`, tone: 'bad', code: c };
  return { text: `알 수 없음 ${c}`, tone: 'muted', code: c };
}

/** 표준 프로필인가 */
export function isKsProfile(m) {
  return !!m && m.protocol === 'ks3267';
}

/** 장치 목록 표기 (설정 화면 배지) */
export function ksDeviceLabel(m) {
  if (!isKsProfile(m)) return '';
  const kind = m.kind === 'opener' ? '개폐기' : m.kind === 'switch' ? '스위치' : m.kind || '?';
  return `표준 U${m.unit ?? '?'} ${kind}${m.n ?? '?'}`;
}

/** houseConfig 의 표준 프로필 검증 — 저장 전에 UI 가 막는다 */
export function validateKsProfile(m) {
  const errs = [];
  if (!isKsProfile(m)) return ['protocol 이 ks3267 가 아님'];
  const u = Number(m.unit);
  if (!Number.isInteger(u) || u < 1 || u > 247) errs.push('노드 주소(unit)는 1~247');
  if (m.kind !== 'switch' && m.kind !== 'opener') errs.push('종류는 스위치 또는 개폐기');
  const n = Number(m.n);
  const max = m.kind === 'opener' ? 8 : 16;
  if (!Number.isInteger(n) || n < 1 || n > max) errs.push(`번호는 1~${max} (${m.kind === 'opener' ? '개폐기 8' : '스위치 16'})`);
  return errs;
}

/** 표준 센서 매핑 검증 */
export function validateKsSensor(k) {
  const errs = [];
  if (!k) return ['ks3267 매핑 없음'];
  const u = Number(k.unit);
  if (!Number.isInteger(u) || u < 1 || u > 247) errs.push('노드 주소(unit)는 1~247');
  const i = Number(k.index);
  if (!Number.isInteger(i) || i < 1 || i > 30) errs.push('센서 순번은 1~30');
  return errs;
}

/**
 * 탐색 결과(데몬 /discover 의 node) → 표 행.
 * 미지원(레벨2·자동등록·복합 노드)은 supported:false + note 로 표기하고 매핑 후보에서 뺀다.
 */
export function discoveryRows(node) {
  if (!node || !Array.isArray(node.devices)) return [];
  const isSensor = node.kind === 'sensor';
  return node.devices.map((d) => ({
    index: d.index,
    code: d.code,
    kind: isSensor ? 'sensor' : d.kind,
    n: isSensor ? d.index : d.n,
    name: d.name || (isSensor ? `센서${d.index}` : `${d.kind}${d.n}`),
    supported: isSensor ? true : d.supported !== false,
    level: d.level ?? null,
    note: d.note || '',
    registers: isSensor
      ? `값 ${d.value_reg}~${d.value_reg + 1} / 상태 ${d.status_reg}`
      : d.status ? `상태 ${d.status.opid}~${d.status.remain?.[1] ?? '?'} / 명령 ${d.cmd?.cmd}~${d.cmd?.time?.[1] ?? '?'}` : '',
  }));
}

/** 노드 헤더 요약 (정보 카드) */
export function nodeSummary(node) {
  if (!node) return null;
  const kind = { sensor: '센서 노드', actuator: '구동기 노드', integrated: '복합 노드', unknown: '알 수 없음' }[node.kind] || node.kind;
  return {
    unit: node.unit,
    kind,
    supported: !!node.supported,
    defaultMap: !!node.default_map,
    protocolVersion: node.protocol_version,
    channels: node.channels,
    serial: node.serial,
    company: node.company_code,
    product: `${node.product_type}/${node.product_code}`,
    notes: node.notes || [],
  };
}

/** 노드정보 1~8 시험표 (SPS-X KOAT-0004-7466 §5.1.2 c) — 읽은값 / 기대값 / 일치 여부).
 *  ok: true=일치, false=불일치, null=참고(고정 기대값 없음, 시리얼). */
export function nodeInfoRows(node) {
  if (!node) return [];
  const pt = Number(node.product_type);
  const chExpect = pt === 1 ? 30 : pt === 2 ? 24 : null;
  const eq = (v, want) => v !== undefined && v !== null && Number(v) === want;
  const show = (v) => (v === undefined || v === null ? '—' : String(v));
  return [
    { reg: '1', label: '기관코드', read: show(node.cert_authority), expect: '0', ok: eq(node.cert_authority, 0) },
    { reg: '2', label: '회사코드', read: show(node.company_code), expect: '0', ok: eq(node.company_code, 0) },
    { reg: '3', label: '제품타입', read: show(node.product_type), expect: '1 또는 2', ok: pt === 1 || pt === 2 },
    { reg: '4', label: '제품코드', read: show(node.product_code), expect: '0', ok: eq(node.product_code, 0) },
    { reg: '5', label: '프로토콜버전', read: show(node.protocol_version), expect: '10', ok: eq(node.protocol_version, 10) },
    { reg: '6', label: '채널수', read: show(node.channels), expect: chExpect === null ? '30(타입1)/24(타입2)' : `${chExpect} (타입${pt})`, ok: chExpect !== null && eq(node.channels, chExpect) },
    { reg: '7·8', label: '시리얼번호', read: show(node.serial), expect: '참고', ok: null },
  ];
}

export function mappingKey(unit, kind, n) {
  return `U${unit}:${kind}:${n}`;
}

/**
 * 우리 장치·센서 ↔ 표준 노드 디바이스 매핑 색인.
 * houses: houseConfig.houses. 반환 { map: { 'U1:switch:3': [{houseId,houseName,deviceId,name}], ... }, duplicates: [...] }
 * 한 디바이스에 둘 이상 매핑되면 duplicates 에 모은다 (저장 전 경고).
 */
export function mappingIndex(houses) {
  const map = {};
  const push = (key, item) => { (map[key] = map[key] || []).push(item); };
  for (const h of houses || []) {
    for (const d of h.devices || []) {
      if (isKsProfile(d.modbus)) {
        push(mappingKey(d.modbus.unit, d.modbus.kind, d.modbus.n), { houseId: h.houseId, houseName: h.name, deviceId: d.deviceId, name: d.name });
      }
    }
    for (const s of h.sensors || []) {
      if (s.ks3267 && s.ks3267.unit != null) {
        push(mappingKey(s.ks3267.unit, 'sensor', s.ks3267.index), { houseId: h.houseId, houseName: h.name, sensorId: s.sensorId, name: s.name });
      }
    }
  }
  const duplicates = Object.entries(map).filter(([, v]) => v.length > 1).map(([k]) => k);
  return { map, duplicates };
}

/** 데몬 상태(/status 의 state[unit]) 에서 우리 장치의 표준 상태를 뽑는다 (제어판 배지) */
export function deviceKsStatus(stateByUnit, m) {
  if (!isKsProfile(m) || !stateByUnit) return null;
  const st = stateByUnit[m.unit] || stateByUnit[String(m.unit)];
  if (!st) return null;
  if (st.error) return { text: '노드 응답 없음', tone: 'bad', stale: true };
  if (st.kind !== 'actuator' || !st.devices) return null;
  const dev = Object.values(st.devices).find((d) => d.kind === m.kind && Number(d.n) === Number(m.n));
  if (!dev) return null;
  const s = describeStatus(dev.status);
  return { ...s, remain: Number(dev.remain) || 0, opid: dev.opid, t: st.t };
}

/** 프레임 로그 행 (진단) */
export function frameRows(frames) {
  return (frames || []).map((f) => ({
    t: f.t, dir: f.dir, unit: f.unit, fc: f.fc, ms: f.ms != null ? Math.round(f.ms) : null,
    hex: String(f.hex || '').replace(/\s+/g, '').toUpperCase().replace(/(..)/g, '$1 ').trim(),
    error: f.error || '',
  }));
}
