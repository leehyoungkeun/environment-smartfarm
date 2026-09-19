/*
 * ksx3267_actuator_node_uno.ino  (2026-09-19)
 * KS X 3267:2022 부속서 A.2 디폴트 레지스터 맵 — 구동기 노드 (Modbus RTU 슬레이브, 레벨 1)
 *
 * 하드웨어 : Arduino UNO + MAX485
 *            MAX485 RO -> D10 (SoftwareSerial RX)
 *            MAX485 DI -> D11 (SoftwareSerial TX)
 *            MAX485 DE+RE -> D4
 *            USB 시리얼(D0/D1)은 디버그 출력 전용 (115200)
 *   출력 핀 (LED 나 릴레이 모듈로 동작을 눈으로 확인)
 *            스위치1..4  -> D5, D6, D7, D8   (스위치1 은 보드 LED D13 에도 같이)
 *            개폐기1 열림/닫힘 -> D2 / D3
 *            개폐기2 열림/닫힘 -> D12 / A1
 * 통신     : 9600 bps 8N1, 슬레이브 주소 1. FC 03/04 읽기, FC 06/16 쓰기
 *
 * 주소 규칙 : 전문(PDU) 주소 = KS 레지스터 번호 그대로 (KS X 3267 4.3.4.1 예시: 레지스터 100 → 0x0064)
 * 레지스터맵 (부속서 A.2, 공식):
 *   1~8   노드정보 (기관 0 · 회사 0 · 제품타입 2 · 제품코드 0 · 프로토콜 10 · 채널 24 · 시리얼 lo/hi)
 *   101~124 디바이스 코드  i=1..16 스위치 102 / i=17..24 개폐기 112 (미부착은 0)
 *   201 노드 OPID · 202 노드 상태
 *   스위치 k 상태  203+4(k-1): opid, status, remain lo, remain hi
 *   개폐기 j 상태  267+4(j-1): opid, status, remain lo, remain hi
 *   501 노드 명령 · 502 노드 명령 OPID
 *   스위치 k 명령  503+4(k-1): cmd, opid, time lo, time hi
 *   개폐기 j 명령  567+4(j-1): cmd, opid, time lo, time hi
 * 의미론 (본문 6.1.4 / 6.3.3 / 6.3.4):
 *   - 명령은 "OPID 가 바뀐 시점" 에만 활성화. OPID 0 = 명령 없음. 같은 OPID 다시 쓰면 무시.
 *   - 스위치: 0 OFF→READY(0) · 201 ON→ON(201) 무한 · 202 시간 ON→ON + 남은시간 → 만료 시 READY
 *   - 개폐기: 0 정지→READY · 301 열기→OPENING(301) 완전 개폐 시간 · 302 닫기→CLOSING(302)
 *             303/304 시간 열기/닫기→지정 시간만 · 만료 시 READY
 *   - 레벨 2 명령(203, 305, 306)·미부착 디바이스·시간 0 인 TIMED → 예외 0x03(illegal data value), 아무것도 안 바뀜
 *   - 상태 블록의 OPID 는 실행 중 명령의 OPID, READY 면 0 (표 16)
 * uint32(남은시간·작동시간)·float 은 하위 워드 먼저 (4.3.3).
 */

#include <SoftwareSerial.h>

#define RS485_RX   10
#define RS485_TX   11
#define DE_RE_PIN  4
#define SLAVE_ID   1
#define BAUD       9600

// 부착 디바이스 수 (1~16 / 1~8). 나머지는 코드 0 = 미부착
#define SWITCHES   4
#define OPENERS    2
#define OPENER_FULL_SEC 30UL   // 301/302 완전 열림·닫힘 소요(초) — 제어기 하우스 설정의 30 s 와 같게

// 디버그: 받은 프레임을 USB 시리얼에 hex 로 (배선 확인 뒤 0)
#define DEBUG_RX 1

SoftwareSerial rs485(RS485_RX, RS485_TX);

// ---- 노드 정보 ----
const uint16_t PRODUCT_TYPE = 2, PROTO_VER = 10, CHANNELS = 24;
const uint32_t SERIAL_NO = 2;

// ---- 상태·명령 코드 (B.2 / B.3) ----
enum { ST_READY = 0, ST_SWITCH_ON = 201, ST_OPENING = 301, ST_CLOSING = 302 };
enum { OP_OFF_STOP = 0, OP_ON = 201, OP_TIMED_ON = 202, OP_DIR_ON = 203,
       OP_OPEN = 301, OP_CLOSE = 302, OP_TIMED_OPEN = 303, OP_TIMED_CLOSE = 304, OP_SET_POS = 305, OP_SET_CFG = 306 };

