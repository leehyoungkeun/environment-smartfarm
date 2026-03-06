/**
 * Node-RED Function 2: MQTT 파싱 + Modbus 매핑 (v2)
 *
 * moduleType에 따라 FC15(Waveshare) / FC06(Eletechsup) 자동 분기
 *
 * RPi Node-RED의 aws_control_test_tab에서 function 2 노드의
 * 코드를 이 내용으로 교체하세요.
 *
 * 입력: MQTT 메시지 (payload.modbus 포함)
 * 출력: Modbus Flex Write 노드로 전달 (출력 1개)
 */

// MQTT 페이로드에서 modbus 설정 추출
const modbus = msg.payload.modbus || msg.modbus;
const command = msg.payload.command || msg.command || 'stop';
const deviceId = msg.payload.window_id || msg.payload.device_id || 'unknown';
const houseId = msg.payload.house_id || 'unknown';

if (!modbus || modbus.address === null || modbus.address === undefined) {
    node.warn(`[Modbus] ${deviceId}: modbus 설정 없음 — 무시`);
    node.status({ fill: 'yellow', shape: 'ring', text: `${deviceId}: modbus 미설정` });
    return null;
}

const unitId = modbus.unitId || 1;
const controlType = modbus.controlType || 'single';
const address = modbus.address;
const address2 = modbus.address2;
const moduleType = modbus.moduleType || 'waveshare';

node.warn(`[Modbus] ${moduleType} uid:${unitId} ${deviceId} ${command} (${controlType})`);

// ━━━ moduleType별 분기 ━━━

if (moduleType === 'eletechsup') {
    // ━━━ Eletechsup: FC06 (Write Single Register) ━━━
    // register = 채널번호(1~8), value = 0x0100(ON) / 0x0200(OFF)
    // 중요: return msg (배열 아님), node.send(msg2) (배열 아님) — 1-output 노드 호환

    if (controlType === 'bidir') {
        // 양방향: open=CH1 ON, close=CH2 ON, stop=둘 다 OFF
        if (command === 'open') {
            // CH2 OFF 먼저, 300ms 후 CH1 ON
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0200 };
            msg2.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0100 };
            setTimeout(function() { node.send(msg2); }, 300);
            node.status({ fill: 'green', shape: 'dot', text: `FC06 열기: uid${unitId} reg${address} ON` });
            return msg;
        } else if (command === 'close') {
            // CH1 OFF 먼저, 300ms 후 CH2 ON
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            msg2.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0100 };
            setTimeout(function() { node.send(msg2); }, 300);
            node.status({ fill: 'green', shape: 'dot', text: `FC06 닫기: uid${unitId} reg${address2} ON` });
            return msg;
        } else {
            // stop: 둘 다 OFF
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            msg2.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0200 };
            setTimeout(function() { node.send(msg2); }, 300);
            node.status({ fill: 'grey', shape: 'dot', text: `FC06 정지: uid${unitId} ALL OFF` });
            return msg;
        }
    } else {
        // 단방향: on=ON, off=OFF
        const value = (command === 'on' || command === 'open') ? 0x0100 : 0x0200;
        msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: value };
        node.status({ fill: 'green', shape: 'dot', text: `FC06 uid${unitId} reg${address} val:0x${value.toString(16)}` });
        return msg;
    }

} else {
    // ━━━ Waveshare (기본): FC15 (Write Multiple Coils) ━━━

    if (controlType === 'bidir') {
        if (command === 'open') {
            msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [true, false] };
            node.status({ fill: 'green', shape: 'dot', text: `FC15 열기: uid${unitId} ch${address}=ON ch${address2}=OFF` });
        } else if (command === 'close') {
            msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, true] };
            node.status({ fill: 'green', shape: 'dot', text: `FC15 닫기: uid${unitId} ch${address}=OFF ch${address2}=ON` });
        } else {
            msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, false] };
            node.status({ fill: 'grey', shape: 'dot', text: `FC15 정지: uid${unitId} ALL OFF` });
        }
    } else {
        const on = (command === 'on' || command === 'open');
        msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 1, value: [on] };
        node.status({ fill: 'green', shape: 'dot', text: `FC15 uid${unitId} ch${address}=${on ? 'ON' : 'OFF'}` });
    }

    return msg;
}
