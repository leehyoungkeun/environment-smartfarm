const fs = require('fs');

const combined = JSON.parse(fs.readFileSync('node-red/flows/combined-flows.json', 'utf8'));
const rpi = JSON.parse(fs.readFileSync('node-red/rpi-flows-current.json', 'utf8'));

// combined에 있는 탭 ID 목록
const combinedTabIds = new Set();
combined.forEach(n => { if (n.type === 'tab') combinedTabIds.add(n.id); });

// combined에 있는 모든 노드 ID
const combinedIds = new Set();
combined.forEach(n => { if (n.id) combinedIds.add(n.id); });

// RPi에만 있는 탭 ID
const rpiOnlyTabIds = new Set();
rpi.forEach(n => {
  if (n.type === 'tab' && !combinedTabIds.has(n.id)) {
    rpiOnlyTabIds.add(n.id);
  }
});

console.log('RPi-only tabs:', [...rpiOnlyTabIds].join(', '));

// RPi-only 탭 + 해당 탭의 노드들
const rpiOnlyNodes = rpi.filter(n => {
  return rpiOnlyTabIds.has(n.id) || rpiOnlyTabIds.has(n.z);
});

// global config 노드 (z가 없는 것들) 중 combined에 없는 것
const globalNodes = rpi.filter(n => {
  return !n.z && !combinedIds.has(n.id) && n.type !== 'tab';
});

console.log('RPi-only nodes:', rpiOnlyNodes.length);
console.log('Missing global nodes:', globalNodes.length);
globalNodes.forEach(n => console.log('  global:', n.id, '(' + n.type + ')', n.name || ''));

// 합치기
const merged = [...combined, ...rpiOnlyNodes, ...globalNodes];

// 중복 ID 체크
const ids = new Set();
const dups = [];
merged.forEach(n => {
  if (n.id) {
    if (ids.has(n.id)) dups.push(n.id);
    ids.add(n.id);
  }
});
if (dups.length) console.log('DUPLICATE IDs:', dups.join(', '));
else console.log('No duplicate IDs');

// 탭 수 확인
const tabs = merged.filter(n => n.type === 'tab');
console.log('Total tabs:', tabs.length);
console.log('Total nodes:', merged.length);

fs.writeFileSync('node-red/flows/combined-flows.json', JSON.stringify(merged, null, 2));
console.log('SAVED combined-flows.json');
