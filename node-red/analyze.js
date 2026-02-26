const fs = require('fs');
const flows = JSON.parse(fs.readFileSync('rpi-flows-current.json', 'utf8'));
const tabs = flows.filter(n => n.type === 'tab');

console.log('=== 탭별 상세 분석 (' + tabs.length + '개 탭, ' + flows.length + '개 노드) ===\n');

tabs.forEach(t => {
  const nodes = flows.filter(n => n.z === t.id);
  const envVars = t.env ? t.env.map(e => e.name + '=' + e.value).join(', ') : '';
  const httpNodes = nodes.filter(n => n.type === 'http request' && n.url);
  const urls = httpNodes.map(n => n.name + '(' + n.url + ')');
  const injects = nodes.filter(n => n.type === 'inject');
  const timers = injects.map(n => {
    if (n.repeat) return 'repeat:' + n.repeat + 's';
    if (n.crontab) return 'cron:' + n.crontab;
    return 'once';
  });
  const funcs = nodes.filter(n => n.type === 'function' && n.name);
  const mqttNodes = nodes.filter(n => n.type === 'mqtt in' || n.type === 'mqtt out');

  console.log('[' + t.label + '] (' + t.id + ')');
  console.log('  nodes: ' + nodes.length + ', disabled: ' + (t.disabled || false));
  if (envVars) console.log('  env: ' + envVars);
  if (urls.length) console.log('  HTTP: ' + urls.join(', '));
  if (timers.length) console.log('  timers: ' + timers.join(', '));
  if (mqttNodes.length) console.log('  MQTT: ' + mqttNodes.map(n => n.topic || n.name || n.type).join(', '));
  if (funcs.length) console.log('  funcs: ' + funcs.map(n => n.name).join(', '));
  console.log('');
});

// Global config nodes
const globals = flows.filter(n => {
  return n.type !== 'tab' && !n.z;
});
if (globals.length) {
  console.log('=== Global config nodes (' + globals.length + ') ===');
  globals.forEach(n => console.log('  ' + n.type + ': ' + (n.name || n.id)));
}
