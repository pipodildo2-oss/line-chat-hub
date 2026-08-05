const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('admin1234', 10);
  await prisma.agent.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@example.com',
      password,
      role: 'admin',
    },
  });
  console.log('Seed complete. Login: admin@example.com / admin1234');
}

main().catch(console.error).finally(() => prisma.$disconnect());
