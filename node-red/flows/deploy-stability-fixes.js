/**
 * RPi 배포 스크립트: sqlite_init_flow + collection_offline_flow 탭 교체
 *
 * 사용법:
 *   scp deploy-stability-fixes.js smartfarm-sqlite-init.json smartfarm-collection-offline.json lhk@192.168.137.30:/tmp/
 *   ssh lhk@192.168.137.30 "node /tmp/deploy-stability-fixes.js"
 *   ssh lhk@192.168.137.30 "pm2 restart node-red"
 */
const fs = require('fs');

const FLOWS_PATH = '/home/lhk/.node-red/flows.json';
const BACKUP_PATH = '/home/lhk/.node-red/flows.json.backup';

const tabsToReplace = [
  { tabId: 'sqlite_init_flow', file: '/tmp/smartfarm-sqlite-init.json' },
  { tabId: 'collection_offline_flow', file: '/tmp/smartfarm-collection-offline.json' },
];

// 현재 flows.json 로드
const flows = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'));
console.log('현재 전체 노드 수:', flows.length);

let result = flows;

tabsToReplace.forEach(function(tab) {
  if (!fs.existsSync(tab.file)) {
    console.log('SKIP - 파일 없음:', tab.file);
    return;
  }

  var newTab = JSON.parse(fs.readFileSync(tab.file, 'utf8'));

  // 기존 탭 노드 제거
  var oldCount = 0;
  result = result.filter(function(n) {
    if (n.z === tab.tabId || n.id === tab.tabId) {
      oldCount++;
      return false;
    }
    return true;
  });
  console.log(tab.tabId + ': 기존 ' + oldCount + '개 제거, 새로 ' + newTab.length + '개 추가');

  // 새 탭 노드 추가
  result = result.concat(newTab);
});

console.log('최종 전체 노드 수:', result.length);

// 백업 & 저장
fs.copyFileSync(FLOWS_PATH, BACKUP_PATH);
console.log('백업 완료:', BACKUP_PATH);

fs.writeFileSync(FLOWS_PATH, JSON.stringify(result, null, 2));
console.log('flows.json 업데이트 완료!');
