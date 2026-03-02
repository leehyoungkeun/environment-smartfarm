/**
 * Node-RED Function 노드
 * 동적 센서 수집 - 서버 설정 기반
 * 
 * 플로우 구성:
 * [Inject] → [Fetch Config] → [Collect Sensors] → [Send Data] → [Debug]
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 1: 서버에서 설정 가져오기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "Fetch Config from Server"
 * 입력: msg (Inject에서)
 * 출력: msg (설정 포함)
 */

// 환경변수 또는 하드코딩
const SERVER_URL = env.get('SERVER_URL') || 'http://192.168.1.101:3000';
const FARM_ID = env.get('FARM_ID') || 'farm_0001';
const HOUSE_ID = env.get('HOUSE_ID') || 'house_0001';
const API_KEY = env.get('SENSOR_API_KEY') || '';

// 설정 캐시 (global context)
// 매번 요청하지 않고 버전 체크 후 변경 시만 가져옴
const cachedConfig = global.get('houseConfig') || null;

// 설정 조회 URL
msg.url = `${SERVER_URL}/api/config/${HOUSE_ID}?farmId=${FARM_ID}`;
msg.method = 'GET';
msg.headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY
};

return msg;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 2: HTTP Response 처리 및 설정 저장
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "Process Config Response"
 * 입력: msg (HTTP Response에서)
 * 출력: msg (센서 수집으로)
 */

// HTTP 요청 성공 체크
if (msg.statusCode !== 200) {
    node.error(`Failed to fetch config: ${msg.statusCode}`);
    
    // 실패 시 캐시된 설정 사용
    const cachedConfig = global.get('houseConfig');
    if (cachedConfig) {
        node.warn('Using cached configuration');
        msg.config = cachedConfig;
    } else {
        node.error('No cached configuration available');
        return null;  // 수집 중단
    }
} else {
    // 성공 - 설정 파싱
    const response = msg.payload;
    
    if (!response.success) {
        node.error(`Config error: ${response.error}`);
        return null;
    }
    
    const config = response.data;
    
    // 설정 버전 체크
    const cachedConfig = global.get('houseConfig');
    const cachedVersion = cachedConfig ? cachedConfig.configVersion : 0;
    
    if (config.configVersion > cachedVersion) {
        node.warn(`Config updated: v${cachedVersion} → v${config.configVersion}`);
        global.set('houseConfig', config);
    }
    
    msg.config = config;
}

// 하우스 비활성화 체크
if (!msg.config.enabled) {
    node.warn('House is disabled, skipping collection');
    return null;
}

return msg;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 3: 동적 센서 데이터 수집
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "Collect Dynamic Sensors"
 * 입력: msg (설정 포함)
 * 출력: msg (센서 데이터 포함)
 */

const config = msg.config;

if (!config || !config.sensors) {
    node.error('No configuration available');
    return null;
}

// 활성화된 센서만 필터링
const enabledSensors = config.sensors.filter(s => s.enabled);

if (enabledSensors.length === 0) {
    node.warn('No enabled sensors');
    return null;
}

// 센서 데이터 객체 생성 (동적!)
const sensorData = {};

// 각 센서 읽기
for (const sensor of enabledSensors) {
    try {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 여기서 실제 센서 읽기!
        // GPIO, I2C, SPI 등을 사용하여 센서 값 읽기
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        let value;
        
        // 예시: 센서 타입에 따라 다르게 처리
        switch (sensor.sensorId) {
            case 'temp_0001':
                // DHT22 온도 센서 읽기
                value = readDHT22Temperature();
                break;

            case 'humidity_0001':
                // DHT22 습도 센서 읽기
                value = readDHT22Humidity();
                break;

            case 'co2_0001':
                // MH-Z19 CO2 센서 읽기
                value = readCO2Sensor();
                break;
            
            default:
                // 기본: 랜덤 값 생성 (테스트용)
                if (sensor.type === 'number') {
                    const min = sensor.min !== null ? sensor.min : 0;
                    const max = sensor.max !== null ? sensor.max : 100;
                    value = parseFloat(
                        (Math.random() * (max - min) + min).toFixed(sensor.precision)
                    );
                } else if (sensor.type === 'boolean') {
                    value = Math.random() > 0.5;
                } else {
                    value = 'OK';
                }
        }
        
        // 범위 체크 (옵션)
        if (sensor.type === 'number' && sensor.min !== null && sensor.max !== null) {
            if (value < sensor.min || value > sensor.max) {
                node.warn(`Sensor ${sensor.sensorId} out of range: ${value} (${sensor.min}-${sensor.max})`);
            }
        }
        
        // 센서 데이터 추가
        sensorData[sensor.sensorId] = value;
        
    } catch (error) {
        node.error(`Failed to read sensor ${sensor.sensorId}: ${error.message}`);
        // 에러 발생해도 계속 진행
        sensorData[sensor.sensorId] = null;
    }
}

