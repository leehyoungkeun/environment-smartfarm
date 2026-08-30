// ============================================================
// "③ 센서 데이터 수집" (fn_collect_sensors) — KS X 3267 센서 합류본 (2026-08-30 P3)
// 위치: "센서 수집" 탭 → "③ 센서 데이터 수집". 코드 전체 교체 (출력·배선 변경 없음)
// 변경: modbusReadings 에 global.ks3267Readings(3분 TTL) 를 합류 — 표준 센서가 기존 파이프라인
//       (SQLite 오프라인 저장·서버 전송·자동화 평가)을 그대로 탄다.
// ============================================================
// ③ 센서 데이터 수집 — 시뮬레이션 격리 버전 (2026-08-29, B4)
// "센서 수집" 탭 → "③ 센서 데이터 수집" 함수 노드 코드 전체 교체
//
// 바뀐 것:
//   · Modbus 값이 없을 때 **값을 지어내지 않는다.** 그 센서는 이번 사이클에서 빠지고, 서버의
//     SensorDataStalled 가 울린다. (farm_0006 이 5월부터 USB-485 없이 시뮬레이션 값을 실측처럼
//     13만 행 저장한 사고의 근본 조치)
//   · 시뮬레이션은 SIM_MODE=1 일 때만 (ecosystem 이 /home/lhk/smartfarm/.sim-mode 파일이 있으면 주입).
//     그때도 payload.quality = 'simulated' 를 붙여 서버가 지표·알림에서 제외한다.
//   · 버스 장애 감지(2사이클 연속)는 그대로.

const config = msg.config || global.get('houseConfig');
const modbusRaw = msg.payload;
const SIM_MODE = String(env.get('SIM_MODE') || '') === '1';

if (!config) {
    node.error('❌ config 없음, 수집 중단');
    return null;
}

// Modbus 실측 데이터 파싱
let realData = {};
if (Array.isArray(modbusRaw) && modbusRaw.length >= 2) {
    realData.humidity = modbusRaw[0] / 10;
    let temp = modbusRaw[1] / 10;
    if (modbusRaw[1] > 0x7FFF) {
        temp = -(0xFFFF - modbusRaw[1] + 1) / 10;
    }
    realData.temperature = temp;
    node.warn('🌡️ Modbus 실측: ' + realData.temperature + '°C, ' + realData.humidity + '%RH');
} else if (SIM_MODE) {
    node.warn('⚠️ Modbus 데이터 없음 — SIM_MODE=1: 시뮬레이션 값 사용 (quality=simulated)');
} else {
    node.warn('⚠️ Modbus 데이터 없음 — 시뮬레이션 금지, 실측 없는 센서는 이번 사이클 생략');
}

// msg.modbusReadings가 있으면 사용 (sensor-modbus-read-flow 경유)
// KS X 3267 표준 센서 노드 값 합류 (P3, 2026-08-30) — ks3267d 데몬 → fn_ks_status 가 3분 이내에 넣은 값만.
// 낡은 값(데몬 중단)은 버린다 — 값을 지어내지 않는 원칙과 같은 맥락.
var ksR = global.get('ks3267Readings');
var ksVals = (ksR && ksR.values && (Date.now() - (ksR.t || 0)) < 180000) ? ksR.values : {};
var modbusReadings = Object.assign({}, ksVals, msg.modbusReadings || realData || {});

let housesToCollect = [];
if (config.houses && config.houses.length > 0) {
    housesToCollect = config.houses.filter(h => h.enabled !== false);
} else if (config.sensors) {
    housesToCollect = [{ houseId: config.houseId, sensors: config.sensors }];
}
if (housesToCollect.length === 0) {
    node.error('❌ 활성 하우스 없음');
    return null;
}

const farmId = config.farmId;
const deviceId = 'rpi_' + (global.get('farmId') || env.get('FARM_ID') || 'farm_0001').replace('farm_', '');
const messages = [];
let simulatedCount = 0;
let skippedCount = 0;

// 실측이 없을 때 값을 만드는 곳은 여기뿐 — SIM_MODE 에서만 호출된다
function simulate(sensor) {
    switch (sensor.sensorId) {
        case 'temp_0001':     return parseFloat((Math.random() * 10 + 20).toFixed(1));
        case 'humidity_0001': return parseFloat((Math.random() * 20 + 50).toFixed(1));
        case 'co2_0001':      return parseInt(Math.random() * 200 + 400);
        default:
            if (sensor.type === 'number') {
                const min = sensor.min !== null ? sensor.min : 0;
                const max = sensor.max !== null ? sensor.max : 100;
                return parseFloat((Math.random() * (max - min) + min).toFixed(sensor.precision || 1));
            }
            if (sensor.type === 'boolean') return Math.random() > 0.5;
            return 'OK';
    }
}

