// src/models/Config.js
// 하우스 설정 모델 - PostgreSQL (Prisma) 버전
// API 응답 형태는 MongoDB 버전과 동일하게 유지

import { prisma } from "../db.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 응답 포맷 (MongoDB _id 호환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatConfig(config) {
  if (!config) return null;
  const { id, ...rest } = config;
  return {
    _id: id,
    ...rest,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Config 모델 (Mongoose API 호환 래퍼)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const Config = {
  /**
   * create - Mongoose 호환
   */
  async create(data) {
    const config = await prisma.houseConfig.create({
      data: {
        farmId: data.farmId,
        houseId: data.houseId,
        houseName: data.houseName || "",
        sensors: data.sensors || [],
        collection: data.collection || {},
        devices: data.devices || [],
        deviceCount: data.deviceCount || 0,
        enabled: data.enabled !== undefined ? data.enabled : true,
        configVersion: data.configVersion || 1,
      },
    });
    return formatConfig(config);
  },

  /**
   * find - Mongoose 호환
   */
  async find(query = {}) {
    const where = buildWhere(query);
    const configs = await prisma.houseConfig.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return configs.map(formatConfig);
  },

  /**
   * findOne - Mongoose 호환
   */
  async findOne(query) {
    const where = buildWhere(query);
    const config = await prisma.houseConfig.findFirst({ where });
    return config ? formatConfig(config) : null;
  },

  /**
   * findOneAndUpdate - Mongoose 호환
   */
  async findOneAndUpdate(query, updateData, options = {}) {
    const where = buildWhere(query);

    // upsert 지원
    if (options.upsert) {
      const existing = await prisma.houseConfig.findFirst({ where });
      if (existing) {
        const updated = await prisma.houseConfig.update({
          where: { id: existing.id },
          data: buildUpdateData(updateData),
        });
        return formatConfig(updated);
      } else {
        // create
        const created = await prisma.houseConfig.create({
          data: {
            farmId: query.farmId || updateData.farmId,
            houseId: query.houseId || updateData.houseId,
            ...buildUpdateData(updateData),
          },
        });
        return formatConfig(created);
      }
    }

    const existing = await prisma.houseConfig.findFirst({ where });
    if (!existing) return null;

    const updated = await prisma.houseConfig.update({
      where: { id: existing.id },
      data: buildUpdateData(updateData),
    });
    return formatConfig(updated);
  },

  /**
   * deleteOne - Mongoose 호환
   */
  async deleteOne(query) {
    const where = buildWhere(query);
    const existing = await prisma.houseConfig.findFirst({ where });
    if (!existing) return { deletedCount: 0 };

    await prisma.houseConfig.delete({ where: { id: existing.id } });
    return { deletedCount: 1 };
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildWhere(query) {
  const where = {};
  if (query.farmId) where.farmId = query.farmId;
  if (query.houseId) where.houseId = query.houseId;
  if (query.enabled !== undefined) where.enabled = query.enabled;
  return where;
}

function buildUpdateData(data) {
  const update = {};
  if (data.houseName !== undefined) update.houseName = data.houseName;
  if (data.sensors !== undefined) update.sensors = data.sensors;
  if (data.collection !== undefined) update.collection = data.collection;
  if (data.devices !== undefined) update.devices = data.devices;
  if (data.deviceCount !== undefined) update.deviceCount = data.deviceCount;
  if (data.enabled !== undefined) update.enabled = data.enabled;
  if (data.configVersion !== undefined)
    update.configVersion = data.configVersion;
  return update;
}

export default Config;
