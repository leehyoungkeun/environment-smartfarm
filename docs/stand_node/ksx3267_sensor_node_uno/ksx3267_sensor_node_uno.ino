/*
 * ksx3267_sensor_node_uno.ino  — 검토 반영판 (2026-09-19)
 * KS X 3267:2022 부속서 A.1 디폴트 레지스터 맵 — 센서 노드 (Modbus RTU 슬레이브)
 *
 * 하드웨어 : Arduino UNO + MAX485
 *            MAX485 RO -> D10 (SoftwareSerial RX)
 *            MAX485 DI -> D11 (SoftwareSerial TX)
 *            MAX485 DE+RE -> D4
 *            USB 시리얼(D0/D1)은 디버그 출력 전용
 * 통신     : 9600 bps, 8N1, 슬레이브 주소 2 (구동기 노드가 1), FC 03/04 지원
 * 라이브러리: 없음 (SoftwareSerial 기본 포함, Modbus 슬레이브 직접 구현)
 *
 * ★ 주소 규칙 (원본과 다른 점) ★
 *   KS X 3267 4.3.4.1 예시: "레지스터 100~103 읽기" 요청의 Starting Address = 0x0064 = 100.
 *   즉 전문(PDU) 주소 = KS 레지스터 번호 그대로. −1 하지 않는다.
 *   통합제어기(ks3267d)도 이 규칙으로 읽는다: 노드정보 (1, 8) · 디바이스코드 (101, 30) · 센서블록 (202, 91).
 *
 * float 인코딩(4.3.3): 워드 내 빅 엔디언, 워드 간 리틀 엔디언(하위 워드 먼저) — 원본 그대로.
 * 온도 1채널·습도 1채널 값은 실제 센서 대신 천천히 흔들리는 모의값(교육·시험용).
 */

#include <SoftwareSerial.h>

#define RS485_RX     10
#define RS485_TX     11
#define DE_RE_PIN    4
#define SLAVE_ID     2   // 구동기 노드(주소 1)와 같은 버스에 함께 붙인다 — 3번 하우스 온도1 매핑 = U2 #1 (2026-09-19)
#define BAUD         9600

SoftwareSerial rs485(RS485_RX, RS485_TX);

// ---- 레지스터 저장소: 인덱스 = KS 주소 = 전문 주소. 0 은 미사용, 1~292 사용 ----
// 제어기가 (202, 91) 을 읽으므로 292 까지 있어야 한다 → 배열 크기 293.
const uint16_t REG_COUNT = 293;
uint16_t regs[REG_COUNT];

inline void setReg(uint16_t ksAddr, uint16_t v) { regs[ksAddr] = v; }

void setFloat(uint16_t ksAddr, float v) {      // 4.3.3 규칙
  uint32_t raw; memcpy(&raw, &v, 4);
  setReg(ksAddr,     raw & 0xFFFF);            // 하위 워드 먼저
  setReg(ksAddr + 1, raw >> 16);               // 상위 워드
}
void setU32(uint16_t ksAddr, uint32_t v) {
  setReg(ksAddr,     v & 0xFFFF);
  setReg(ksAddr + 1, v >> 16);
}

// ---- KS X 3267 A.1 노드 정보 상수 ----
const uint16_t ORG_CODE     = 0;   // 1 기관코드 (디폴트 맵 = 0)
const uint16_t COMPANY_CODE = 0;   // 2 회사코드 (디폴트 맵 = 0)
const uint16_t PRODUCT_TYPE = 1;   // 3 제품타입 (1 = 센서 노드)
const uint16_t PRODUCT_CODE = 0;   // 4 제품코드
const uint16_t PROTO_VER    = 10;  // 5 프로토콜 버전 (표 9)
const uint16_t CHANNELS     = 30;  // 6 채널수 (디폴트 맵 고정)
const uint32_t SERIAL_NO    = 1;   // 7~8 시리얼번호 (하위 워드 먼저)
const uint16_t DEV_TEMP     = 1;   // 101 온도1 디바이스 코드
const uint16_t DEV_HUMI     = 2;   // 104 습도1 디바이스 코드
const uint16_t STAT_READY   = 0;   // 202/205/214 상태 코드

// ---- 모의 관측치: 1초마다 ±0.3 ℃ / ±1 % 안에서 천천히 흔들린다 ----
// (원본은 매초 18~32 ℃ 난수 — 제어기 §5.4.3 변화 이력이 매 폴링마다 쌓여 표가 넘친다)
float temp = 25.0, humi = 60.0;
const float TEMP_MIN = 18.0, TEMP_MAX = 32.0;
const float HUMI_MIN = 40.0, HUMI_MAX = 90.0;
const unsigned long UPDATE_MS = 1000;
unsigned long lastUpdate = 0;

// ---- Modbus RTU 프레임 처리 ----
uint8_t  frame[64];
uint8_t  frameLen = 0;
unsigned long lastByteAt = 0;
const unsigned long FRAME_GAP_MS = 4;           // 9600bps 3.5문자 ≈ 4ms

