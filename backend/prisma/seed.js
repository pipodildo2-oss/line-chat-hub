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
  // One-time backfill: rows flagged by the repeated-message spam check
  // before flagCategory had a dedicated "spam" value (see
  // moderation.service.js / reports.js) were stored as "moderation" (or
  // null, for even older rows) — same bucket as real profanity. Their
  // flagReason always contains the distinctive "(สแปม)" marker, so this
  // reclassifies them without touching genuine bad-word flags. Safe to run
  // on every deploy: a row already moved to "spam" no longer matches the
  // WHERE clause, so this is a no-op after the first successful run.
  const spamBackfill = await prisma.message.updateMany({
    where: {
      flagged: true,
      OR: [{ flagCategory: 'moderation' }, { flagCategory: null }],
      flagReason: { contains: 'สแปม' },
    },
    data: { flagCategory: 'spam' },
  });
  if (spamBackfill.count > 0) console.log(`Reclassified ${spamBackfill.count} old spam-flagged message(s) into the "spam" category.`);

  // One-time backfill: migrate the old single free-text Conversation.notes
  // field into the new multi-entry ConversationNote model (see
  // schema.prisma) so no existing note is lost when the UI switches from
  // "one note box" to "add notes over time". Only touches conversations that
  // still have a legacy note AND no ConversationNote rows yet — already
  // migrated (or one that got its first note added via the new UI) no
  // longer matches, so this is a no-op after the first successful run.
  const legacyNotesConvs = await prisma.conversation.findMany({
    where: { notes: { not: null }, noteEntries: { none: {} } },
    select: { id: true, notes: true },
  });
  const toMigrate = legacyNotesConvs.filter(c => c.notes && c.notes.trim());
  if (toMigrate.length > 0) {
    await prisma.conversationNote.createMany({
      data: toMigrate.map(c => ({ conversationId: c.id, content: c.notes.trim() })),
    });
    console.log(`Migrated ${toMigrate.length} legacy conversation note(s) into ConversationNote rows.`);
  }

  console.log('Seed complete. Login: admin@example.com / admin1234');
}

main().catch(console.error).finally(() => prisma.$disconnect());
