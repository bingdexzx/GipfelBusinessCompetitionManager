const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const companies = await p.company.findMany();
  console.log('Companies count:', companies.length);
  console.log(JSON.stringify(companies, null, 2));
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
