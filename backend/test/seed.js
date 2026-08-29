// 테스트 계정 심기 — 스텁이든 실제 테스트 DB 든 같은 방식으로 쓴다.
//
// 통합 테스트는 평소 스텁 위에서 돈다(배포 게이트는 DB 없이 돌아야 하므로).
// 테스트 전용 Postgres 가 있으면 setup.js 가 스텁을 끄므로, 그때는 진짜 행을 넣어야 한다.
// 두 경우를 호출부가 신경 쓰지 않도록 여기서 흡수한다.

const TEST_DB = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):5433\//.test(process.env.DATABASE_URL || "");
export const usingRealDb = TEST_DB;

/** 테스트가 쓸 농장 + 사용자를 심는다. 반환값은 정리 함수. */
export async function seedUsers(users, farms = []) {
  if (!TEST_DB) {
    const { __seed } = await import("./db-stub.js");
    for (const f of farms) __seed.farm.set(f.farmId, { id: f.farmId, ...f });
    for (const u of users) __seed.user.set(u.id, { enabled: true, ...u });
    return async () => {};
  }

  const { prisma } = await import("../src/db.js");
  for (const f of farms) {
    await prisma.farm.upsert({
      where: { farmId: f.farmId },
      update: { status: f.status || "active" },
      create: {
        id: f.farmId,
        farmId: f.farmId,
        name: f.name || f.farmId,
        status: f.status || "active",
        apiKey: `test-key-${f.farmId}`,
      },
    });
  }
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { role: u.role, farmId: u.farmId || "farm_0001", enabled: true },
      create: {
        id: u.id,
        username: u.username,
        password: "!test-only-not-a-hash",
        name: u.username,
        role: u.role,
        farmId: u.farmId || "farm_0001",
        enabled: true,
      },
    });
  }
  return async () => {
    for (const u of users) await prisma.user.deleteMany({ where: { username: u.username } }).catch(() => {});
    for (const f of farms) await prisma.farm.deleteMany({ where: { farmId: f.farmId } }).catch(() => {});
  };
}
