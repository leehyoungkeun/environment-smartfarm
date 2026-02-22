// src/models/AutomationRule.js
// 자동화 규칙 모델 - PostgreSQL (Prisma) 버전
// API 응답 형태는 MongoDB 버전과 동일하게 유지

import { prisma } from "../db.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 응답 포맷 (MongoDB _id 호환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatRule(rule) {
  if (!rule) return null;
  const { id, ...rest } = rule;
  return {
    _id: id,
    ...rest,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutomationRule 모델 (Mongoose API 호환 래퍼)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const AutomationRule = {
  /**
   * 규칙 생성
   */
  async create(data) {
    const createData = {
      farmId: data.farmId,
      houseId: data.houseId,
      name: data.name,
      description: data.description || "",
      enabled: data.enabled !== undefined ? data.enabled : true,
      conditionLogic: data.conditionLogic || "AND",
      conditions: data.conditions || [],
      actions: data.actions || [],
      cooldownSeconds: data.cooldownSeconds || 300,
      priority: data.priority || 10,
    };
    if (data.id) createData.id = data.id;
    if (data.lastTriggeredAt) createData.lastTriggeredAt = new Date(data.lastTriggeredAt);
    if (data.triggerCount !== undefined) createData.triggerCount = data.triggerCount;
    const rule = await prisma.automationRule.create({ data: createData });
    return new RuleDocument(rule);
  },

  /**
   * find - Mongoose 호환 (sort 체이닝 지원)
   */
  find(query = {}) {
    const where = buildWhere(query);
    // 체이닝을 위한 QueryBuilder 반환
    return new QueryBuilder(where);
  },

  /**
   * findById
   */
  async findById(id) {
    try {
      const rule = await prisma.automationRule.findUnique({ where: { id } });
      return rule ? new RuleDocument(rule) : null;
    } catch {
      return null;
    }
  },

  /**
   * findByIdAndUpdate - Mongoose 호환
   */
  async findByIdAndUpdate(id, data, options = {}) {
    try {
      const updateData = buildUpdateData(data);
      const rule = await prisma.automationRule.update({
        where: { id },
        data: updateData,
      });
      return new RuleDocument(rule);
    } catch {
      return null;
    }
  },

  /**
   * findByIdAndDelete - Mongoose 호환
   */
  async findByIdAndDelete(id) {
    try {
      const rule = await prisma.automationRule.delete({ where: { id } });
      return new RuleDocument(rule);
    } catch {
      return null;
    }
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QueryBuilder - Mongoose 체이닝 호환
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class QueryBuilder {
  constructor(where) {
    this._where = where;
    this._orderBy = { createdAt: "desc" };
    this._lean = false;
  }

  sort(sortObj) {
    if (sortObj) {
      this._orderBy = {};
      for (const [key, val] of Object.entries(sortObj)) {
        this._orderBy[key] = val === 1 || val === "asc" ? "asc" : "desc";
      }
    }
    return this;
  }

  lean() {
    this._lean = true;
    return this;
  }

  async then(resolve, reject) {
    try {
      const rules = await prisma.automationRule.findMany({
        where: this._where,
        orderBy: Object.entries(this._orderBy).map(([k, v]) => ({ [k]: v })),
      });

      const result = this._lean
        ? rules.map(formatRule)
        : rules.map((r) => new RuleDocument(r));

      resolve(result);
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }

  // async iteration 지원
  [Symbol.asyncIterator]() {
    return this.then((results) => results[Symbol.iterator]());
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RuleDocument - Mongoose Document 호환 래퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class RuleDocument {
  constructor(data) {
    Object.assign(this, data);
    this._id = data.id;
    this._raw = data;
  }

  async save() {
    const updated = await prisma.automationRule.update({
      where: { id: this.id },
      data: {
        farmId: this.farmId,
        houseId: this.houseId,
        name: this.name,
        description: this.description,
        enabled: this.enabled,
        conditionLogic: this.conditionLogic,
        conditions: this.conditions,
        actions: this.actions,
        cooldownSeconds: this.cooldownSeconds,
        lastTriggeredAt: this.lastTriggeredAt,
        triggerCount: this.triggerCount,
        priority: this.priority,
      },
    });
    Object.assign(this, updated);
    this._id = updated.id;
    this._raw = updated;
    return this;
  }

  toJSON() {
    return formatRule(this._raw);
  }
}

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
  const fields = [
    "name",
    "description",
    "enabled",
    "conditionLogic",
    "conditions",
    "actions",
    "cooldownSeconds",
    "lastTriggeredAt",
    "triggerCount",
    "priority",
    "houseId",
    "farmId",
  ];
  for (const f of fields) {
    if (data[f] !== undefined) update[f] = data[f];
  }
  return update;
}

export default AutomationRule;
