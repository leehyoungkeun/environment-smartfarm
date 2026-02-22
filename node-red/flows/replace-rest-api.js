const fs = require('fs');
const flows = JSON.parse(fs.readFileSync('/home/lhk/.node-red/flows.json', 'utf8'));
const newTab = JSON.parse(fs.readFileSync('/tmp/smartfarm-rest-api.json', 'utf8'));

// rest_api_flow 탭의 노드 ID 수집
const oldIds = new Set();
flows.forEach(n => {
  if (n.z === 'rest_api_flow' || n.id === 'rest_api_flow') oldIds.add(n.id);
});
console.log('기존 rest_api_flow 노드 수:', oldIds.size);

// 기존 rest_api_flow 노드 제거
const filtered = flows.filter(n => {
  return !oldIds.has(n.id);
});
console.log('제거 후 전체 노드 수:', filtered.length);

// 새 탭 노드 추가
const merged = filtered.concat(newTab);
console.log('병합 후 전체 노드 수:', merged.length);
console.log('새 rest_api_flow 노드 수:', newTab.length);

// 백업 & 저장
fs.copyFileSync('/home/lhk/.node-red/flows.json', '/home/lhk/.node-red/flows.json.backup');
fs.writeFileSync('/home/lhk/.node-red/flows.json', JSON.stringify(merged, null, 2));
console.log('flows.json 업데이트 완료');
