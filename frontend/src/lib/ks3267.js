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

/** KS 센서 디바이스 코드(A.1.2) → 종류·표기 단위. 단위는 화면 표기용(노드가 주지 않음; 불확실한 건 비움). */
export const KS_SENSOR_KIND = {
  1: ['온도', '°C'], 2: ['습도', '%'], 3: ['이슬점', '°C'], 4: ['감우', ''], 5: ['유량', ''], 6: ['강우', 'mm'],
  7: ['일사', 'W/m²'], 8: ['풍속', 'm/s'], 9: ['풍향', '°'], 10: ['전압', 'V'], 11: ['CO2', 'ppm'], 12: ['EC', ''],
  13: ['광양자', 'µmol/m²/s'], 14: ['토양함수율', '%'], 15: ['토양수분장력', 'kPa'], 16: ['pH', ''], 17: ['지온', '°C'], 18: ['무게', 'kg'],
};

/** 노드 데이터 읽기 시험표 (SPS-X KOAT-0004-7466 §5.1.3 b·c).
 *  node : 노드 상태코드(레지스터 201/202) — 읽은 코드·의미·판정(정의된 코드인가)
 *  rows : 디바이스별 상태코드(숫자+의미)·관측치(+단위)·남은시간/OPID·판정
 *  판정 기준: 상태코드가 표 B.x 에 정의된 값이면 ✓(0~6 정상군/오류군, 101~103 점검군, 201/299, 301/302/399, 900~999 제조사);
 *            센서는 관측치가 유한한 숫자여야 ✓. 값의 "적절한 범위" 는 장비스펙(시험장비 설정값)과 대조 — 화면은 값·단위·시각을 드러낸다. */
export function nodeReadRows(node, st) {
  if (!node) return null;
  const readAt = st && st.t ? new Date(st.t * 1000) : null;
  const known = (s) => !/^알 수 없음/.test(s.text) && s.text !== '—';
  const nodeSt = st && !st.error ? describeStatus(st.node_status) : null;
  const nodeRow = {
    code: st && !st.error ? Number(st.node_status) : null,
    meaning: nodeSt ? nodeSt.text : (st && st.error ? (st.error === 'timeout' ? '응답 없음' : st.error) : '—'),
    tone: nodeSt ? nodeSt.tone : 'bad',
    ok: nodeSt ? known(nodeSt) : null,
    reg: 202, // 노드 상태코드 레지스터 — 센서 노드(A.1.3)·구동기 노드(A.2.3) 모두 202 (201 은 구동기 노드 OPID)
  };
  const rows = discoveryRows(node).map((r) => {
    const out = { index: r.index, name: r.name, kind: r.kind, supported: r.supported, code: null, meaning: '—', tone: 'muted', ok: null, value: null, unit: '', remain: null, opid: null };
    if (!st || st.error) return out;
    if (r.kind === 'sensor') {
      const sv = st.sensors?.[r.index];
      if (!sv) return out;
      const s = describeStatus(sv.status);
      const k = KS_SENSOR_KIND[Number(sv.code)] || KS_SENSOR_KIND[Number(node.devices?.find(d => d.index === r.index)?.code)];
      Object.assign(out, { code: Number(sv.status), meaning: s.text, tone: s.tone, value: sv.value, unit: k ? k[1] : '',
        ok: known(s) && Number.isFinite(Number(sv.value)) });
    } else {
      const dv = st.devices?.[r.index];
      if (!dv) return out;
      const s = describeStatus(dv.status);
      Object.assign(out, { code: Number(dv.status), meaning: s.text, tone: s.tone, remain: Number(dv.remain) || 0, opid: dv.opid ?? null, ok: known(s) });
    }
    return out;
  });
  const judged = rows.filter((r) => r.ok !== null);
  return { readAt, node: nodeRow, rows, fail: judged.filter((r) => r.ok === false).length + (nodeRow.ok === false ? 1 : 0), unread: rows.length - judged.length };
}

/** 배지용 남은시간 로컬 카운트다운 — 드라이버가 읽은 시각(ks.t, epoch 초) 이후 흐른 시간을 빼서 초 단위로 보여준다.
 *  폴링 사이(2~30초)에도 숫자가 흐르고, 다음 폴링 값으로 재동기된다. 시계 편차·미래 시각은 [0, remain] 으로 클램프. */
export function ksRemainNow(ks, nowMs) {
  if (!ks || !(ks.remain > 0)) return 0;
  const t = Number(ks.t);
  if (!Number.isFinite(t) || t <= 0) return Math.round(ks.remain);
  const elapsed = Math.max(0, nowMs / 1000 - t);
  return Math.max(0, Math.min(Math.round(ks.remain), Math.round(ks.remain - elapsed)));
}

/** 카운트다운 앵커 — 폴링 샘플(remain 초)을 브라우저 시계의 "종료 시각" 하나로 고정한다.
 *  샘플마다 다시 계산하면 노드의 정수 초·폴링 위상·응답 지연·RPi/브라우저 시계 편차가 겹쳐 재동기 때마다 기준이 흔들린다(불규칙).
 *  새 샘플의 종료 시각이 기존 앵커와 tolMs 안이면 기존을 유지하고, 그 이상 벌어질 때(재명령·실제 변화)만 새로 고정. remain 0 이면 앵커 해제(null). */
