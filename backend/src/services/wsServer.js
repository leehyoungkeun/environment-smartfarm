// src/services/wsServer.js
// WebSocket 서버 — MQTT ↔ 프론트엔드 브릿지

import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";
import logger from "../utils/logger.js";
import mqttService from "./mqttClient.js";

const JWT_SECRET = process.env.JWT_SECRET;
const SYSTEM_WIDE_ROLES = ["superadmin", "manager"];

let wss = null;

export function initWebSocketServer(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  logger.info("🔌 WebSocket 서버 시작 (경로: /ws)");

  wss.on("connection", (ws, req) => {
    // JWT 인증
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      ws.send(JSON.stringify({ type: "error", message: "인증 토큰 필요" }));
      ws.close(4001, "Unauthorized");
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      ws.userId = decoded.id;
      ws.username = decoded.username;
      ws.role = decoded.role;
      ws.farmId = decoded.farmId;
      ws.isSystemWide = SYSTEM_WIDE_ROLES.includes(decoded.role);
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: "토큰 만료 또는 유효하지 않음" }));
      ws.close(4001, "Invalid token");
      return;
    }

    logger.info(`🌐 WS 연결: ${ws.username} (farmId: ${ws.farmId}, role: ${ws.role})`);

    // 연결 확인 메시지
    ws.send(JSON.stringify({
      type: "connected",
      mqtt: mqttService.isConnected(),
      user: ws.username,
    }));

    // 클라이언트 메시지 처리
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", message: "잘못된 메시지 형식" }));
      }
    });

    ws.on("close", () => {
      logger.info(`🔌 WS 연결 종료: ${ws.username}`);
    });

    // 30초 ping/pong 헬스체크
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
  });

  // 30초마다 죽은 연결 정리
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(pingInterval));

  // MQTT → WebSocket 브릿지
  setupMqttBridge();

  return wss;
}

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;

    case "relay:query": {
      // 릴레이 상태 조회 요청 → MQTT 발행
      const farmId = msg.farmId || ws.farmId;
      if (!ws.isSystemWide && farmId !== ws.farmId) {
        ws.send(JSON.stringify({ type: "error", message: "권한 없음" }));
        return;
      }
      const sent = mqttService.publishRelayQuery(farmId);
      ws.send(JSON.stringify({
        type: "relay:query:ack",
        farmId,
        sent,
        mqtt: mqttService.isConnected(),
      }));
      // 캐시된 상태도 즉시 전달
      const cached = mqttService.getRelayStatus(farmId);
      if (cached) {
        ws.send(JSON.stringify({ type: "relay:status", farmId, data: cached, cached: true }));
      }
      break;
    }

    case "system:command": {
      // 시스템 명령 → MQTT로 RPi에 전달
      const farmId = msg.farmId || ws.farmId;
      if (!ws.isSystemWide && farmId !== ws.farmId) {
        ws.send(JSON.stringify({ type: "error", message: "권한 없음" }));
        return;
      }
      if (mqttService.isConnected()) {
        const topic = `smartfarm/${farmId}/system/command`;
        mqttService.client.publish(topic, JSON.stringify({
          action: msg.action, // 'restart-nodered', 'restart-rpi-express'
          farmId,
          operator: ws.username,
          timestamp: new Date().toISOString(),
        }), { qos: 1 });
        logger.info(`📤 MQTT 시스템 명령: ${topic} → ${msg.action}`);
        ws.send(JSON.stringify({ type: "system:command:ack", action: msg.action, sent: true }));
      } else {
        ws.send(JSON.stringify({ type: "system:command:ack", action: msg.action, sent: false, error: "MQTT 미연결" }));
      }
      break;
    }

    case "subscribe": {
      // 특정 farmId 구독 (superadmin이 다른 농장 볼 때)
      if (ws.isSystemWide && msg.farmId) {
        ws.subscribedFarmId = msg.farmId;
        ws.send(JSON.stringify({ type: "subscribed", farmId: msg.farmId }));
      }
      break;
    }

    default:
      ws.send(JSON.stringify({ type: "error", message: `알 수 없는 메시지 타입: ${msg.type}` }));
  }
}

function setupMqttBridge() {
  // 릴레이 상태 → 해당 농장 WebSocket 클라이언트로 전달
  mqttService.on("relay:status", ({ farmId, data }) => {
    broadcast(farmId, { type: "relay:status", farmId, data });
  });

  // 릴레이 조회 응답 → 해당 농장 WebSocket 클라이언트로 전달
  mqttService.on("relay:response", ({ farmId, data }) => {
    broadcast(farmId, { type: "relay:response", farmId, data });
  });

  // 제어 실행 응답 → 해당 하우스의 농장 WebSocket 클라이언트로 전달
  mqttService.on("control:response", ({ houseId, deviceId, data }) => {
    // houseId로 farmId 매핑 (MQTT 토픽에서 farmId를 직접 알 수 없는 경우)
    // 모든 클라이언트에게 전달하고 프론트에서 필터링
    broadcastAll({ type: "control:response", houseId, deviceId, data });
  });
}

function broadcast(farmId, message) {
  if (!wss) return;
  const json = JSON.stringify(message);
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return; // OPEN
    const targetFarm = ws.subscribedFarmId || ws.farmId;
    if (ws.isSystemWide || targetFarm === farmId) {
      ws.send(json);
    }
  });
}

function broadcastAll(message) {
  if (!wss) return;
  const json = JSON.stringify(message);
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(json);
  });
}

export function getWss() {
  return wss;
}

export function getConnectedClients() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((ws) => { if (ws.readyState === 1) count++; });
  return count;
}
