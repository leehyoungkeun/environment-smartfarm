#!/usr/bin/env node
/**
 * Fix SQLite parameterized queries in Node-RED flows.
 *
 * node-red-node-sqlite v1.1.1 (msg.topic mode) does NOT support msg.params.
 * It only supports msg.payload as array with $N positional parameters.
 *
 * This script updates all affected function nodes.
 */

const fs = require('fs');
const FLOWS_PATH = '/home/lhk/.node-red/flows.json';
const BACKUP_PATH = '/home/lhk/.node-red/flows.json.backup';

// Read flows
const flows = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'));

// Backup
fs.writeFileSync(BACKUP_PATH, JSON.stringify(flows, null, 4));
console.log('✅ Backup saved to', BACKUP_PATH);

let changes = 0;

// === Fix 1: fn_sqlite_insert ===
const fnInsert = flows.find(n => n.id === 'fn_sqlite_insert');
if (fnInsert) {
  fnInsert.func = `const { farmId, houseId, data, timestamp } = msg.payload;
const ts = timestamp || new Date().toISOString();

const entries = Object.entries(data).filter(([k, v]) => v !== null && v !== undefined);

if (entries.length === 0) {
    node.warn('⚠️ 저장할 데이터 없음');
    return null;
}

// 위치 파라미터 쿼리: msg.payload 배열 + $N 파라미터
// node-red-node-sqlite msg.topic 모드에서는 msg.params 지원 안 됨
const messages = entries.map(([sensorId, value]) => ({
    topic: 'INSERT INTO sensor_data (timestamp, farm_id, house_id, sensor_id, value, synced) VALUES ($1, $2, $3, $4, $5, 0)',
    payload: [ts, farmId, houseId, sensorId, value],
    _insertTimestamp: ts,
    _sensorCount: entries.length,
    _isLast: false,
    _originalPayload: msg.payload
}));

const srvOnline = global.get('serverOnline');
const opMode = global.get('operationMode') || (srvOnline === true ? 'online' : 'offline');
messages[messages.length - 1]._isLast = true;
messages[messages.length - 1]._operationMode = opMode;

node.warn('💾 SQLite INSERT: ' + entries.length + '건');
return [messages];`;
  changes++;
  console.log('✅ Fix 1: fn_sqlite_insert - params → payload array');
}

// === Fix 2: fn_process_config_response (config cache INSERT) ===
const fnConfig = flows.find(n => n.id === 'fn_process_config_response');
if (fnConfig) {
  fnConfig.func = `if (msg.statusCode !== 200) {
    const cachedConfig = global.get('houseConfig');
    if (cachedConfig) {
        node.warn('⚠️ 서버 응답 실패, 캐시된 설정 사용');
        msg.config = cachedConfig;
        return [msg, null];
    }
    node.error('❌ 서버 응답 실패, 캐시도 없음');
    return [null, null];
}

const response = msg.payload;
if (!response.success) {
    node.error('설정 오류: ' + (response.error || 'unknown'));
    return [null, null];
}

const config = response.data;

// global 캐시 갱신
const cachedConfig = global.get('houseConfig');
const cachedVersion = cachedConfig ? cachedConfig.configVersion : 0;

if (!cachedConfig || config.configVersion > cachedVersion) {
    node.warn('📋 설정 업데이트: v' + cachedVersion + ' → v' + config.configVersion);
    global.set('houseConfig', config);

    // SQLite에도 캐시 저장 (위치 파라미터)
    const cacheMsg = {
        topic: 'INSERT OR REPLACE INTO config_cache (id, farm_id, house_id, config_json, version, updated_at) VALUES (1, $1, $2, $3, $4, $5)',
        payload: [
            config.farmId || 'farm_0001',
            config.houseId || (config.houses && config.houses[0] ? config.houses[0].houseId : 'house_001'),
            JSON.stringify(config),
            config.configVersion || 1,
            new Date().toISOString()
        ]
    };
    msg.config = config;
    return [msg, cacheMsg];
}

msg.config = config;
return [msg, null];`;
  changes++;
  console.log('✅ Fix 2: fn_process_config_response - config cache params → payload array');
}

