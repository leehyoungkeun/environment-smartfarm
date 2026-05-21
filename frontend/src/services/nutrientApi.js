// frontend/src/services/nutrientApi.js
// 양액 관리 API 헬퍼 (Phase 2)
// AuthContext 의 axios interceptor 가 Authorization 헤더 자동 첨부
// API_BASE: apiSwitcher.getApiBase() — 클라우드(prod) 또는 RPi(farm-local)

import axios from 'axios';
import { getApiBase } from './apiSwitcher';

const base = (farmId) => `${getApiBase()}/nutrient/${farmId}`;

// 시나리오
export const listScenarios   = (farmId) => axios.get(`${base(farmId)}/scenarios`).then(r => r.data.data);
export const createScenario  = (farmId, payload) => axios.post(`${base(farmId)}/scenarios`, payload).then(r => r.data.data);
export const updateScenario  = (farmId, id, patch) => axios.put(`${base(farmId)}/scenarios/${id}`, patch).then(r => r.data.data);
export const deleteScenario  = (farmId, id) => axios.delete(`${base(farmId)}/scenarios/${id}`).then(r => r.data);
export const activateScenario = (farmId, id) => axios.post(`${base(farmId)}/scenarios/${id}/activate`).then(r => r.data);

// 설정 (탱크 / 밸브 / 경보 / 하드웨어)
export const getConfig    = (farmId) => axios.get(`${base(farmId)}/config`).then(r => r.data.data);
export const updateConfig = (farmId, patch) => axios.put(`${base(farmId)}/config`, patch).then(r => r.data.data);

// 운영 상태
export const getState   = (farmId) => axios.get(`${base(farmId)}/state`).then(r => r.data.data);
export const setMode    = (farmId, mode) => axios.put(`${base(farmId)}/state/mode`, { mode }).then(r => r.data.data);

// 경보
export const listAlerts   = (farmId, opts = {}) => {
  const params = new URLSearchParams();
  if (opts.severity) params.set('severity', opts.severity);
  if (opts.resolved !== undefined) params.set('resolved', String(opts.resolved));
  if (opts.limit) params.set('limit', String(opts.limit));
  return axios.get(`${base(farmId)}/alerts?${params}`).then(r => r.data.data);
};
export const resolveAlert = (farmId, id, action) =>
  axios.put(`${base(farmId)}/alerts/${id}/resolve`, { action }).then(r => r.data.data);

// 보정
export const listCalibrations  = (farmId, sensorType) => {
  const qs = sensorType ? `?sensorType=${sensorType}` : '';
  return axios.get(`${base(farmId)}/calibrations${qs}`).then(r => r.data.data);
};
export const createCalibration = (farmId, payload) =>
  axios.post(`${base(farmId)}/calibrations`, payload).then(r => r.data.data);

// 카운터
export const getCounters   = (farmId) => axios.get(`${base(farmId)}/counters`).then(r => r.data.data);
export const resetCounter  = (farmId, target) =>
  axios.post(`${base(farmId)}/counters/reset`, { target }).then(r => r.data.data);
export const recordFilterChange = (farmId) =>
  axios.post(`${base(farmId)}/counters/filter-change`).then(r => r.data.data);

// 수동 1회 공급 작업
export const triggerManualJob = (farmId, payload) =>
  axios.post(`${base(farmId)}/cycle/manual-trigger`, payload).then(r => r.data.data);
export const listManualJobs = (farmId, opts = {}) => {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', Array.isArray(opts.status) ? opts.status.join(',') : opts.status);
  if (opts.limit) params.set('limit', String(opts.limit));
  return axios.get(`${base(farmId)}/cycle/manual-jobs?${params}`).then(r => r.data.data);
};
export const cancelManualJob = (farmId, id) =>
  axios.delete(`${base(farmId)}/cycle/manual-jobs/${id}`).then(r => r.data.data);
export const abortManualJob = (farmId) =>
  axios.post(`${base(farmId)}/cycle/abort`).then(r => r.data.data);
export const startManualQueue = (farmId) =>
  axios.post(`${base(farmId)}/cycle/manual-start`).then(r => r.data.data);
export const pauseManualQueue = (farmId) =>
  axios.post(`${base(farmId)}/cycle/manual-pause`).then(r => r.data.data);
