// ================================================================
// Node-RED: 릴레이 전체 OFF (POST /api/relay/reset-all)
// ================================================================
// 플로우 구성:
//   HTTP In (POST /api/relay/reset-all)
//     → function (아래 코드)
//       → Modbus Flex Write (기존 relay-485)
//       → HTTP Response
// ================================================================
// function 노드 코드:

var results = [];
var commands = [];

// ① Waveshare 8CH (Unit-Id 1, FC15 coil, 0-indexed) — 한번에 8채널 OFF
commands.push({
    payload: {
        value: [0, 0, 0, 0, 0, 0, 0, 0],
        unitid: 1,
        fc: 15,
        address: 0,
        quantity: 8
    },
    label: 'Waveshare 8CH'
});

// ② Eletechsup 8CH (Unit-Id 2, FC06 register, 1-indexed) — 채널별 OFF
for (var i = 1; i <= 8; i++) {
    commands.push({
        payload: {
            value: 0,
            unitid: 2,
            fc: 6,
            address: i,
            quantity: 1
        },
        label: 'Eletechsup CH' + i
    });
}

// 200ms 간격으로 순차 전송
var sent = 0;
var total = commands.length;

function sendNext() {
    if (sent >= total) {
        // 모든 명령 전송 완료 → HTTP 응답
        msg.payload = {
            success: true,
            detail: total + '개 명령 전송',
            results: results
        };
        msg.statusCode = 200;
        node.send([null, msg]); // 출력2 → HTTP Response
        node.warn('🔄 릴레이 전체 OFF 완료: ' + total + '개 명령');
        return;
    }

    var cmd = commands[sent];
    var m = RED.util.cloneMessage(msg);
    m.payload = cmd.payload;
    results.push(cmd.label + ' → OFF');
    sent++;

    node.send([m, null]); // 출력1 → Modbus Flex Write

    if (sent < total) {
        setTimeout(sendNext, 200);
    } else {
        // 마지막 명령 후 약간 대기 후 응답
        setTimeout(sendNext, 300);
    }
}

sendNext();

// ★ return null — 비동기 처리 (sendNext에서 node.send로 직접 전송)
return null;

// ================================================================
// 노드 연결:
//   출력 1 → Modbus Flex Write (relay-485)
//   출력 2 → HTTP Response
//
// HTTP In 설정:
//   Method: POST
//   URL: /api/relay/reset-all
//
// function 노드 설정:
//   출력 수: 2
// ================================================================
