// src/services/wsService.js
// WebSocket 클라이언트 — 백엔드 MQTT 브릿지 실시간 연결

const WS_RECONNECT_BASE = 2000;
const WS_RECONNECT_MAX = 30000;
const WS_PING_INTERVAL = 25000;

class WsService {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.listeners = {}; // { eventType: [callback, ...] }
    this.reconnectTimer = null;
    this.reconnectDelay = WS_RECONNECT_BASE;
    this.pingTimer = null;
    this.url = null;
    this.intentionalClose = false;
  }

  // WebSocket 연결
  connect(baseUrl, token) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.intentionalClose = false;

    // HTTP → WS 프로토콜 변환
    const wsUrl = baseUrl
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://")
      .replace(/\/api$/, ""); // /api 제거

    this.url = `${wsUrl}/ws?token=${encodeURIComponent(token)}`;

    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      console.warn("[WS] 연결 생성 실패:", e.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = WS_RECONNECT_BASE;
      console.log("[WS] 연결됨");
      this._emit("connection", { connected: true });
      this._startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._emit(msg.type, msg);
      } catch (e) {
        console.warn("[WS] 메시지 파싱 실패:", e.message);
      }
    };

    this.ws.onclose = (event) => {
      this.connected = false;
      this._stopPing();
      this._emit("connection", { connected: false, code: event.code });

      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.warn("[WS] 에러 발생");
    };
  }

  // 연결 종료
  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  // 메시지 전송
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // 릴레이 조회 요청
  requestRelayStatus(farmId) {
    return this.send({ type: "relay:query", farmId });
  }

  // 센서 조회 요청 (Waveshare relay/query 와 동일 패턴)
  requestSensorStatus(farmId) {
    return this.send({ type: "sensor:query", farmId });
  }

  // 이벤트 구독
  subscribe(eventType, callback) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);

    // 구독 해제 함수 반환
    return () => {
      this.listeners[eventType] = this.listeners[eventType].filter((cb) => cb !== callback);
    };
  }

  // 연결 상태
  isConnected() {
    return this.connected;
  }

  // 내부: 이벤트 발행
  _emit(type, data) {
    const callbacks = this.listeners[type] || [];
    callbacks.forEach((cb) => {
      try { cb(data); } catch (e) { console.error("[WS] 리스너 에러:", e); }
    });

    // 와일드카드 리스너 (*) 호출
    const wildcard = this.listeners["*"] || [];
    wildcard.forEach((cb) => {
      try { cb({ type, ...data }); } catch (e) { /* ignore */ }
    });
  }

  // 내부: 재연결 스케줄
  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    console.log(`[WS] ${this.reconnectDelay / 1000}초 후 재연결...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.url) {
        // 토큰 갱신이 필요할 수 있으므로 저장된 URL로 재연결
        try {
          this.ws = new WebSocket(this.url);
          this._setupHandlers();
        } catch (e) {
          this._scheduleReconnect();
        }
      }
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, WS_RECONNECT_MAX);
  }

  _setupHandlers() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = WS_RECONNECT_BASE;
      console.log("[WS] 재연결 성공");
      this._emit("connection", { connected: true });
      this._startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._emit(msg.type, msg);
      } catch (e) { /* ignore */ }
    };

    this.ws.onclose = (event) => {
      this.connected = false;
      this._stopPing();
      this._emit("connection", { connected: false, code: event.code });
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = () => {};
  }

  // 내부: 핑 유지
  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, WS_PING_INTERVAL);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

// 싱글톤
const wsService = new WsService();
export default wsService;
