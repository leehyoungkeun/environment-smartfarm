// ============================================================
// "Modbus 센서 결과 파싱" (id dd4fbcb2fc58f036) — 센서 수집 탭. 2026-09-19 하우스 복합키 추가
// ============================================================
const uniqueReads = flow.get('modbusUniqueReads') || [];
const sensorMap = flow.get('modbusSensorMap') || {};
var idx = flow.get('modbusReadIndex') || 0;
var readings = flow.get('modbusReadings') || {};

var currentRead = uniqueReads[idx];
if (currentRead && msg.payload) {
    var sensors = sensorMap[currentRead.key] || [];
    for (var i = 0; i < sensors.length; i++) {
        var s = sensors[i];
        var rawValue = Array.isArray(msg.payload) ? msg.payload[s.registerIndex || 0] : msg.payload;
        var parsed = rawValue;
        if (s.signed && rawValue > 0x7FFF) {
            parsed = -(0xFFFF - rawValue + 1);
        }
        if (s.divider && s.divider !== 1) {
            parsed = parsed / s.divider;
        }
        parsed = Math.round(parsed * 100) / 100;
        // 2026-09-19: 하우스 복합키 — sensorId 만이면 하우스끼리 같은 id 가 섞인다. 레거시 키는 호환용(③ 는 매핑된 센서에만 씀)
        readings[s.houseId + ':' + s.sensorId] = parsed;
        readings[s.sensorId] = parsed;
    }
    flow.set('modbusReadings', readings);
}

idx++;
flow.set('modbusReadIndex', idx);

if (idx < uniqueReads.length) {
    var next = uniqueReads[idx];
    msg.payload = {
        fc: next.fc,
        unitid: next.unitId,
        address: next.address,
        quantity: next.quantity
    };
    msg._modbusKey = next.key;
    node.status({ fill: 'blue', shape: 'dot', text: 'Modbus 읽기 ' + (idx + 1) + '/' + uniqueReads.length });
    return [msg, null];
}

flow.set('modbusUniqueReads', []);
msg.modbusReadings = readings;
msg.config = flow.get('modbusReadConfig') || msg.config;
var count = Object.keys(readings).length;
node.status({ fill: 'green', shape: 'dot', text: 'Modbus 완료: ' + count + '개 센서' });
return [null, msg];
