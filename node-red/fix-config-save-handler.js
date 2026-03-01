#!/usr/bin/env node
/**
 * Fix two issues:
 * 1. config_save_handler: msg.params → msg.payload array (SQLite v1.1.1 호환)
 * 2. fn_load_config: msg.method = 'GET' 누락 → JSON parse error 수정
 */

const fs = require('fs');
const FLOWS_PATH = '/home/lhk/.node-red/flows.json';

const flows = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'));

// Backup
const BACKUP_PATH = FLOWS_PATH + '.backup-config-fix2';
fs.writeFileSync(BACKUP_PATH, JSON.stringify(flows, null, 4));
console.log('✅ Backup saved to', BACKUP_PATH);

let changes = 0;

// === Fix 1: config_save_handler (health monitor) ===
const fnConfigSave = flows.find(n => n.id === 'config_save_handler');
if (fnConfigSave) {
  fnConfigSave.func = `if (msg.statusCode === 200 && msg.payload && msg.payload.success && msg.payload.data) {
    const config = msg.payload.data;
    global.set('houseConfig', config);
    node.warn('📋 Config 캐시 완료: ' + (config.houses ? config.houses.length + '개 하우스' : '데이터 없음'));
    node.status({ fill: 'green', shape: 'dot', text: 'config 캐시 완료' });

    // SQLite config_cache에도 저장 (위치 파라미터 - msg.payload 배열)
    msg.topic = 'INSERT OR REPLACE INTO config_cache (id, farm_id, house_id, config_json, version, updated_at) VALUES (1, $1, $2, $3, $4, $5)';
    msg.payload = [
        config.farmId || 'farm_0001',
        config.houseId || (config.houses && config.houses[0] ? config.houses[0].houseId : 'house_001'),
        JSON.stringify(config),
        config.configVersion || 1,
        new Date().toISOString()
    ];
    return msg;
} else {
    node.warn('⚠️ Config 가져오기 실패: ' + JSON.stringify(msg.payload).substring(0, 100));
    node.status({ fill: 'red', shape: 'dot', text: 'config 실패' });
    return null;
}`;
  changes++;
  console.log('✅ Fix 1: config_save_handler - msg.params → msg.payload array');
} else {
  console.log('⚠️ config_save_handler not found (already fixed?)');
}

// === Fix 2: fn_load_config - add msg.method = 'GET' ===
const fnLoadConfig = flows.find(n => n.id === 'fn_load_config');
if (fnLoadConfig) {
  if (!fnLoadConfig.func.includes("msg.method = 'GET'") && !fnLoadConfig.func.includes('msg.method = "GET"')) {
    // Add msg.method = 'GET' right after msg.url line
    fnLoadConfig.func = fnLoadConfig.func.replace(
      /msg\.url = `\$\{SERVER_URL\}\/api\/config\/\$\{HOUSE_ID\}\?farmId=\$\{FARM_ID\}`;/,
      "msg.url = `${SERVER_URL}/api/config/${HOUSE_ID}?farmId=${FARM_ID}`;\n    msg.method = 'GET';"
    );
    changes++;
    console.log('✅ Fix 2: fn_load_config - added msg.method = \'GET\'');
  } else {
    console.log('⚠️ fn_load_config already has msg.method (skipped)');
  }
} else {
  console.log('⚠️ fn_load_config not found');
}

fs.writeFileSync(FLOWS_PATH, JSON.stringify(flows, null, 4));
console.log('\n✅ Total changes:', changes);
console.log('⚠️ Node-RED restart required: pm2 restart node-red');