uint16_t crc16(const uint8_t *buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= buf[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 1) ? (crc >> 1) ^ 0xA001 : crc >> 1;
  }
  return crc;
}

void sendFrame(uint8_t *buf, uint8_t len) {
  uint16_t crc = crc16(buf, len);
  buf[len++] = crc & 0xFF;                       // CRC는 하위 바이트 먼저
  buf[len++] = crc >> 8;
  digitalWrite(DE_RE_PIN, HIGH);                 // 송신 모드
  rs485.write(buf, len);                         // SoftwareSerial 은 동기 송신 — 리턴 시 전송 끝
  digitalWrite(DE_RE_PIN, LOW);                  // 수신 모드 복귀
}

void sendException(uint8_t fc, uint8_t code) {
  uint8_t r[5] = { SLAVE_ID, (uint8_t)(fc | 0x80), code };
  sendFrame(r, 3);
}

// 디버그: 받은 프레임을 USB 시리얼에 hex 로 찍는다 (배선 확인용. 확인 끝나면 DEBUG_RX 0)
#define DEBUG_RX 1
void dumpRx(const char *tag) {
#if DEBUG_RX
  Serial.print(F("RX ")); Serial.print(tag); Serial.print(F(" len=")); Serial.print(frameLen); Serial.print(':');
  for (uint8_t i = 0; i < frameLen; i++) { Serial.print(' '); if (frame[i] < 16) Serial.print('0'); Serial.print(frame[i], HEX); }
  Serial.println();
#endif
}

void handleFrame() {
  if (frameLen < 8 || frame[0] != SLAVE_ID) { dumpRx("ignored"); return; }   // 브로드캐스트(0)·타 주소 무시
  uint16_t crc = frame[frameLen - 2] | (frame[frameLen - 1] << 8);
  if (crc != crc16(frame, frameLen - 2)) { dumpRx("CRC-bad"); return; }
  dumpRx("ok");

  uint8_t fc = frame[1];
  if (fc != 0x03 && fc != 0x04) { sendException(fc, 0x01); return; }  // 센서 노드는 읽기 전용

  uint16_t start = (frame[2] << 8) | frame[3];   // 전문 주소 = KS 레지스터 번호
  uint16_t qty   = (frame[4] << 8) | frame[5];
  if (qty < 1 || qty > 125)                     { sendException(fc, 0x03); return; }
  if (start == 0 || (uint32_t)start + qty > REG_COUNT) { sendException(fc, 0x02); return; }

  static uint8_t r[3 + 250 + 2];
  r[0] = SLAVE_ID; r[1] = fc; r[2] = qty * 2;
  for (uint16_t i = 0; i < qty; i++) {
    r[3 + i * 2]     = regs[start + i] >> 8;
    r[3 + i * 2 + 1] = regs[start + i] & 0xFF;
  }
  sendFrame(r, 3 + qty * 2);
}

void pollModbus() {
  while (rs485.available()) {
    if (frameLen < sizeof(frame)) frame[frameLen++] = rs485.read();
    else rs485.read();
    lastByteAt = millis();
  }
  if (frameLen > 0 && millis() - lastByteAt >= FRAME_GAP_MS) {
    handleFrame();
    frameLen = 0;
  }
}

float drift(float v, float step, float lo, float hi) {
  v += (random(-1000, 1001) / 1000.0f) * step;
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  return v;
}

void setup() {
  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW);
  Serial.begin(115200);
  rs485.begin(BAUD);
  randomSeed(analogRead(A0));

  memset(regs, 0, sizeof(regs));
  setReg(1, ORG_CODE);  setReg(2, COMPANY_CODE);
  setReg(3, PRODUCT_TYPE); setReg(4, PRODUCT_CODE);
  setReg(5, PROTO_VER); setReg(6, CHANNELS);
  setU32(7, SERIAL_NO);
  setReg(101, DEV_TEMP);                         // 미장착 채널(102~130)은 0
  setReg(104, DEV_HUMI);
  setReg(202, STAT_READY);                       // 노드 상태
  setFloat(203, temp); setReg(205, STAT_READY);  // 온도1 값·상태 (203+3(1-1))
  setFloat(212, humi); setReg(214, STAT_READY);  // 습도1 값·상태 (203+3(4-1))

  Serial.print(F("KS X 3267 sensor node (UNO) ready, ID ")); Serial.print(SLAVE_ID); Serial.println(F(", PDU addr = KS reg"));
}

void loop() {
  pollModbus();                                  // delay() 금지 — 스캔 정지

  if (millis() - lastUpdate >= UPDATE_MS) {
    lastUpdate = millis();
    temp = drift(temp, 0.3f, TEMP_MIN, TEMP_MAX);
    humi = drift(humi, 1.0f, HUMI_MIN, HUMI_MAX);
    setFloat(203, temp); setReg(205, STAT_READY);
    setFloat(212, humi); setReg(214, STAT_READY);
    Serial.print(F("temp=")); Serial.print(temp, 2);
    Serial.print(F("  humi=")); Serial.println(humi, 2);
  }
}