export function ksAnchorEnd(prevEndAt, remain, nowMs, tolMs = 1500) {
  if (!(remain > 0)) return null;
  const fresh = nowMs + remain * 1000;
  if (prevEndAt && Math.abs(fresh - prevEndAt) <= tolMs) return prevEndAt;
  return fresh;
}

/** 샘플 나이(초) — 데몬이 준 현재시각(now, RPi epoch)과 폴링 시각(t) 의 차. 둘 다 RPi 시계라 브라우저와의 편차가 상쇄된다.
 *  now 가 없으면(구 드라이버) 0 으로 본다. */
export function ksSampleAgeSec(stateNow, ks) {
  const n = Number(stateNow), t = Number(ks && ks.t);
  if (!Number.isFinite(n) || !Number.isFinite(t) || n <= 0 || t <= 0) return 0;
  return Math.max(0, n - t);
}

/** 샘플이 명령보다 오래됐는가 — (지금 − 나이) 가 명령 시각보다 앞이면 그 샘플은 명령 이전의 노드 상태라 앵커·버튼 동기화에 쓰면 안 된다.
 *  (OFF 뒤 도착한 'remain 12' 옛 샘플이 카운트다운을 되살리던 사고, 2026-09-04) */
export function ksSampleIsStaleForCommand(ageSec, cmdAtMs, nowMs, marginMs = 300) {
  if (!cmdAtMs) return false;
  return nowMs - ageSec * 1000 < cmdAtMs + marginMs;
}

/** 나이를 반영한 앵커 — 샘플의 remain 은 t 시점 값이므로 (remain − 나이) 가 지금 남은 초. 그걸로 ksAnchorEnd. */
export function ksAnchorFromSample(prevEndAt, remainSec, ageSec, nowMs, tolMs = 1500) {
  return ksAnchorEnd(prevEndAt, remainSec - ageSec, nowMs, tolMs);
}

/** KS 레벨1 개폐기 동작 진행 — 노드는 위치 레지스터가 없고(위치 지정은 레벨2) 상태(301/302)와 남은시간만 준다.
 *  motion = { direction:'open'|'close', startAt(ms), totalSec, startPos(0~100|null) }, fullSec = 완전 개폐 소요시간(초, 설정값 또는 노드가 알려준 값, 없으면 null)
 *  반환 { percent: 시간 진행 0~100, remainSec, actualPos: 위치 추정(0~100) | undefined(fullSec 없으면) }
 *  위치 추정 = 시작 위치 ± (경과초 / 완전개폐초) × 100, 0~100 클램프. 시간 진행은 fullSec 없이도 항상 계산된다. */
export function ksMotionProgress(motion, nowMs, fullSec) {
  if (!motion) return null;
  const elapsed = Math.max(0, (nowMs - motion.startAt) / 1000);
  if (!(motion.totalSec > 0)) {
    // 총 시간 미정(완전 개폐 시간을 아직 모르는 일반 열기/닫기): 방향·"동작 중"만 즉시 표시, 숫자는 샘플 후 채워진다
    return { percent: 0, remainSec: undefined, direction: motion.direction, totalSec: null, actualPos: undefined, indeterminate: true };
  }
  const frac = Math.min(1, elapsed / motion.totalSec);
  const out = { percent: Math.round(frac * 100), remainSec: Math.max(0, Math.ceil(motion.totalSec - elapsed)), direction: motion.direction, totalSec: motion.totalSec };
  if (fullSec > 0 && typeof motion.startPos === 'number') {
    const delta = (Math.min(elapsed, motion.totalSec) / fullSec) * 100;
    out.actualPos = Math.round(Math.max(0, Math.min(100, motion.direction === 'open' ? motion.startPos + delta : motion.startPos - delta)));
  }
  return out;
}

/** 끝까지 가는 데 필요한 초 — 위치(0~100)와 완전 개폐 시간으로. 벤더 측창이 하던 계산과 같다(과주행 방지).
 *  모르면(null) 호출자가 일반 301/302 를 보낸다. 최소 1초, 올림. */
export function ksNeededSec(direction, pos, fullSec) {
  if (!(fullSec > 0) || typeof pos !== 'number' || !Number.isFinite(pos)) return null;
  const p = Math.max(0, Math.min(100, pos));
  const ratio = direction === 'open' ? (100 - p) / 100 : p / 100;
  if (ratio <= 0) return 0;   // 이미 끝 — 보낼 필요 없음
  return Math.max(1, Math.ceil(fullSec * ratio));
}

/** 추정 위치가 끝(열기 100 / 닫기 0)에 닿았는가 — 시간 지정 명령이 끝을 넘겨 계속 돌 때 자동 정지 판단 */
export function ksReachedEnd(direction, actualPos) {
  if (typeof actualPos !== 'number') return false;
  return direction === 'open' ? actualPos >= 100 : actualPos <= 0;
}

/** 앵커 기준 남은 초 — ceil 이라 12,11,…,1 을 각각 꽉 채워 보여주고 0 에서 끝난다. */
export function ksRemainFromEnd(endAt, nowMs) {
  if (!endAt) return 0;
  return Math.max(0, Math.ceil((endAt - nowMs) / 1000));
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