// ---- 디바이스 상태 (i = 0..23, 0..15 스위치, 16..23 개폐기) ----
struct Dev {
  uint16_t cmd, cmdOpid, tLo, tHi;   // 명령 블록 (쓰기 영역, 마지막에 쓴 값 그대로 보임)
  uint16_t lastOpid;                 // 마지막으로 활성화된 OPID (같으면 무시)
  uint16_t opid, status;             // 상태 블록
  unsigned long endMs;               // 만료 시각 (0 = 무한/없음)
  bool timed;
};
Dev dev[24];
uint16_t nodeOpid = 0, nodeCmd = 0, nodeCmdOpid = 0, nodeLastOpid = 0;

inline bool attached(uint8_t i) { return i < 16 ? (i < SWITCHES) : (i - 16 < OPENERS); }
inline bool isSwitch(uint8_t i) { return i < 16; }

// 출력 핀
const uint8_t SW_PIN[4] = { 5, 6, 7, 8 };
const uint8_t OP_OPEN_PIN[2] = { 2, 12 };
const uint8_t OP_CLOSE_PIN[2] = { 3, A1 };

void applyOutputs(uint8_t i) {
  if (isSwitch(i)) {
    if (i < 4) digitalWrite(SW_PIN[i], dev[i].status == ST_SWITCH_ON);
    if (i == 0) digitalWrite(LED_BUILTIN, dev[i].status == ST_SWITCH_ON);
  } else {
    uint8_t j = i - 16;
    if (j < 2) {
      digitalWrite(OP_OPEN_PIN[j], dev[i].status == ST_OPENING);
      digitalWrite(OP_CLOSE_PIN[j], dev[i].status == ST_CLOSING);
    }
  }
}

uint32_t remainSec(const Dev &d) {
  if (d.status == ST_READY || !d.timed) return 0;
  long ms = (long)(d.endMs - millis());
  if (ms <= 0) return 0;
  return (uint32_t)((ms + 999) / 1000);
}

// ---- 레지스터 읽기 (주소 → 값) ----
uint16_t regAt(uint16_t a) {
  switch (a) {
    case 1: case 2: case 4: return 0;
    case 3: return PRODUCT_TYPE;
    case 5: return PROTO_VER;
    case 6: return CHANNELS;
    case 7: return SERIAL_NO & 0xFFFF;
    case 8: return SERIAL_NO >> 16;
    case 201: return nodeOpid;
    case 202: return ST_READY;
    case 501: return nodeCmd;
    case 502: return nodeCmdOpid;
  }
  if (a >= 101 && a <= 124) { uint8_t i = a - 101; return attached(i) ? (isSwitch(i) ? 102 : 112) : 0; }
  if (a >= 203 && a <= 298) {
    uint8_t i = (a - 203) / 4, f = (a - 203) % 4;           // 203+4(k-1) 스위치 16개 뒤 267 부터 개폐기 — 연속이라 한 공식
    const Dev &d = dev[i];
    uint32_t r = remainSec(d);
    switch (f) { case 0: return d.opid; case 1: return d.status; case 2: return r & 0xFFFF; default: return r >> 16; }
  }
  if (a >= 503 && a <= 598) {
    uint8_t i = (a - 503) / 4, f = (a - 503) % 4;
    const Dev &d = dev[i];
    switch (f) { case 0: return d.cmd; case 1: return d.cmdOpid; case 2: return d.tLo; default: return d.tHi; }
  }
  return 0;   // 9~100 예약, 그 밖은 0
}

// ---- 명령 활성화 (쓰기 뒤) ----
// 반환 0 = 정상, 3 = illegal data value (아무것도 바꾸지 않음)
uint8_t validate(uint8_t i, uint16_t op, uint16_t opid, uint32_t t) {
  if (opid == 0 || opid == dev[i].lastOpid) return 0;      // 활성화 아님 → 검사 대상 아님
  if (!attached(i)) return 3;
  if (isSwitch(i)) {
    if (op == OP_OFF_STOP || op == OP_ON) return 0;
    if (op == OP_TIMED_ON) return t > 0 ? 0 : 3;
    return 3;                                              // 203 레벨2·그 외
  }
  if (op == OP_OFF_STOP || op == OP_OPEN || op == OP_CLOSE) return 0;
  if (op == OP_TIMED_OPEN || op == OP_TIMED_CLOSE) return t > 0 ? 0 : 3;
  return 3;                                                // 305/306 레벨2·그 외
}

