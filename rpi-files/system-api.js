// system-api.js — RPi 시스템 관리 API (PM2 프로세스 제어)
// 포트 3100에서 독립 실행 (Node-RED와 분리)

const http = require('http');
const { exec } = require('child_process');

const PORT = 3100;

// CORS 헤더
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// JSON 응답
function jsonRes(res, code, data) {
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// PM2 프로세스 상태 가져오기
function getPm2Status(name) {
  return new Promise(function(resolve) {
    exec('pm2 jlist', function(err, stdout) {
      if (err) { resolve(null); return; }
      try {
        var list = JSON.parse(stdout);
        var proc = list.find(function(p) { return p.name === name; });
        if (proc) {
          resolve({
            name: proc.name,
            status: proc.pm2_env.status,
            uptime: proc.pm2_env.pm_uptime,
            restarts: proc.pm2_env.restart_time,
            memory: proc.monit ? proc.monit.memory : 0,
            cpu: proc.monit ? proc.monit.cpu : 0
          });
        } else {
          resolve(null);
        }
      } catch(e) {
        resolve(null);
      }
    });
  });
}

// PM2 프로세스 재시작
function restartPm2(name) {
  return new Promise(function(resolve) {
    exec('pm2 restart ' + name, function(err, stdout) {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, output: stdout.trim() });
      }
    });
  });
}

// HTTP 서버
var server = http.createServer(function(req, res) {
  // OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/system/status
  if (req.method === 'GET' && req.url === '/api/system/status') {
    Promise.all([
      getPm2Status('node-red'),
      getPm2Status('smartfarm-rpi')
    ]).then(function(results) {
      jsonRes(res, 200, {
        nodeRed: results[0],
        rpiExpress: results[1],
        timestamp: new Date().toISOString()
      });
    });
    return;
  }

  // POST /api/system/restart-nodered
  if (req.method === 'POST' && req.url === '/api/system/restart-nodered') {
    restartPm2('node-red').then(function(result) {
      jsonRes(res, result.success ? 200 : 500, result);
    });
    return;
  }

  // POST /api/system/restart-express
  if (req.method === 'POST' && req.url === '/api/system/restart-express') {
    restartPm2('smartfarm-rpi').then(function(result) {
      jsonRes(res, result.success ? 200 : 500, result);
    });
    return;
  }

  // 404
  jsonRes(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('[system-api] listening on port ' + PORT);
});
