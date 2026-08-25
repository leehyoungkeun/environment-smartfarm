// src/services/mqttClient.js
// AWS IoT Core MQTT 클라이언트 — 릴레이 상태 구독 + 제어 응답 수신

import mqtt from "mqtt";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import logger from "../utils/logger.js";
import { pool } from "../db.js";
import { normHouseId } from "../routes/device-positions.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = path.resolve(__dirname, "../../certs");

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtts://a2ybxz5mrpnfww-ats.iot.ap-northeast-2.amazonaws.com:8883";
const CLIENT_ID = process.env.MQTT_CLIENT_ID || `smartfarm-backend-${Date.now()}`;

// 구독 토픽 (100농장 표준화 Phase B: 옛 4-seg response 제거, farmId-prefix 만 유지)
const TOPICS = [
  "smartfarm/+/+/+/response",       // 제어 실행 응답 (smartfarm/{farmId}/{houseId}/{deviceId}/response)
  "smartfarm/+/relay/status",       // 릴레이 상태 업데이트
  "smartfarm/+/relay/response",     // 릴레이 조회 응답
  "smartfarm/+/sensor/status",      // 센서 상태 업데이트 (sensor:query 응답)
  "smartfarm/+/sync/status",        // 동기화 상태 (sync:query 응답)
  "smartfarm/+/system/status",      // 시스템 상태 (system:query 응답)
  "smartfarm/+/device/position",    // 장치 위치 (자동 정지 후)
];