void activate(uint8_t i) {
  Dev &d = dev[i];
  uint16_t op = d.cmd, opid = d.cmdOpid;
  uint32_t t = ((uint32_t)d.tHi << 16) | d.tLo;
  if (opid == 0 || opid == d.lastOpid) return;
  d.lastOpid = opid;
  unsigned long now = millis();
  d.timed = false; d.endMs = 0;
  if (op == OP_OFF_STOP)            { d.status = ST_READY; }
  else if (isSwitch(i)) {
    d.status = ST_SWITCH_ON;
    if (op == OP_TIMED_ON)          { d.timed = true; d.endMs = now + t * 1000UL; }
  } else {
    d.status = (op == OP_OPEN || op == OP_TIMED_OPEN) ? ST_OPENING : ST_CLOSING;
    d.timed = true;
    d.endMs = now + ((op == OP_OPEN || op == OP_CLOSE) ? OPENER_FULL_SEC : t) * 1000UL;
  }
  d.opid = (d.status == ST_READY) ? 0 : opid;   // 표 16: 실행 중 명령 없으면 0
  applyOutputs(i);
  Serial.print(F("ACT #")); Serial.print(i + 1); Serial.print(F(" op=")); Serial.print(op);
  Serial.print(F(" opid=")); Serial.print(opid); Serial.print(F(" t=")); Serial.print(t);
  Serial.print(F(" -> status=")); Serial.println(d.status);
}

void tick() {
  unsigned long now = millis();
  for (uint8_t i = 0; i < 24; i++) {
    Dev &d = dev[i];
    if (d.status != ST_READY && d.timed && (long)(now - d.endMs) >= 0) {
      d.status = ST_READY; d.opid = 0; d.timed = false; d.endMs = 0;
      applyOutputs(i);
      Serial.print(F("DONE #")); Serial.println(i + 1);
    }
  }
}

// ---- 쓰기: 먼저 전부 검증, 통과하면 적용 후 활성화 ----
// vals[0..n-1] 을 start 부터. 반환 예외코드 0/2/3
uint8_t writeRegs(uint16_t start, uint16_t n, const uint16_t *vals) {
  uint16_t end = start + n - 1;
  if (start < 501 || end > 598) return 2;                    // 쓰기 영역 밖
  // 1) 검증: 영향 받는 디바이스마다 "쓰고 난 뒤 블록" 으로 판정
  for (uint8_t i = 0; i < 24; i++) {
    uint16_t b = 503 + 4 * i;
    if (end < b || start > b + 3) continue;
    uint16_t blk[4] = { dev[i].cmd, dev[i].cmdOpid, dev[i].tLo, dev[i].tHi };
    for (uint8_t f = 0; f < 4; f++) { uint16_t a = b + f; if (a >= start && a <= end) blk[f] = vals[a - start]; }
    uint8_t e = validate(i, blk[0], blk[1], ((uint32_t)blk[3] << 16) | blk[2]);
    if (e) return e;
  }
  // 2) 적용
  for (uint16_t a = start; a <= end; a++) {
    uint16_t v = vals[a - start];
    if (a == 501) nodeCmd = v;
    else if (a == 502) nodeCmdOpid = v;
    else if (a >= 503) { uint8_t i = (a - 503) / 4, f = (a - 503) % 4; Dev &d = dev[i];
      if (f == 0) d.cmd = v; else if (f == 1) d.cmdOpid = v; else if (f == 2) d.tLo = v; else d.tHi = v; }
  }
  // 3) 활성화 (OPID 변경 시점)
  if (start <= 502 && end >= 501 && nodeCmdOpid && nodeCmdOpid != nodeLastOpid) { nodeLastOpid = nodeCmdOpid; nodeOpid = nodeCmdOpid; }
  for (uint8_t i = 0; i < 24; i++) {
    uint16_t b = 503 + 4 * i;
    if (end >= b && start <= b + 3) activate(i);
  }
  return 0;
}

// ---- Modbus RTU ----
uint8_t  frame[64];
uint8_t  frameLen = 0;
unsigned long lastByteAt = 0;
const unsigned long FRAME_GAP_MS = 4;   // 9600bps 3.5문자 ≈ 4ms

