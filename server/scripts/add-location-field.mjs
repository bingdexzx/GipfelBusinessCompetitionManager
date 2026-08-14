// 迁移脚本：为所有缺少「所在地」字段的已有产业类型补建该字段。
// 运行（在 server 目录下）：
//   node scripts/add-location-field.mjs
// 或经 WorkBuddy 沙箱环境：
//   env -u CODEBUDDY_SESSION_ID -u CLAUDE_SESSION_ID node scripts/add-location-field.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const types = await prisma.industryType.findMany({
    select: { id: true, name: true },
  });
  let created = 0;
  for (const t of types) {
    const existing = await prisma.industryField.findUnique({
      where: { industryTypeId_fieldKey: { industryTypeId: t.id, fieldKey: "location" } },
    });
    if (existing) {
      console.log(`跳过（已有所在地字段）：${t.name} (#${t.id})`);
      continue;
    }
    await prisma.industryField.create({
      data: {
        industryTypeId: t.id,
        name: "所在地",
        fieldKey: "location",
        fieldType: "STRING",
        config: JSON.stringify({ isLocation: true }),
        defaultValue: null,
        isCalculated: false,
        formula: null,
        sortOrder: -1,
      },
    });
    created++;
    console.log(`已补建所在地字段：${t.name} (#${t.id})`);
  }
  console.log(`\n完成：新增 ${created} 个「所在地」字段，共检查 ${types.length} 个产业类型。`);
}

main()
  .catch((e) => {
    console.error("迁移失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
