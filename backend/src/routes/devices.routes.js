// src/routes/devices.routes.js
// 장비 관리 API — 장비 코드 발급, 조회, 초기 설정, heartbeat

import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import logger from "../utils/logger.js";
import { authenticate, authorize } from "../middleware/auth.middleware.js";

const router = Router();

// 6자리 장비 코드 생성 (영대문자 + 숫자)
function generateDeviceCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 혼동 문자 제외 (0/O, 1/I)
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

// =========================================
// 장비 코드 발급 (관리자)
// POST /api/devices
// body: { count?, farmId?, memo? }
// =========================================
router.post("/", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { count = 1, farmId, memo } = req.body;
    const devices = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      // 중복 방지: 최대 10회 재시도
      let code;
      for (let retry = 0; retry < 10; retry++) {
        code = generateDeviceCode();
        const exists = await prisma.device.findUnique({ where: { deviceCode: code } });
        if (!exists) break;
        code = null;
      }
      if (!code) continue;

      const device = await prisma.device.create({
        data: {
          deviceCode: code,
          farmId: farmId || null,
          status: farmId ? "pending" : "pending",
          mqttClientId: `MyFarmPi_${code}`,
          memo: memo || null,
          installedAt: farmId ? new Date() : null,
        },
      });
      devices.push(device);
    }

    logger.info(`📦 장비 코드 ${devices.length}개 발급`);
    res.status(201).json({ success: true, data: devices });
  } catch (error) {
    logger.error("장비 코드 발급 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 장비 목록 조회
// GET /api/devices
// query: status?, farmId?
// =========================================
router.get("/", authenticate, async (req, res) => {
  try {
    const { status, farmId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (farmId) where.farmId = farmId;

    const devices = await prisma.device.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // 목록에서는 인증서 원본 제외, 존재 여부만 반환
    const safeDevices = devices.map(d => ({
      ...d,
      certPem: d.certPem ? true : null,
      privateKey: undefined,
    }));

    res.json({ success: true, data: safeDevices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 장비 상세 조회
// GET /api/devices/:code
// =========================================
router.get("/:code", async (req, res) => {
  try {
    const device = await prisma.device.findUnique({
      where: { deviceCode: req.params.code },
    });
    if (!device) {
      return res.status(404).json({ success: false, error: "장비를 찾을 수 없습니다" });
    }
    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 장비 수정 (농장 배정, 메모 등)
// PUT /api/devices/:code
// =========================================
router.put("/:code", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { farmId, memo, status } = req.body;
    const update = { updatedAt: new Date() };
    if (farmId !== undefined) {
      update.farmId = farmId || null;
      if (farmId) update.installedAt = new Date();
    }
    if (memo !== undefined) update.memo = memo;
    if (status) update.status = status;

    const device = await prisma.device.update({
      where: { deviceCode: req.params.code },
      data: update,
    });

    logger.info(`🔧 장비 수정: ${req.params.code} → farmId=${farmId}`);
    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 인증서 업로드 (관리자)
// PUT /api/devices/:code/certificates
// body: { certPem, privateKey, awsThingName? }
// certPem, privateKey: base64 인코딩된 PEM 파일 내용
// =========================================
router.put("/:code/certificates", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { certPem, privateKey, awsThingName } = req.body;
    if (!certPem || !privateKey) {
      return res.status(400).json({ success: false, error: "certPem, privateKey 필수" });
    }

    const device = await prisma.device.update({
      where: { deviceCode: req.params.code },
      data: {
        certPem,
        privateKey,
        awsThingName: awsThingName || null,
        updatedAt: new Date(),
      },
    });

    logger.info(`🔐 인증서 등록: ${req.params.code} (thing: ${awsThingName || '-'})`);
    res.json({ success: true, data: { deviceCode: device.deviceCode, awsThingName: device.awsThingName } });
  } catch (error) {
    logger.error("인증서 등록 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// RPi 초기 설정 요청 (장비 코드로 농장 정보 조회)
// POST /api/devices/:code/setup
// 인증 불필요 (RPi가 처음 부팅 시 호출)
// =========================================
router.post("/:code/setup", async (req, res) => {
  try {
    const device = await prisma.device.findUnique({
      where: { deviceCode: req.params.code },
    });
    if (!device) {
      return res.status(404).json({ success: false, error: "유효하지 않은 장비 코드입니다" });
    }

    // setup 1회성 (2026-08-29 N2): 장비코드(화면 평문 6자)만으로 농장 키·인증서를 인터넷에서
    // 꺼낼 수 있었다. 최초 1회(installedAt 없을 때)만 비밀을 내려주고 그 뒤엔 상태만 반환.
    // ⚠ 이 선언은 farmInfo 보다 앞에 있어야 한다 — 뒤에 두면 TDZ 로 setup 전체가 500 이 난다
    //   (2026-08-30 사업화 정밀테스트에서 발견: 신규 장비 설치까지 막혀 있었다).
    const firstSetup = !device.installedAt;
    if (!firstSetup) logger.warn(`장비 재-setup 시도 (이미 설치됨): ${req.params.code} from ${req.ip}`);

    // 농장 정보 조회
    let farmInfo = null;
    if (device.farmId) {
      const farm = await prisma.farm.findFirst({
        where: { farmId: device.farmId },
      });
      if (farm) {
        farmInfo = {
          farmId: farm.farmId,
          farmName: farm.name,
          apiKey: firstSetup ? farm.apiKey : undefined, // 최초 설치 때만 (N2)
        };
      }
    }

    // RPi 정보 업데이트
    const { rpiSerial, ipAddress } = req.body;
    await prisma.device.update({
      where: { deviceCode: req.params.code },
      data: {
        status: device.farmId ? "online" : "pending",
        rpiSerial: rpiSerial || device.rpiSerial,
        ipAddress: ipAddress || req.ip,
        lastSeenAt: new Date(),
        installedAt: device.installedAt || new Date(),
        updatedAt: new Date(),
      },
    });

    logger.info(`🔧 장비 설정 요청: ${req.params.code} → ${device.farmId || '미배정'}`);

    res.json({
      success: true,
      data: {
        deviceCode: device.deviceCode,
        mqttClientId: device.mqttClientId,
        farmId: device.farmId,
        farm: farmInfo,
        serverUrl: "https://api.smartgreen.kr",
        mqttBroker: "a2ybxz5mrpnfww-ats.iot.ap-northeast-2.amazonaws.com",
        // AWS IoT 인증서 (base64)
        certificates: (firstSetup && device.certPem) ? { // 최초 설치 때만 (N2)
        certPem: device.certPem,
        privateKey: device.privateKey,
        } : null,
      },
    });
  } catch (error) {
    logger.error("장비 설정 요청 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// Heartbeat (RPi → 서버, 5분마다)
// POST /api/devices/:code/heartbeat
// 인증: API Key 또는 장비 코드
// =========================================
router.post("/:code/heartbeat", async (req, res) => {
  try {
    const { status, uptime, memory, cpu, disk, firmwareVersion, ipAddress } = req.body;

    const device = await prisma.device.findUnique({
      where: { deviceCode: req.params.code },
    });
    if (!device) {
      return res.status(404).json({ success: false, error: "장비를 찾을 수 없습니다" });
    }

    await prisma.device.update({
      where: { deviceCode: req.params.code },
      data: {
        status: "online",
        lastSeenAt: new Date(),
        uptime: uptime || null,
        cpuUsage: cpu || null,
        memoryUsed: memory?.used || null,
        memoryTotal: memory?.total || null,
        diskUsage: disk || null,
        firmwareVersion: firmwareVersion || device.firmwareVersion,
        ipAddress: ipAddress || req.ip,
        updatedAt: new Date(),
      },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 장비 삭제
// DELETE /api/devices/:code
// =========================================
router.delete("/:code", authenticate, authorize("owner"), async (req, res) => {
  try {
    await prisma.device.delete({
      where: { deviceCode: req.params.code },
    });
    logger.info(`🗑️ 장비 삭제: ${req.params.code}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 통계
// GET /api/devices/stats/summary
// =========================================
router.get("/stats/summary", authenticate, async (req, res) => {
  try {
    const [total, online, offline, pending] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: "online" } }),
      prisma.device.count({ where: { status: "offline" } }),
      prisma.device.count({ where: { status: "pending" } }),
    ]);
    res.json({ success: true, data: { total, online, offline, pending } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