uint16_t crc16(const uint8_t *buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= buf[i];
    for (uint8_t b = 0; b < 8; b++) crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

void sendFrame(uint8_t *buf, uint8_t len) {
  uint16_t crc = crc16(buf, len);
  buf[len++] = crc & 0xFF; buf[len++] = crc >> 8;
  digitalWrite(DE_RE_PIN, HIGH);
  rs485.write(buf, len);           // SoftwareSerial 은 동기 송신
  digitalWrite(DE_RE_PIN, LOW);
}

void sendException(uint8_t fc, uint8_t code) {
  uint8_t r[5] = { SLAVE_ID, (uint8_t)(fc | 0x80), code };
  sendFrame(r, 3);
}

void dumpRx(const char *tag) {
#if DEBUG_RX
  Serial.print(F("RX ")); Serial.print(tag); Serial.print(F(" len=")); Serial.print(frameLen); Serial.print(':');
  for (uint8_t i = 0; i < frameLen; i++) { Serial.print(' '); if (frame[i] < 16) Serial.print('0'); Serial.print(frame[i], HEX); }
  Serial.println();
#endif
}

static uint8_t resp[3 + 250 + 2];

void handleFrame() {
  if (frameLen < 8 || frame[0] != SLAVE_ID) { dumpRx("ignored"); return; }
  uint16_t crc = frame[frameLen - 2] | (frame[frameLen - 1] << 8);
  if (crc != crc16(frame, frameLen - 2)) { dumpRx("CRC-bad"); return; }
  dumpRx("ok");
  uint8_t fc = frame[1];
  uint16_t start = (frame[2] << 8) | frame[3];

  if (fc == 0x03 || fc == 0x04) {
    uint16_t qty = (frame[4] << 8) | frame[5];
    if (qty < 1 || qty > 125)                      { sendException(fc, 0x03); return; }
    if (start == 0 || (uint32_t)start + qty > 599) { sendException(fc, 0x02); return; }
    resp[0] = SLAVE_ID; resp[1] = fc; resp[2] = qty * 2;
    for (uint16_t i = 0; i < qty; i++) { uint16_t v = regAt(start + i); resp[3 + i * 2] = v >> 8; resp[4 + i * 2] = v & 0xFF; }
    sendFrame(resp, 3 + qty * 2);
    return;
  }
  if (fc == 0x06) {                                // 단일 쓰기
    uint16_t v = (frame[4] << 8) | frame[5];
    uint8_t e = writeRegs(start, 1, &v);
    if (e) { sendException(fc, e); return; }
    memcpy(resp, frame, 6); sendFrame(resp, 6);    // 에코
    return;
  }
  if (fc == 0x10) {                                // 다중 쓰기
    uint16_t qty = (frame[4] << 8) | frame[5];
    uint8_t bc = frame[6];
    if (qty < 1 || qty > 24 || bc != qty * 2 || frameLen != 9 + bc) { sendException(fc, 0x03); return; }
    uint16_t vals[24];
    for (uint16_t i = 0; i < qty; i++) vals[i] = (frame[7 + i * 2] << 8) | frame[8 + i * 2];
    uint8_t e = writeRegs(start, qty, vals);
    if (e) { sendException(fc, e); return; }
    memcpy(resp, frame, 6); sendFrame(resp, 6);    // 시작주소·수량 에코
    return;
  }
  sendException(fc, 0x01);
}

void pollModbus() {
  while (rs485.available()) {
    if (frameLen < sizeof(frame)) frame[frameLen++] = rs485.read();
    else rs485.read();
    lastByteAt = millis();
  }
  if (frameLen > 0 && millis() - lastByteAt >= FRAME_GAP_MS) { handleFrame(); frameLen = 0; }
}

void setup() {
  pinMode(DE_RE_PIN, OUTPUT); digitalWrite(DE_RE_PIN, LOW);
  pinMode(LED_BUILTIN, OUTPUT);
  for (uint8_t k = 0; k < 4; k++) pinMode(SW_PIN[k], OUTPUT);
  for (uint8_t j = 0; j < 2; j++) { pinMode(OP_OPEN_PIN[j], OUTPUT); pinMode(OP_CLOSE_PIN[j], OUTPUT); }
  memset(dev, 0, sizeof(dev));
  for (uint8_t i = 0; i < 24; i++) applyOutputs(i);
  Serial.begin(115200);
  rs485.begin(BAUD);
  Serial.print(F("KS X 3267 actuator node (UNO) ready, ID ")); Serial.print(SLAVE_ID);
  Serial.print(F(", switches ")); Serial.print(SWITCHES); Serial.print(F(", openers ")); Serial.print(OPENERS);
  Serial.println(F(", PDU addr = KS reg"));
}

void loop() {
  pollModbus();   // delay() 금지
  tick();
}