class MqttService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.latestRelayStatus = {}; // { farmId: { houseId: { coils, timestamp } } }
    this.latestSensorStatus = {}; // { farmId: { unitId: { raw, registers, timestamp } } }
    this.latestSyncStatus = {}; // { farmId: { unsynced, synced, total, syncRunning, ... } }
    this.latestSystemStatus = {}; // { farmId: { nodeRed: {status, uptime, restarts}, rpiExpress: {...} } }
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
        } else if (topic.match(/smartfarm\/[^/]+\/sensor\/status/)) {
          // 센서 상태 업데이트 (sensor:query 응답)
          const farmId = parts[1];
          this._cacheSensorStatus(farmId, payload);
          this.emit("sensor:status", { farmId, data: payload, topic });
        } else if (topic.match(/smartfarm\/[^/]+\/sync\/status/)) {
          // 동기화 상태 업데이트 (sync:query 응답)
          const farmId = parts[1];
          this._cacheSyncStatus(farmId, payload);
          this.emit("sync:status", { farmId, data: payload, topic });
        } else if (topic.match(/smartfarm\/[^/]+\/system\/status/)) {
          // 시스템 상태 (system:query 응답)
          const farmId = parts[1];
          this._cacheSystemStatus(farmId, payload);
          this.emit("system:status", { farmId, data: payload, topic });
        } else if (topic.match(/smartfarm\/[^/]+\/device\/position/)) {
          // 장치 위치 업데이트 (자동 정지 후)
          const farmId = parts[1];
          this._saveDevicePosition(farmId, payload);
        } else if (topic.match(/^smartfarm\/[^/]+\/[^/]+\/[^/]+\/response$/)) {
          // 제어 실행 응답 (smartfarm/{farmId}/{houseId}/{deviceId}/response) — 100농장 표준화
          const farmId = parts[1];
          const houseId = parts[2];
          const deviceId = parts[3];
          this.emit("control:response", { farmId, houseId, deviceId, data: payload, topic });
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
      const { deviceId, position, command, startPosition, targetPosition, duration, startedAt } = payload;
      if (!deviceId || position === undefined) return;
      // 하위 호환: NR 이 houseId 를 아직 안 보내면 단일 하우스 기본값
      const houseId = normHouseId(payload.houseId);
      // open/close 시작 신호는 DB 저장 (startedAt + duration 포함) — frontend 진행률 복원 가능
      // stop 은 position 만 갱신 (기존)
      if (command === 'open' || command === 'close') {
        await pool.query(
          `INSERT INTO device_positions (farm_id, house_id, device_id, position, command, start_position, target_position, duration, started_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (farm_id, house_id, device_id) DO UPDATE
           SET position = $4, command = $5, start_position = $6, target_position = $7, duration = $8, started_at = $9, updated_at = NOW()`,
          [farmId, houseId, deviceId, position, command, startPosition ?? position, targetPosition ?? (command === 'open' ? 100 : 0), duration ?? 0, startedAt || null]
        );
        logger.info(`📍 장치 동작 시작: ${farmId}/${houseId}/${deviceId} ${command} (duration=${duration}s)`);
      } else {
        await pool.query(
          `INSERT INTO device_positions (farm_id, house_id, device_id, position, command, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (farm_id, house_id, device_id) DO UPDATE
           SET position = $4, command = $5, updated_at = NOW()`,
          [farmId, houseId, deviceId, position, command || 'stop']
        );
        logger.info(`📍 장치 위치 저장: ${farmId}/${houseId}/${deviceId} → ${position}%`);
      }

      // WebSocket broadcast → frontend ControlPanel 즉시 sync (자동화·외부 명령 결과)
      try {
        const { broadcastDevicePosition } = await import("./wsServer.js");
        broadcastDevicePosition(farmId, {
          houseId, deviceId, position, command: command || 'stop',
          startPosition, targetPosition, duration, startedAt,
        });
      } catch (e) { /* WS 발송 실패 무시 */ }
    } catch (e) {
      logger.error("장치 위치 저장 실패:", e.message);
    }
  }

  // 릴레이 상태 캐시 — 메모리 + DB persistence (양산 표준 sync 구조)
  _cacheRelayStatus(farmId, payload) {
    if (!this.latestRelayStatus[farmId]) {
      this.latestRelayStatus[farmId] = {};
    }
    const key = payload.houseId || payload.unitId || "default";
    this.latestRelayStatus[farmId][key] = {
      ...payload,
      receivedAt: new Date().toISOString(),
    };

    // DB UPSERT — frontend mount GET 시 즉시 복원 + backend 재시작 견고
    // unitId + coils 명시된 경우만 저장 (NR 응답 포맷 fan-out 방지)
    if (payload.unitId != null && payload.coils) {
      pool.query(
        `INSERT INTO relay_status (farm_id, unit_id, module_type, coils, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (farm_id, unit_id) DO UPDATE
         SET module_type = $3, coils = $4, updated_at = NOW()`,
        [farmId, payload.unitId, payload.moduleType || 'waveshare', JSON.stringify(payload.coils)]
      ).catch((e) => logger.warn(`relay_status UPSERT 실패: ${e.message}`));
    }
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

  // 센서 상태 캐시
  _cacheSensorStatus(farmId, payload) {
    if (!this.latestSensorStatus[farmId]) {
      this.latestSensorStatus[farmId] = {};
    }
    const key = String(payload.unitId || "default");
    this.latestSensorStatus[farmId][key] = {
      ...payload,
      receivedAt: new Date().toISOString(),
    };
  }

  // 센서 조회 요청 발행 (Waveshare relay/query 와 동일 패턴)
  publishSensorQuery(farmId) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — 센서 조회 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/sensor/query`;
    const payload = JSON.stringify({
      action: "query",
      farmId,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 });
    logger.info(`📤 MQTT 센서 조회 요청: ${topic}`);
    return true;
  }

  // 릴레이 전체 OFF 요청 발행
  // RPi 가 global.relayModules 순회하며 모든 모듈 OFF (모듈 추가/unit-id 변경에도 자동 동작)
  publishRelayReset(farmId, operator = "unknown") {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — 릴레이 reset 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/relay/reset`;
    const payload = JSON.stringify({
      action: "reset-all",
      farmId,
      operator,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 });
    logger.info(`📤 MQTT 릴레이 reset 요청: ${topic} (by ${operator})`);
    return true;
  }

  // 동기화 상태 캐시
  _cacheSyncStatus(farmId, payload) {
    this.latestSyncStatus[farmId] = {
      ...payload,
      receivedAt: new Date().toISOString(),
    };
  }

  // 동기화 상태 조회 요청 발행 (Category A: RPi 양방향 query)
  publishSyncQuery(farmId) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — sync 조회 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/sync/query`;
    const payload = JSON.stringify({
      action: "query",
      farmId,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 });
    logger.info(`📤 MQTT sync 조회 요청: ${topic}`);
    return true;
  }

  // 동기화 명령 발행 — start/stop/skip (Category B: RPi 단방향 command)
  publishSyncCommand(farmId, action, operator = "unknown") {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — sync 명령 불가");
      return false;
    }
    if (!["start", "stop", "skip"].includes(action)) {
      logger.warn(`잘못된 sync action: ${action}`);
      return false;
    }
    const topic = `smartfarm/${farmId}/sync/command`;
    const payload = JSON.stringify({
      action,
      farmId,
      operator,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 });
    logger.info(`📤 MQTT sync 명령: ${topic} action=${action} (by ${operator})`);
    return true;
  }

  // 시스템 상태 캐시
  _cacheSystemStatus(farmId, payload) {
    this.latestSystemStatus[farmId] = {
      ...payload,
      receivedAt: new Date().toISOString(),
    };
  }

  // 시스템 상태 조회 요청 발행 (Category A: RPi 양방향 query)
  publishSystemQuery(farmId) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — system 조회 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/system/query`;
    const payload = JSON.stringify({
      action: "query",
      farmId,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, payload, { qos: 1 });
    logger.info(`📤 MQTT system 조회 요청: ${topic}`);
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

  // 양액 직접 제어 — channel 단위 raw ON/OFF (direct mode)
  // RPi NR mqtt-in 노드가 받아서 Modbus FC5 (single coil write) 발사
  // autoOffSec: 0 = 자동 OFF 없음, >0 = N초 후 자동 OFF
  publishNutrientDirectRelay(farmId, channel, on, autoOffSec = 0) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — direct-relay publish 불가");
      return false;
    }
    const topic = `smartfarm/${farmId}/nutrient/direct-relay`;
    const message = JSON.stringify({
      farmId, channel, on, autoOffSec,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, message, { qos: 1 });
    logger.info(`📤 MQTT direct-relay 발행: ${topic} CH${channel}=${on ? "ON" : "OFF"} autoOff=${autoOffSec}s`);
    return true;
  }

  // 양액 수동 작업 즉시 trigger — RPi NR 가 polling 대기 안 하고 즉시 dispatch
  // payload 는 hint 만 (jobId). RPi 는 received 시 standard pending fetch 시작.
  publishNutrientManualTrigger(farmId, jobId) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT 미연결 — manual-trigger publish 불가 (60s polling fallback)");
      return false;
    }
    const topic = `smartfarm/${farmId}/nutrient/manual-trigger`;
    const message = JSON.stringify({
      farmId, jobId,
      timestamp: new Date().toISOString(),
    });
    this.client.publish(topic, message, { qos: 1 });
    logger.info(`📤 MQTT manual-trigger 발행: ${topic} job=${jobId.slice(0, 8)}`);
    return true;
  }

  // 캐시된 릴레이 상태 조회
  getRelayStatus(farmId) {
    return this.latestRelayStatus[farmId] || null;
  }

  // 캐시된 센서 상태 조회
  getSensorStatus(farmId) {
    return this.latestSensorStatus[farmId] || null;
  }

  // 캐시된 동기화 상태 조회
  getSyncStatus(farmId) {
    return this.latestSyncStatus[farmId] || null;
  }

  // 캐시된 시스템 상태 조회
  getSystemStatus(farmId) {
    return this.latestSystemStatus[farmId] || null;
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