// === Fix 3: fn_send_result (synced UPDATE) ===
const fnSendResult = flows.find(n => n.id === 'fn_send_result');
if (fnSendResult) {
  fnSendResult.func = `if (msg.statusCode === 201 || msg.statusCode === 200) {
    node.warn('✅ 서버 전송 성공 → synced=1');

    const syncMsg = {
        topic: 'UPDATE sensor_data SET synced = 1 WHERE timestamp = $1 AND synced = 0',
        payload: [msg._insertTimestamp]
    };

    node.status({ fill: 'green', shape: 'dot', text: '서버 전송 ✓ + synced' });
    return [syncMsg, msg];
} else {
    node.warn('⚠️ 서버 전송 실패 (' + msg.statusCode + '): synced=0 유지');
    node.status({ fill: 'yellow', shape: 'ring', text: '전송 실패 (synced=0)' });
    return [null, msg];
}`;
  changes++;
  console.log('✅ Fix 3: fn_send_result - synced update params → payload array');
}

// === Fix 4: sync_result (sync flow synced UPDATE) ===
const fnSyncResult = flows.find(n => n.id === 'sync_result');
if (fnSyncResult) {
  fnSyncResult.func = `if (msg.statusCode === 201 || msg.statusCode === 200) {
    // 성공 → synced=1 마킹
    const ids = msg._syncIds || [];
    if (ids.length > 0) {
        // ID는 SQLite 자동증가 INTEGER이므로 숫자만 허용
        const safeIds = ids.filter(id => Number.isInteger(id) && id > 0);
        if (safeIds.length === 0) { return [null, null]; }
        // 위치 파라미터: $1, $2, ... 동적 생성
        const placeholders = safeIds.map((_, i) => '$' + (i + 1)).join(',');
        msg.topic = 'UPDATE sensor_data SET synced = 1 WHERE id IN (' + placeholders + ')';
        msg.payload = safeIds;
        node.warn('✅ 동기화 성공: ' + msg._syncCount + '건 synced=1');
        node.status({ fill: 'green', shape: 'dot', text: '동기화 완료: ' + msg._syncCount + '건' });
        return [msg, null];
    }
} else {
    node.warn('⚠️ 동기화 실패 (' + msg.statusCode + '): 다음 주기에 재시도');
    node.status({ fill: 'red', shape: 'ring', text: '실패: ' + msg.statusCode });
}

return [null, null];`;
  changes++;
  console.log('✅ Fix 4: sync_result - sync update params → payload array');
}

// === Add missing Catch nodes ===
// Check if catch nodes already exist
const hasCatchConfig = flows.some(n => n.id === 'catch_config_error');
const hasCatchSend = flows.some(n => n.id === 'catch_send_error');
const hasCatchSync = flows.some(n => n.id === 'catch_sync_send_error');

if (!hasCatchConfig) {
  flows.push({
    id: "catch_config_error",
    type: "catch",
    z: "collection_offline_flow",
    name: "Config HTTP 에러 캐치",
    scope: ["http_get_config"],
    uncaught: false,
    x: 720,
    y: 110,
    wires: [["fn_process_config_response"]]
  });
  changes++;
  console.log('✅ Added catch_config_error node');
}

if (!hasCatchSend) {
  flows.push({
    id: "catch_send_error",
    type: "catch",
    z: "collection_offline_flow",
    name: "서버 전송 에러 캐치",
    scope: ["http_send_server"],
    uncaught: false,
    x: 710,
    y: 460,
    wires: [["fn_send_result"]]
  });
  changes++;
  console.log('✅ Added catch_send_error node');
}

if (!hasCatchSync) {
  flows.push({
    id: "catch_sync_send_error",
    type: "catch",
    z: "sync_flow",
    name: "배치 전송 에러 캐치",
    scope: ["http_sync_send"],
    uncaught: false,
    x: 440,
    y: 340,
    wires: [["sync_result"]]
  });
  changes++;
  console.log('✅ Added catch_sync_send_error node');
}

// Write updated flows
fs.writeFileSync(FLOWS_PATH, JSON.stringify(flows, null, 4));
console.log('\n✅ Total changes:', changes);
console.log('✅ flows.json updated successfully');
console.log('⚠️ Node-RED restart required: pm2 restart node-red');
