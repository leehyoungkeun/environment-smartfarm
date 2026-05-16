// 양액 시뮬레이터 — 하드웨어 도착 전 가상 EC/pH/유량 생성
// 입력: timestamp inject (5초 주기)
// 출력: msg.payload = { ec, ph, flow, temperature, timestamp }
//
// 활성화: global.set('nutrientSimulator', true)
// 비활성화 시 (실 센서 사용): return null

const enabled = global.get('nutrientSimulator');
if (!enabled) return null;

// 메인 펌프 상태 (다른 플로우에서 set)
const pumpOn = global.get('mainPumpOn') || false;

// 안정 상태 기준값 (시나리오 active 시 그 ecTarget 근처로 수렴)
const activeScenario = global.get('activeScenario') || {};
const ecTarget = activeScenario.ecTarget || 2.0;
const phTarget = activeScenario.phTarget || 6.0;

// 이전 값 (천천히 변동)
let prev = context.get('lastReading') || { ec: ecTarget, ph: phTarget };

// 작은 노이즈 + 타겟 수렴
const drift = (target, current, noise) => {
    const towards = (target - current) * 0.1;
    const random = (Math.random() - 0.5) * noise;
    return +(current + towards + random).toFixed(3);
};

const reading = {
    ec: drift(ecTarget, prev.ec, 0.05),
    ph: drift(phTarget, prev.ph, 0.03),
    temperature: +(22 + (Math.random() - 0.5) * 2).toFixed(1),
    flow: pumpOn ? +(8 + (Math.random() - 0.5) * 0.5).toFixed(2) : 0,
    timestamp: new Date().toISOString(),
    source: 'simulator',
};

context.set('lastReading', reading);
msg.payload = reading;

// 상태 표시용 노드 메시지
node.status({ fill: 'blue', shape: 'dot', text: `EC ${reading.ec} · pH ${reading.ph}` });

return msg;
