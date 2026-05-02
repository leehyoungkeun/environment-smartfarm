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
  // 사용자 데이터 디렉토리 (플로우 파일, 노드 모듈 등 저장)
  userDir: '/home/lhk/.node-red',

  // 플로우 파일명
  flowFile: 'flows.json',

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
