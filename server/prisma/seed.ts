import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { username: "admin" },
      update: {},
      create: {
        username: "admin",
        passwordHash,
        role: "SUPER_ADMIN",
        displayName: "系统管理员",
        mustChangePassword: true,
      },
    });

    console.log("默认管理员账户已创建:");
    console.log(`  用户名: admin`);
    console.log(`  角色: SUPER_ADMIN`);
  });

  if (adminPassword === "admin123") {
    console.warn("⚠️  使用默认密码（admin123），仅适用于开发环境。生产环境请设置环境变量 SEED_ADMIN_PASSWORD。");
  }
}

main()
  .catch((e) => {
    console.error("种子数据写入失败:", e?.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
