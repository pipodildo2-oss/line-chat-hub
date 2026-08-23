const router = require('express').Router();
const line = require('@line/bot-sdk');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { enqueueLineEvent } = require('../services/queue.service');

const prisma = new PrismaClient();

// This endpoint is unauthenticated by design (LINE calls it directly) and
// does a DB lookup BEFORE verifying anything (the channelId in the URL isn't
// validated until the signature check below) — without this, it's an open
// door to flood the DB with lookups using arbitrary/garbage channelId
// values at unlimited rate. Limit is generous relative to what any real LINE
// webhook traffic looks like (LINE doesn't deliver anywhere close to this
// volume per source), so legitimate delivery is unaffected.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/webhooks/line/:channelId
router.post('/line/:channelId', webhookLimiter, async (req, res) => {
  // Respond immediately (LINE requires fast response)
  res.sendStatus(200);

  try {
    const channel = await prisma.lineChannel.findUnique({
      where: { id: req.params.channelId },
    });
    if (!channel) return;
    // Soft-disabled channel — don't ingest new messages while paused, even
    // though the LINE OA itself is still live and could deliver events.
    if (!channel.active) return;

    // Verify signature
    const signature = req.headers['x-line-signature'];
    const body = req.body; // raw buffer
    const bodyStr = body.toString('utf8');

    const valid = line.validateSignature(bodyStr, channel.channelSecret, signature);
    if (!valid) {
      console.warn('Invalid LINE signature for channel:', channel.id);
      return;
    }

    const parsed = JSON.parse(bodyStr);
    // Push each event into the queue instead of processing it here — this keeps
    // the webhook handler fast and lets a burst of messages get smoothed out
    // by the queue worker rather than hitting the database all at once.
    for (const event of parsed.events || []) {
      await enqueueLineEvent(channel.id, event);
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

module.exports = router;
