// src/models/User.js
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";

function formatUser(user) {
  if (!user) return null;
  const { id, password, refreshToken, ...rest } = user;
  return { _id: id, ...rest };
}

const User = {
  async create(data) {
    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        name: data.name,
        role: data.role || "worker",
        farmId: data.farmId || "farm_001",
        allowedHouses: data.allowedHouses || [],
        enabled: data.enabled !== undefined ? data.enabled : true,
      },
    });
    return new UserDocument(user);
  },

  async findOne(query) {
    const where = buildWhere(query);
    const user = await prisma.user.findFirst({ where });
    return user ? new UserDocument(user) : null;
  },

  async findById(id) {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      return user ? new UserDocument(user) : null;
    } catch { return null; }
  },

  async find(query = {}) {
    const where = buildWhere(query);
    const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" } });
    return users.map((u) => new UserDocument(u));
  },

  async countDocuments(query = {}) {
    const where = buildWhere(query);
    return prisma.user.count({ where });
  },

  async findByIdAndDelete(id) {
    try {
      const user = await prisma.user.delete({ where: { id } });
      return new UserDocument(user);
    } catch { return null; }
  },
};

class UserDocument {
  constructor(data) {
    this._storedPassword = data.password;
    this._passwordChanged = false;
    this._newPassword = null;
    this._raw = { ...data };
    this.id = data.id;
    this._id = data.id;
    this.username = data.username;
    this.name = data.name;
    this.role = data.role;
    this.farmId = data.farmId;
    this.allowedHouses = data.allowedHouses;
    this.enabled = data.enabled;
    this.lastLoginAt = data.lastLoginAt;
    this.refreshToken = data.refreshToken;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  async comparePassword(candidatePassword) {
    let pwd = this._storedPassword;
    if (!pwd) {
      const full = await prisma.user.findUnique({ where: { id: this.id }, select: { password: true } });
      pwd = full?.password;
    }
    if (!pwd) return false;
    return bcrypt.compare(candidatePassword, pwd);
  }

  async save() {
    const data = {};
    if (this._passwordChanged && this._newPassword) {
      data.password = await bcrypt.hash(this._newPassword, 12);
    }
    data.name = this.name;
    data.role = this.role;
    data.farmId = this.farmId;
    data.allowedHouses = this.allowedHouses || [];
    data.enabled = this.enabled;
    if (this.lastLoginAt) data.lastLoginAt = this.lastLoginAt;
    data.refreshToken = this.refreshToken;

    const updated = await prisma.user.update({ where: { id: this.id }, data });

    this._storedPassword = updated.password;
    this._raw = { ...updated };
    this._passwordChanged = false;
    this._newPassword = null;
    this.id = updated.id;
    this._id = updated.id;
    this.username = updated.username;
    this.name = updated.name;
    this.role = updated.role;
    this.farmId = updated.farmId;
    this.allowedHouses = updated.allowedHouses;
    this.enabled = updated.enabled;
    this.lastLoginAt = updated.lastLoginAt;
    this.refreshToken = updated.refreshToken;
    this.createdAt = updated.createdAt;
    this.updatedAt = updated.updatedAt;
    return this;
  }

  set password(value) {
    if (!value) return;
    if (value.startsWith('$2a$') || value.startsWith('$2b$')) {
      this._storedPassword = value;
      return;
    }
    this._newPassword = value;
    this._passwordChanged = true;
  }

  get password() {
    return this._storedPassword;
  }

  toJSON() {
    return formatUser(this._raw);
  }

  hasPermission(action) {
    const permissions = {
      admin: ["dashboard", "control", "automation", "history", "journal", "ai", "settings", "users"],
      worker: ["dashboard", "control", "automation", "history", "journal", "ai"],
    };
    return (permissions[this.role] || []).includes(action);
  }
}

function buildWhere(query) {
  const where = {};
  if (query.username) where.username = query.username;
  if (query.farmId) where.farmId = query.farmId;
  if (query.role) where.role = query.role;
  if (query.enabled !== undefined) where.enabled = query.enabled;
  return where;
}

User.findOne = new Proxy(User.findOne, {
  apply(target, thisArg, args) {
    const result = target.apply(thisArg, args);
    result.select = function (fields) {
      if (fields && fields.includes("+password")) {
        return this.then(async (user) => {
          if (!user) return null;
          const full = await prisma.user.findUnique({ where: { id: user.id } });
          return full ? new UserDocument(full) : null;
        });
      }
      return this;
    };
    return result;
  },
});

User.findById = (function (originalFn) {
  return function (id) {
    const promise = originalFn(id);
    const chainable = promise.then((v) => v);
    chainable.select = function () { return this; };
    return chainable;
  };
})(User.findById.bind(User));

export default User;
export { UserDocument, formatUser };