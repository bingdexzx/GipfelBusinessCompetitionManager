import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      role: "SUPER_ADMIN",
      displayName: "系统管理员",
    },
  });

  console.log("默认管理员账户已创建:");
  console.log(`  用户名: admin`);
  console.log(`  密码: admin123`);
  console.log(`  角色: SUPER_ADMIN`);
  console.log("  请首次登录后修改密码！");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
