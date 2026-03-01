// prisma/seed-farm.js
// 기존 farm_001을 Farm 테이블에 등록 + admin 유저 연결

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const existingApiKey = process.env.SENSOR_API_KEY || "smartfarm-sensor-key";
  const farmId = process.env.FARM_ID || "farm_0001";

  // 1. Farm 레코드 생성 (이미 있으면 스킵)
  const farm = await prisma.farm.upsert({
    where: { farmId },
    update: {},
    create: {
      farmId,
      name: "스마트팜 1호",
      apiKey: existingApiKey,
      status: "active",
    },
  });
  console.log(`Farm registered: ${farm.farmId} (apiKey: ${farm.apiKey.slice(0, 8)}...)`);

  // 2. admin 유저를 Farm에 연결
  const adminUser = await prisma.user.findFirst({
    where: { role: "admin", farmId },
  });

  if (adminUser) {
    await prisma.userFarm.upsert({
      where: { userId_farmId: { userId: adminUser.id, farmId: farm.id } },
      update: {},
      create: { userId: adminUser.id, farmId: farm.id, role: "admin" },
    });
    console.log(`Admin "${adminUser.username}" linked to ${farmId}`);
  }

  // 3. 같은 farmId의 다른 유저도 연결
  const users = await prisma.user.findMany({ where: { farmId } });
  let linked = 0;
  for (const user of users) {
    if (user.id === adminUser?.id) continue;
    await prisma.userFarm.upsert({
      where: { userId_farmId: { userId: user.id, farmId: farm.id } },
      update: {},
      create: { userId: user.id, farmId: farm.id, role: user.role },
    });
    linked++;
  }
  if (linked > 0) console.log(`${linked} additional users linked to ${farmId}`);

  console.log("Seed completed successfully!");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