// 디바이스 정보
const deviceInfo = {
    deviceId: env.get('DEVICE_ID') || 'rpi_0001',
    ip: env.get('DEVICE_IP') || '192.168.1.100',
    version: '1.0.0'
};

// 전송 payload 구성
msg.payload = {
    farmId: config.farmId,
    houseId: config.houseId,
    data: sensorData,
    deviceInfo: deviceInfo,
    timestamp: new Date().toISOString()
};

// 로그
node.warn(`Collected ${Object.keys(sensorData).length} sensors: ${Object.keys(sensorData).join(', ')}`);

return msg;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 센서 읽기 함수들 (예시)
// 실제로는 각 센서의 라이브러리 사용
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function readDHT22Temperature() {
    // 실제: DHT22 라이브러리 사용
    // const sensor = require('node-dht-sensor');
    // return sensor.read(22, 4).temperature;
    
    // 테스트: 랜덤 값
    return parseFloat((Math.random() * 10 + 20).toFixed(1)); // 20-30°C
}

function readDHT22Humidity() {
    return parseFloat((Math.random() * 20 + 50).toFixed(1)); // 50-70%
}

function readCO2Sensor() {
    return parseInt(Math.random() * 200 + 400); // 400-600ppm
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 4: 서버로 데이터 전송
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "Send to Server"
 * 입력: msg (센서 데이터 포함)
 * 출력: HTTP Request 노드로
 */

const SERVER_URL_4 = env.get('SERVER_URL') || 'http://192.168.1.101:3000';
const API_KEY_4 = env.get('SENSOR_API_KEY') || '';

msg.url = `${SERVER_URL_4}/api/sensors/collect`;
msg.method = 'POST';
msg.headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY_4
};

// payload는 이미 센서 데이터로 설정됨

return msg;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 5: 전송 결과 처리 및 에러 핸들링
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "Handle Response"
 * 입력: msg (HTTP Response에서)
 * 출력: Debug
 */

if (msg.statusCode === 201) {
    // 성공
    node.warn(`✅ Data sent successfully: ${msg.payload.message}`);
    
    // 로컬 버퍼 클리어 (있다면)
    global.set('sensorBuffer', []);
    
} else {
    // 실패
    node.error(`❌ Failed to send data: ${msg.statusCode}`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 네트워크 오류 대응: 로컬 버퍼링
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const bufferConfig = global.get('houseConfig')?.collection || {};
    const maxBufferSize = bufferConfig.bufferSize || 100;
    
    // 현재 버퍼
    let buffer = global.get('sensorBuffer') || [];
    
    // 버퍼에 추가
    buffer.push({
        timestamp: new Date().toISOString(),
        data: msg.payload.data
    });
    
    // 버퍼 크기 제한
    if (buffer.length > maxBufferSize) {
        node.warn(`Buffer full (${maxBufferSize}), removing oldest data`);
        buffer = buffer.slice(-maxBufferSize);
    }
    
    // 버퍼 저장
    global.set('sensorBuffer', buffer);
    
    node.warn(`📦 Data buffered (${buffer.length}/${maxBufferSize})`);
}

return msg;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 6: 버퍼 데이터 배치 전송 (별도 플로우)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "Send Buffered Data"
 * 트리거: 1시간마다 또는 수동
 * 입력: msg (Inject에서)
 * 출력: HTTP Request 노드로
 */

const buffer = global.get('sensorBuffer') || [];

if (buffer.length === 0) {
    node.warn('No buffered data');
    return null;
}

const SERVER_URL_6 = env.get('SERVER_URL') || 'http://192.168.1.101:3000';
const FARM_ID_6 = env.get('FARM_ID') || 'farm_0001';
const HOUSE_ID_6 = env.get('HOUSE_ID') || 'house_0001';
const API_KEY_6 = env.get('SENSOR_API_KEY') || '';

msg.url = `${SERVER_URL_6}/api/sensors/batch`;
msg.method = 'POST';
msg.headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY_6
};
msg.payload = {
    farmId: FARM_ID_6,
    houseId: HOUSE_ID_6,
    dataArray: buffer
};

node.warn(`📤 Sending ${buffer.length} buffered records`);

return msg;