for (const house of housesToCollect) {
    const sensors = house.sensors || [];
    const houseId = house.houseId;
    const enabledSensors = sensors.filter(s => s.enabled);
    if (enabledSensors.length === 0) continue;

    const sensorData = {};
    let houseSimulated = false;
    for (const sensor of enabledSensors) {
        try {
            let value;
            if (modbusReadings[sensor.sensorId] !== undefined) {
                value = modbusReadings[sensor.sensorId];                       // 1) 모듈별 읽기
            } else if (sensor.sensorId === 'temp_0001' && realData.temperature !== undefined) {
                value = realData.temperature;                                  // 2) 기본 온습도 모듈
            } else if (sensor.sensorId === 'humidity_0001' && realData.humidity !== undefined) {
                value = realData.humidity;
            } else if (SIM_MODE) {
                value = simulate(sensor);                                      // 3) 시뮬레이션 (명시적으로 켰을 때만)
                houseSimulated = true;
                simulatedCount++;
            } else {
                skippedCount++;                                                // 4) 실측 없음 → 생략 (지어내지 않음)
                continue;
            }
            sensorData[sensor.sensorId] = value;
        } catch (e) {
            node.error('센서 읽기 실패: ' + sensor.sensorId + ' - ' + e.message);
        }
    }
    if (Object.keys(sensorData).length === 0) continue;

    messages.push({
        payload: {
            farmId: farmId,
            houseId: houseId,
            data: sensorData,
            timestamp: new Date().toISOString(),
            quality: houseSimulated ? 'simulated' : 'measured',
            deviceInfo: {
                deviceId: deviceId,
                ip: global.get('systemIp') || null,
                version: '2.1.0-offline'
            }
        }
    });
}

const totalSensors = messages.reduce((sum, m) => sum + Object.keys(m.payload.data).length, 0);
if (messages.length === 0) {
    node.warn('⚠️ 전송할 실측 없음 (생략 ' + skippedCount + '개) — 서버 SensorDataStalled 로 감지된다');
    node.status({ fill: 'red', shape: 'ring', text: '실측 없음 (' + skippedCount + ' 생략)' });
} else {
    node.warn('📡 ' + messages.length + '개 하우스, 총 ' + totalSensors + '개 센서 수집' +
        (simulatedCount ? ' (시뮬레이션 ' + simulatedCount + ')' : '') + (skippedCount ? ' (생략 ' + skippedCount + ')' : ''));
    node.status({ fill: simulatedCount ? 'yellow' : 'green', shape: 'dot',
        text: messages.length + '개 하우스 ' + totalSensors + '개 센서' + (simulatedCount ? ' SIM' : '') });
}

// ━━━ Modbus 버스 전체 장애 감지 (기존 그대로) ━━━
var busAlarmMsg = null;
var totalModbusSensors = 0;
var totalModbusFailed = 0;
for (const house of housesToCollect) {
    const sensors = (house.sensors || []).filter(s => s.enabled);
    for (const sensor of sensors) {
        if (sensor.modbus && sensor.modbus.unitId != null) {
            totalModbusSensors++;
            if (modbusReadings[sensor.sensorId] === undefined) totalModbusFailed++;
        }
    }
}
if (totalModbusSensors >= 2 && totalModbusFailed === totalModbusSensors) {
    var busFailCount = (flow.get('busFailCount') || 0) + 1;
    flow.set('busFailCount', busFailCount);
    node.warn('🔌 Modbus 버스 전체 실패 (' + busFailCount + '사이클 연속)');
    if (busFailCount >= 2) {
        var lastBusAlarm = flow.get('lastBusAlarmTime') || 0;
        var now = Date.now();
        if (now - lastBusAlarm > 60 * 60 * 1000) {
            flow.set('lastBusAlarmTime', now);
            busAlarmMsg = {
                payload: {
                    alarm_type: 'MODBUS_BUS_FAILURE',
                    severity: 'CRITICAL',
                    message: 'Modbus RS-485 버스 전체 통신 장애 — ' + totalModbusSensors + '개 센서 모두 응답 없음 (' + busFailCount + '사이클 연속)',
                    cooldownMinutes: 60,
                    metadata: { totalModbusSensors: totalModbusSensors, consecutiveFailCycles: busFailCount }
                },
                headers: { 'content-type': 'application/json' }
            };
            node.warn('🚨 Modbus 버스 장애 알림 전송!');
        }
    }
} else {
    if (flow.get('busFailCount') > 0) node.warn('✅ Modbus 버스 정상 복구');
    flow.set('busFailCount', 0);
}

return [messages.length ? messages : null, busAlarmMsg];
