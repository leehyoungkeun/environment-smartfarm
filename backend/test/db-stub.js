// src/db.js 의 테스트용 스텁.
//
// 단위 테스트는 DB 결과가 필요 없다. 조회는 "없음" 을 돌려주고, 운영 코드의 폴백 경로가
// 그대로 동작하는지 본다. (예: enforceTenant 는 userFarm 조회가 실패/없음이면 403 을 낸다)
//
// 어떤 호출이 오갔는지 확인해야 하는 테스트는 __calls 를 읽으면 된다.

export const __calls = [];

function record(name, args) {
  __calls.push({ name, args });
}

const model = (name) => ({
  async findUnique(args) { record(`${name}.findUnique`, args); return null; },
  async findFirst(args) { record(`${name}.findFirst`, args); return null; },
  async findMany(args) { record(`${name}.findMany`, args); return []; },
  async create(args) { record(`${name}.create`, args); return { id: "stub" }; },
  async update(args) { record(`${name}.update`, args); return { id: "stub" }; },
  async upsert(args) { record(`${name}.upsert`, args); return { id: "stub" }; },
  async delete(args) { record(`${name}.delete`, args); return { id: "stub" }; },
  async count(args) { record(`${name}.count`, args); return 0; },
});

export const prisma = new Proxy(
  {
    async $queryRaw() { record("$queryRaw", null); return []; },
    async $disconnect() { return; },
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== "string" || prop.startsWith("$")) return undefined;
      return model(prop);
    },
  }
);

export const pool = {
  async query(text, params) {
    record("pool.query", { text: String(text).slice(0, 80), params });
    return { rows: [], rowCount: 0 };
  },
  async end() { return; },
};

export async function remoteQuery() { return { rows: [] }; }
export async function connectDB() { return; }
export async function disconnectDB() { return; }
export async function checkDBHealth() { return { connected: false, stub: true }; }

export default prisma;
