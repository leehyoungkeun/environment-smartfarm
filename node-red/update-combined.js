/**
 * 개별 flow JSON 파일의 변경사항을 combined-flows.json에 반영하는 스크립트
 * - 개별 파일의 tab ID와 일치하는 기존 탭+노드를 교체
 * - RPi-only 탭(rpi-flows-current.json)은 보존
 */
const fs = require('fs');
const path = require('path');

const FLOWS_DIR = path.join(__dirname, 'flows');
const COMBINED_PATH = path.join(FLOWS_DIR, 'combined-flows.json');

// 업데이트할 개별 flow 파일 목록
const FLOW_FILES = [
  'smartfarm-collection-offline.json',
  'smartfarm-health-monitor.json',
  'smartfarm-sync.json',
  'smartfarm-config-crud.json',
  'smartfarm-rest-api.json',
  'smartfarm-sqlite-init.json',
  'smartfarm-startup-init.json',
];

// 1. combined-flows.json 읽기
const combined = JSON.parse(fs.readFileSync(COMBINED_PATH, 'utf8'));

// 2. 개별 파일에서 탭 ID 수집 + 노드 맵 구성
const updateTabIds = new Set();
const updateNodes = [];

for (const file of FLOW_FILES) {
  const filePath = path.join(FLOWS_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP: ${file} (not found)`);
    continue;
  }
  const nodes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const tabs = nodes.filter(n => n.type === 'tab');
  if (tabs.length === 0) {
    console.log(`  SKIP: ${file} (no tab node)`);
    continue;
  }
  for (const tab of tabs) {
    updateTabIds.add(tab.id);
    console.log(`  UPDATE: ${file} → tab "${tab.label}" (${tab.id})`);
  }
  updateNodes.push(...nodes);
}

// 3. combined에서 업데이트 대상 탭의 노드 제거
const kept = combined.filter(n => {
  // 탭 노드 자체
  if (n.type === 'tab' && updateTabIds.has(n.id)) return false;
  // 탭에 속한 노드
  if (n.z && updateTabIds.has(n.z)) return false;
  return true;
});

console.log(`\nCombined: ${combined.length} nodes → removed ${combined.length - kept.length} (updated tabs)`);
console.log(`Adding: ${updateNodes.length} nodes from individual files`);

// 4. 업데이트된 노드 삽입 (탭 노드 먼저, 나머지 노드 나중)
const tabNodes = updateNodes.filter(n => n.type === 'tab');
const otherNodes = updateNodes.filter(n => n.type !== 'tab');

// 기존 탭 순서 유지를 위해 kept의 마지막 탭 위치 뒤에 삽입
const merged = [...kept];

// 탭 노드들을 kept의 탭 노드 뒤에 삽입
let lastTabIdx = -1;
for (let i = 0; i < merged.length; i++) {
  if (merged[i].type === 'tab') lastTabIdx = i;
}
// 탭 노드 삽입
merged.splice(lastTabIdx + 1, 0, ...tabNodes);
// 나머지 노드는 끝에 추가
merged.push(...otherNodes);

// 5. 중복 ID 제거 (global config 노드 등 — 첫 번째만 유지)
const seenIds = new Set();
const deduped = [];
for (const n of merged) {
  if (n.id && seenIds.has(n.id)) {
    console.log(`  DEDUP: ${n.id} (${n.type}) — removed duplicate`);
    continue;
  }
  if (n.id) seenIds.add(n.id);
  deduped.push(n);
}

// 중복 체크 (검증)
const ids = new Set();
const dups = [];
deduped.forEach(n => {
  if (n.id) {
    if (ids.has(n.id)) dups.push(n.id);
    ids.add(n.id);
  }
});

const tabs = deduped.filter(n => n.type === 'tab');
console.log(`\nResult: ${deduped.length} nodes, ${tabs.length} tabs`);
if (dups.length) {
  console.log(`⚠️  DUPLICATE IDs: ${dups.join(', ')}`);
} else {
  console.log('✅ No duplicate IDs');
}

// 6. 저장
fs.writeFileSync(COMBINED_PATH, JSON.stringify(deduped, null, 2));
console.log(`\nSAVED: ${COMBINED_PATH}`);
