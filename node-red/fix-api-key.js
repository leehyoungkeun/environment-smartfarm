#!/usr/bin/env node
/**
 * Add SENSOR_API_KEY env var to Node-RED flow tabs that need it.
 * env.get() in function nodes reads flow-level env vars.
 */

const fs = require('fs');
const FLOWS_PATH = '/home/lhk/.node-red/flows.json';
const API_KEY = 'smartfarm-sensor-key';

const flows = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'));

const envEntry = {
  name: 'SENSOR_API_KEY',
  value: API_KEY,
  type: 'str'
};

const serverUrlEntry = {
  name: 'SERVER_URL',
  value: 'http://192.168.137.1:3000',
  type: 'str'
};

const farmIdEntry = {
  name: 'FARM_ID',
  value: 'farm_0001',
  type: 'str'
};

const houseIdEntry = {
  name: 'HOUSE_ID',
  value: 'house_0001',
  type: 'str'
};

// Tabs that need the API key
const tabIds = ['collection_offline_flow', 'sync_flow', 'health_monitor_flow'];

let changes = 0;
for (const n of flows) {
  if (tabIds.includes(n.id) && n.type === 'tab') {
    if (!n.env) n.env = [];

    // Add or update each env var
    const envVars = [envEntry, serverUrlEntry, farmIdEntry, houseIdEntry];
    for (const ev of envVars) {
      const existing = n.env.findIndex(e => e.name === ev.name);
      if (existing >= 0) {
        n.env[existing] = ev;
        console.log(`  Updated ${ev.name} in ${n.label}`);
      } else {
        n.env.push(ev);
        console.log(`  Added ${ev.name} to ${n.label}`);
      }
    }
    changes++;
  }
}

fs.writeFileSync(FLOWS_PATH, JSON.stringify(flows, null, 4));
console.log(`\n✅ Updated ${changes} flow tabs with env vars`);
console.log('⚠️ Restart required: pm2 restart node-red');
