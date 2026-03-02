const fs = require('fs');
const flows = JSON.parse(fs.readFileSync('/home/lhk/.node-red/flows.json', 'utf8'));

const tabsNeedEnv = ['collection_offline_flow', 'sync_flow', 'rest_api_flow'];
const envVars = [
  { name: 'SENSOR_API_KEY', value: 'smartfarm-sensor-key', type: 'str' },
  { name: 'SERVER_URL', value: 'http://192.168.137.1:3000', type: 'str' },
  { name: 'FARM_ID', value: 'farm_0001', type: 'str' },
  { name: 'HOUSE_ID', value: 'house_0001', type: 'str' }
];

let updated = 0;
flows.forEach(function(n) {
  if (n.type === 'tab' && tabsNeedEnv.indexOf(n.id) >= 0) {
    var hasEnv = n.env && n.env.length > 0;
    if (!hasEnv) {
      n.env = envVars;
      console.log('Added env to:', n.label, '(' + n.id + ')');
      updated++;
    } else {
      console.log('Already has env:', n.label);
    }
  }
});

if (updated > 0) {
  fs.copyFileSync('/home/lhk/.node-red/flows.json', '/home/lhk/.node-red/flows.json.backup');
  fs.writeFileSync('/home/lhk/.node-red/flows.json', JSON.stringify(flows, null, 2));
  console.log('Updated ' + updated + ' tabs');
} else {
  console.log('No tabs needed update');
}
