// src/services/mqttClient.js
// AWS IoT Core MQTT 클라이언트 — 릴레이 상태 구독 + 제어 응답 수신

import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import logger from "../utils/logger.js";
import { pool } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = path.resolve(__dirname, "../../certs");

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtts://a2ybxz5mrpnfww-ats.iot.ap-northeast-2.amazonaws.com:8883";
const CLIENT_ID = process.env.MQTT_CLIENT_ID || `smartfarm-backend-${Date.now()}`;

// 구독 토픽
const TOPICS = [
  "smartfarm/+/+/response",       // 제어 실행 응답
  "smartfarm/+/relay/status",     // 릴레이 상태 업데이트
  "smartfarm/+/relay/response",   // 릴레이 조회 응답
  "smartfarm/+/device/position",  // 장치 위치 (자동 정지 후)
];

class MqttService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.latestRelayStatus = {}; // { farmId: { houseId: { coils, timestamp } } }
  }

  connect() {
    // 인증서 파일 확인
    const certPath = path.join(CERTS_DIR, "certificate.pem.crt");
    const keyPath = path.join(CERTS_DIR, "private.pem.key");
    const caPath = path.join(CERTS_DIR, "AmazonRootCA1.pem");

    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath) || !fs.existsSync(caPath)) {
      logger.warn("⚠️ MQTT 인증서 없음 — MQTT 비활성화 (certs/ 디렉토리 확인)");
      return this;
    }

    const options = {
      clientId: CLIENT_ID,
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      ca: fs.readFileSync(caPath),
      protocol: "mqtts",
      protocolVersion: 4,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    };

    logger.info(`🔌 MQTT 연결 시도: ${BROKER_URL} (clientId: ${CLIENT_ID})`);
    this.client = mqtt.connect(BROKER_URL, options);

    this.client.on("connect", () => {
      this.connected = true;
      logger.info("✅ MQTT 연결 성공 (AWS IoT Core)");

      // 토픽 구독
      TOPICS.forEach((topic) => {
        this.client.subscribe(topic, { qos: 1 }, (err) => {
          if (err) {
            logger.error(`MQTT 구독 실패: ${topic}`, err);
          } else {
            logger.info(`📡 MQTT 구독: ${topic}`);
          }
        });
      });
    });

    this.client.on("message", (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        const parts = topic.split("/");
        // smartfarm/{farmIdOrHouse}/{deviceOrRelay}/{action}

        if (topic.match(/smartfarm\/[^/]+\/relay\/status/)) {
          // 릴레이 상태 업데이트
          const farmId = parts[1];
          this._cacheRelayStatus(farmId, payload);
          this.emit("relay:status", { farmId, data: payload, topic });
        } else if (topic.match(/smartfarm\/[^/]+\/relay\/response/)) {
          // 릴레이 조회 응답
          const farmId = parts[1];
          this._cacheRelayStatus(farmId, payload);
          this.emit("relay:response", { farmId, data: payload, topic });
        } else if (topic.match(/smartfarm\/[^/]+\/device\/position/)) {
          // 장치 위치 업데이트 (자동 정지 후)
          const farmId = parts[1];
          this._saveDevicePosition(farmId, payload);
        } else if (topic.match(/smartfarm\/[^/]+\/[^/]+\/response/)) {
          // 제어 실행 응답
          const houseId = parts[1];
          const deviceId = parts[2];
          this.emit("control:response", { houseId, deviceId, data: payload, topic });
        }
      } catch (e) {
        logger.warn("MQTT 메시지 파싱 실패:", e.message);
      }
    });

    this.client.on("error", (err) => {
      logger.error("MQTT 에러:", err.message);
    });

    this.client.on("offline", () => {
      this.connected = false;
      logger.warn("⚠️ MQTT 오프라인");
    });

    this.client.on("reconnect", () => {
      logger.info("🔄 MQTT 재연결 시도...");
    });

    return this;
  }

  // 장치 위치 DB 저장
  async _saveDevicePosition(farmId, payload) {
    try {
      const { deviceId, position, command } = payload;
      if (!deviceId || position === undefined) return;
      await pool.query(
        `INSERT INTO device_positions (farm_id, device_id, position, command, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (farm_id, device_id) DO UPDATE
         SET position = $3, command = $4, updated_at = NOW()`,
        [farmId, deviceId, position, command || 'stop']
      );
      logger.info(`📍 장치 위치 저장: ${farmId}/${deviceId} → ${position}%`);
    } catch (e) {
      logger.error("장치 위치 저장 실패:", e.message);
    }
  }

  // 릴레이 상태 캐시
  _cacheRelayStatus(farmId, payload) {
    if (!this.latestRelayStatus[farmId]) {
      this.latestRelayStatus[farmId] = {};
    }
    const key = payload.houseId || payload.unitId || "default";
    this.latestRelayStatus[farmId][key] = {
      ...payload,
      receivedAt: new Date().toISOString(),
    };
  }

  // 릴레이 조회 요청 발행
  publishRelayQuery(farmId) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — 릴레이 조회 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/relay/query`;
    const payload = JSON.stringify({
      action: "query",
      farmId,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 });
    logger.info(`📤 MQTT 릴레이 조회 요청: ${topic}`);
    return true;
  }

  // 설정 업데이트 발행 (모듈 추가/삭제 시 RPi 즉시 동기화)
  publishConfigUpdate(farmId, payload = {}) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — config update 발행 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/config/update`;
    const message = JSON.stringify({
      farmId,
      timestamp: new Date().toISOString(),
      ...payload,
    });
    this.client.publish(topic, message, { qos: 1 });
    logger.info(`📤 MQTT config 업데이트 발행: ${topic}`);
    return true;
  }

  // 캐시된 릴레이 상태 조회
  getRelayStatus(farmId) {
    return this.latestRelayStatus[farmId] || null;
  }

  // 연결 상태
  isConnected() {
    return this.connected;
  }

  // 종료
  disconnect() {
    if (this.client) {
      this.client.end();
      this.connected = false;
      logger.info("MQTT 연결 종료");
    }
  }
}

// 싱글톤
const mqttService = new MqttService();

export function initMqttClient() {
  return mqttService.connect();
}

export default mqttService;
