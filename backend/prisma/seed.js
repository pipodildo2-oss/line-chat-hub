const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { reconcileFlaggedLinks, recoverLinkFlagsMissedByTldAllowlistBug } = require('../src/lib/linkGuard');

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

  // Runs on every startup (not just once): clears the "unauthorized link"
  // flag on any message that no longer actually violates the CURRENT
  // approved-domain list/matching rules — e.g. right now, links that only
  // became approved because of the registrable-name matching broadened in
  // linkGuard.js. The ตรวจสอบ report should only ever show what's actually
  // wrong, not stale flags left over from an older, stricter rule — see
  // reconcileFlaggedLinks's own comment for why this only clears, never
  // re-flags. No-op once nothing is left to clear.
  const clearedLinkIds = await reconcileFlaggedLinks(prisma);
  if (clearedLinkIds.length > 0) console.log(`Cleared ${clearedLinkIds.length} link flag(s) that are no longer violations under the current approved-domain rules.`);

  // Incident recovery (see linkGuard.js's own comment for the full story): a
  // short-lived deploy's TLD-allowlist bug caused the reconciliation above to
  // wrongly clear some genuine unauthorized-link flags. Re-flags any recent
  // message that's currently missing a flag it should actually have, under
  // the now-fixed rules.
  const recoveredLinkIds = await recoverLinkFlagsMissedByTldAllowlistBug(prisma);
  if (recoveredLinkIds.length > 0) console.log(`Recovered ${recoveredLinkIds.length} link flag(s) wrongly cleared by the TLD-allowlist bug.`);

  // One-time backfill: lineDisplayName (see schema.prisma) is new — for any
  // conversation that's never been renamed by an agent, displayName already
  // holds the real LINE name, so it's safe to copy straight across. A
  // conversation that WAS already renamed before this field existed has no
  // recoverable original name (never stored anywhere) — left null here;
  // it'll start being tracked from that customer's next message onward (see
  // line.service.js). Only touches rows with no value yet, so this is a
  // no-op after the first successful run.
  const lineNameBackfill = await prisma.$executeRawUnsafe(
    `UPDATE "Conversation" SET "lineDisplayName" = "displayName" WHERE "displayNameCustomized" = false AND "lineDisplayName" IS NULL AND "displayName" IS NOT NULL`
  );
  if (lineNameBackfill > 0) console.log(`Backfilled lineDisplayName for ${lineNameBackfill} conversation(s).`);

  console.log('Seed complete. Login: admin@example.com / admin1234');
}

main().catch(console.error).finally(() => prisma.$disconnect());
