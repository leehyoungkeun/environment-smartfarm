/**
 * Node-RED 설정 파일
 * 스마트팜 RPi에서 사용하는 Node-RED 구성
 *
 * 참고: https://nodered.org/docs/user-guide/runtime/configuration
 */

module.exports = {
  // ──────────────────────────────────────────────
  // 기본 경로 설정
  // ──────────────────────────────────────────────

  // Node-RED 관리 UI 경로 (브라우저에서 접속할 주소)
  // http://<RPi-IP>:1880/node-red 로 접속
  httpAdminRoot: '/node-red',

  // HTTP In 노드의 기본 경로
  httpNodeRoot: '/',


  // CORS 설정 (프론트엔드 크로스오리진 요청 허용)
  httpNodeCors: {
    origin: "*",
    methods: "GET,PUT,POST,PATCH,DELETE",
    allowedHeaders: "Content-Type,x-api-key,Authorization"
  },
  // ── 로컬 API 인증 게이트 (2026-08-29, B1 최소안) ─────────────────────────
  // http in 노드로 들어오는 모든 /api/* 요청이 여기를 먼저 지난다. 인터넷 없이 RPi 혼자 판정한다.
  //   통과: ① 키오스크 — nginx 를 거쳐 온 요청이고 원 주소가 127.0.0.1 (RPi 안의 크롬)
  //         ② x-api-key 가 이 농장의 키 (자동화·헬스체크·서버가 Tailscale 로 부르는 동기화)
  //         ③ /api/health, /api/system/ip, OPTIONS(프리플라이트)
  //   그 외(같은 WiFi 의 태블릿·PC·낯선 기기)는 401 — 그 기기들은 서버(클라우드 JWT) 경유로 제어한다.
  // X-Real-IP 는 소켓이 루프백(=nginx)일 때만 믿는다. LAN 에서 :1880 으로 직접 오면서 헤더를 꾸며도 소용없다.
  httpNodeMiddleware: function (req, res, next) {
    var path = req.path || req.url || '';
    if (req.method === 'OPTIONS' || path === '/api/health' || path === '/api/system/ip') return next();
    if (!path.startsWith('/api/')) return next();

    var sock = (req.socket && req.socket.remoteAddress) || '';
    var isLoop = function (ip) { return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'; };
    var realIp = req.headers['x-real-ip'];
    if (isLoop(sock) && (!realIp || isLoop(realIp))) return next();          // ① 키오스크 / RPi 내부

    var farmKey = process.env.SENSOR_API_KEY || '';
    var given = req.headers['x-api-key'] || (req.query && req.query.apiKey) || '';
    if (farmKey && given && given === farmKey) return next();                // ② 농장 키

    res.status(401).json({ success: false, error: '인증 필요 — 키오스크 또는 농장 키', path: path });
  },

  // 사용자 데이터 디렉토리 (플로우 파일, 노드 모듈 등 저장)
  userDir: '/home/lhk/.node-red',

  // 플로우 파일명
  flowFile: '/home/lhk/.node-red/flows.json',

  // 자격증명 암호화 키 — ecosystem 이 농장마다 생성해 주입 (2026-08-29, B5).
  // 미설정이면 .config.runtime.json 의 시스템 키를 쓰는데, 이미지 복제 시 전 농장이 같은 키를 공유하고
  // 그 파일이 사라지면 복구 불가였다. flows_cred.json 은 비워 두므로(Basic 인증 해제) 값이 바뀌어도 잃을 것이 없다.
  credentialSecret: process.env.NR_CREDENTIAL_SECRET || false,

  // 플로우 파일 인코딩
  flowFilePretty: true,

  // ──────────────────────────────────────────────
  // 보안 설정 - 관리자 인증
  // ──────────────────────────────────────────────
  adminAuth: {
    type: 'credentials',
    users: [
      {
        // 관리자 계정
        username: 'admin',
        // 기본 비밀번호: admin1234
        // 비밀번호 변경 방법: node-red admin hash-pw
        password: '$2y$08$cI7rwBSiAJOD7bd48fB1cuwbWF8wn5g6uW33VOtvddiPk2FZ9Vo7y',
        permissions: '*',
      },
      {
        // 읽기 전용 사용자
        username: 'viewer',
        // 기본 비밀번호: view1234
        password: '$2b$08$wuAqPiKJlGKaHfGz3bQreu2rHq2cGWxLPMPv1RTaKh0V/G9oFOjOy',
        permissions: 'read',
      },
    ],
  },

  // ──────────────────────────────────────────────
  // 전역 컨텍스트 (플로우에서 사용할 수 있는 전역 변수)
  // ──────────────────────────────────────────────
  functionGlobalContext: {
    // 농장 식별자
    FARM_ID: process.env.FARM_ID || 'farm_0001',

    // RPi 서버 연결 정보
    RPI_SERVER_HOST: process.env.RPI_SERVER_HOST || 'localhost',
    RPI_SERVER_PORT: process.env.RPI_SERVER_PORT || 3001,

    // MQTT 브로커 설정
    MQTT_BROKER_HOST: process.env.MQTT_BROKER_HOST || 'localhost',
    MQTT_BROKER_PORT: process.env.MQTT_BROKER_PORT || 1883,

    // AWS IoT Core 설정
    AWS_IOT_ENDPOINT: process.env.AWS_IOT_ENDPOINT || '',

    // ── 다중 하우스: 장치 키 헬퍼 ─────────────────────────────
    // 장치 ID 는 하우스 안에서만 유일하다 (UI 가 하우스별로 fan1, cooler1 … 부여).
    // 하우스가 2개 이상이면 deviceId 만으로 상태를 저장하면 서로 덮어쓴다.
    // 장치 단위 전역 키는 반드시 이 헬퍼로 만들 것:
    //   deviceStates / devicePositions / movements
    //   modbus_cfg_ / autoStop_ / dur_  (접두사 + 키)
    //
    //   var dkey = global.get('dkey');
    //   positions[dkey(houseId, devId)] = 50;   // 'house_0001:fan1'
    //
    // houseId 누락 시 house_0001 로 폴백 — 단일 하우스 농장 하위 호환.
    // houseId 표기 정규화 — 'house1' / 'house_1' / 'house_0001' → 'house_0001'
    //   웹 대시보드가 MQTT 제어 토픽에 레거시 단축형(house1)을 쓰는 반면
    //   houseConfig / automation_rules / DB 는 house_0001 을 쓴다.
    //   정규화하지 않으면 같은 장치의 상태가 두 키로 갈라진다.
    hnorm: function (houseId) {
      var h = String(houseId || 'house_0001');
      var m = h.match(/^house_?0*(\d+)$/);
      if (!m) return h;
      var n = m[1];
      while (n.length < 4) n = '0' + n;
      return 'house_' + n;
    },
    dkey: function (houseId, deviceId) {
      var h = String(houseId || 'house_0001');
      var m = h.match(/^house_?0*(\d+)$/);
      if (m) {
        var n = m[1];
        while (n.length < 4) n = '0' + n;
        h = 'house_' + n;
      }
      return h + ':' + deviceId;
    },

    // Node.js 내장 모듈 접근 허용
    os: require('os'),
    path: require('path'),
    fs: require('fs'),
  },

  // 외부 npm 모듈 사용 허용 (Function 노드에서 require 가능)
  functionExternalModules: true,

  // ──────────────────────────────────────────────
  // 에디터 설정
  // ──────────────────────────────────────────────
  editorTheme: {
    // 헤더 타이틀 변경
    page: {
      title: '스마트팜 Node-RED',
    },

    // 프로젝트 기능 비활성화 (RPi에서는 불필요)
    projects: {
      enabled: false,
    },
  },

  // ──────────────────────────────────────────────
  // 로깅 설정
  // ──────────────────────────────────────────────
  logging: {
    console: {
      // 로그 레벨: fatal, error, warn, info, debug, trace
      level: 'info',
      // 메트릭 로깅 활성화
      metrics: false,
      // 감사 로깅 활성화
      audit: false,
    },
  },

  // ──────────────────────────────────────────────
  // 런타임 설정
  // ──────────────────────────────────────────────

  // 노드 실행 타임아웃 (ms, 0 = 무제한)
  functionTimeout: 30000,

  // 디버그 노드 최대 메시지 길이
  debugMaxLength: 1000,

  // MQTT 재연결 간격 (ms)
  mqttReconnectTime: 15000,

  // 직렬 포트 재연결 간격 (ms)
  serialReconnectTime: 15000,

  // TCP 노드 메시지 크기 제한 (바이트)
  tcpMsgQueueSize: 2048,

  // ──────────────────────────────────────────────
  // 컨텍스트 스토리지 (영속적 데이터 저장)
  // ──────────────────────────────────────────────
  contextStorage: {
    // 기본: 메모리 저장 (빠름, 재시작 시 소멸)
    default: {
      module: 'localfilesystem',
    },
    // 파일 저장 (느림, 재시작 후에도 유지)
    file: {
      module: 'localfilesystem',
      config: {
        dir: '/home/lhk/.node-red/context',
        flushInterval: 30, // 30초마다 디스크에 기록
      },
    },
  },

  // ──────────────────────────────────────────────
  // API 제한 설정
  // ──────────────────────────────────────────────
  apiMaxLength: '5mb',

  // ──────────────────────────────────────────────
  // HTTPS 설정 (필요 시 활성화)
  // ──────────────────────────────────────────────
  // https: {
  //   key: require('fs').readFileSync('/home/lhk/certs/privkey.pem'),
  //   cert: require('fs').readFileSync('/home/lhk/certs/cert.pem'),
  // },
};
