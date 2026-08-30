// 데이터 추출 (KOAT 검정기준 116 「통합제어기」 4.가.1)마)·2)바): 센서·구동기 저장 데이터를
// 1분 단위 · 조회기간(1일/7일/30일) 으로 .csv/.txt 파일로 추출한다. 순수 함수 — 라우트와 프론트가 같이 쓴다.
//
// 원칙: 값을 지어내지 않는다. 빈 셀은 빈 셀로(0 이 아니다). 시각은 서버 TZ(Asia/Seoul) 의 벽시계 문자열.

/** 파일 형식 → 구분자·MIME·확장자 (xls 는 Excel 이 그대로 여는 BOM 붙은 CSV) */
export const FORMATS = {
  csv: { sep: ",", mime: "text/csv; charset=utf-8", ext: "csv", bom: true },
  txt: { sep: "\t", mime: "text/plain; charset=utf-8", ext: "txt", bom: true },
  xls: { sep: ",", mime: "application/vnd.ms-excel; charset=utf-8", ext: "xls", bom: true },
};

export function formatSpec(format) {
  return FORMATS[String(format || "csv").toLowerCase()] || FORMATS.csv;
}

/** CSV/TSV 셀 이스케이프 (RFC 4180) */
export function csvCell(v, sep = ",") {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? formatTs(v) : String(v);
  if (s.includes('"') || s.includes(sep) || s.includes("\n") || s.includes("\r")) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 서버 TZ 벽시계 'YYYY-MM-DD HH:mm:ss' (ecosystem 이 TZ=Asia/Seoul 을 보장) */
export function formatTs(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/** 표 → 텍스트. columns: [{key, label}] */
export function toDelimited(rows, columns, format = "csv") {
  const { sep, bom } = formatSpec(format);
  const lines = [columns.map((c) => csvCell(c.label, sep)).join(sep)];
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(r[c.key], sep)).join(sep));
  }
  return (bom ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}

/**
 * sensor_data 행({timestamp, data:{sensorId: value}}) → 1분 1행, 센서별 열.
 * sensorIds 를 주면 그 순서·그 열만, 없으면 데이터에 나온 센서를 이름순으로.
 */
export function sensorTable(rows, sensorIds) {
  let ids = sensorIds && sensorIds.length ? sensorIds : null;
  if (!ids) {
    const s = new Set();
    for (const r of rows) for (const k of Object.keys(r.data || {})) s.add(k);
    ids = [...s].sort();
  }
  const columns = [{ key: "timestamp", label: "timestamp" }, ...ids.map((id) => ({ key: id, label: id }))];
  const out = rows.map((r) => {
    const o = { timestamp: formatTs(r.timestamp) };
    for (const id of ids) {
      const v = r.data ? r.data[id] : undefined;
      o[id] = v === undefined || v === null ? "" : v;
    }
    return o;
  });
  return { columns, rows: out };
}

/** control_logs → 표 */
export function controlLogTable(logs) {
  const columns = [
    { key: "timestamp", label: "timestamp" }, { key: "houseId", label: "house_id" }, { key: "deviceId", label: "device_id" },
    { key: "deviceType", label: "device_type" }, { key: "deviceName", label: "device_name" }, { key: "command", label: "command" },
    { key: "success", label: "success" }, { key: "operator", label: "operator" }, { key: "operatorName", label: "operator_name" },
    { key: "isAutomatic", label: "automatic" }, { key: "automationReason", label: "reason" }, { key: "error", label: "error" },
  ];
  const rows = logs.map((l) => ({
    timestamp: formatTs(l.timestamp || l.createdAt), houseId: l.houseId, deviceId: l.deviceId, deviceType: l.deviceType,
    deviceName: l.deviceName, command: l.command, success: l.success === false ? "N" : "Y", operator: l.operator,
    operatorName: l.operatorName, isAutomatic: l.isAutomatic ? "Y" : "N", automationReason: l.automationReason || "", error: l.error || "",
  }));
  return { columns, rows };
}

/** actuator_status(표준 구동기 1분 스냅샷) → 표 */
export function actuatorStatusTable(rows) {
  const columns = [
    { key: "timestamp", label: "timestamp" }, { key: "house_id", label: "house_id" }, { key: "device_id", label: "device_id" },
    { key: "unit", label: "unit" }, { key: "kind", label: "kind" }, { key: "n", label: "n" },
    { key: "status", label: "status" }, { key: "status_name", label: "status_name" }, { key: "remain", label: "remain_sec" }, { key: "opid", label: "opid" },
  ];
  return { columns, rows: rows.map((r) => ({ ...r, timestamp: formatTs(r.timestamp) })) };
}

/** Content-Disposition 파일명 (ASCII 안전) */
export function exportFilename(kind, farmId, houseId, start, end, format) {
  const d = (x) => formatTs(x).slice(0, 10).replace(/-/g, "");
  const parts = [kind, farmId, houseId, `${d(start)}-${d(end)}`].filter(Boolean);
  return `${parts.join("_")}.${formatSpec(format).ext}`;
}

/** 조회기간 파라미터 → [start, end] (기본 24시간, 최대 31일) */
export function resolveRange(startDate, endDate, { maxDays = 31, defaultHours = 24 } = {}) {
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end.getTime() - defaultHours * 3600 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("startDate/endDate 형식 오류");
  if (end < start) throw new Error("endDate 가 startDate 보다 앞선다");
  if (end - start > maxDays * 86400 * 1000) throw new Error(`조회기간은 최대 ${maxDays}일`);
  return [start, end];
}
