const fs = require('fs');
const f = JSON.parse(fs.readFileSync('node-red/flows/combined-flows.json', 'utf8'));

const fTabs = new Set(['f1_tab','f2_tab','f3_tab','f4_tab','f5_tab','f6_tab','f7_tab','f8_tab','f9_tab','f10_tab','aws_control_test_tab']);

f.forEach(n => {
  if (!fTabs.has(n.z)) return;
  const text = JSON.stringify(n);

  // house1, house2 등 (underscore 없이)
  const houseNoUnderscore = text.match(/["']house[0-9]+["']/g);
  // farm_001 등 3자리
  const farm3digit = text.match(/farm_0{1,2}[0-9]{1,2}[^0-9]/g);
  // MyFarmPi
  const myFarmPi = text.match(/MyFarmPi/g);
  // window1, fan1 등 device ID
  const deviceOld = text.match(/["'](window|fan|pump|valve|heater|cooler)[0-9]+["']/g);

  const found = [];
  if (houseNoUnderscore) found.push('house: ' + [...new Set(houseNoUnderscore)].join(', '));
  if (farm3digit) found.push('farm: ' + [...new Set(farm3digit)].join(', '));
  if (myFarmPi) found.push('MyFarmPi');
  if (deviceOld) found.push('device: ' + [...new Set(deviceOld)].join(', '));

  if (found.length > 0) {
    console.log(`[${n.z}] ${n.name || n.id} (${n.type})`);
    found.forEach(f => console.log(`  → ${f}`));
  }
});
