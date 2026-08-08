const router = require('express').Router();
const line = require('@line/bot-sdk');
const { PrismaClient } = require('@prisma/client');
const { enqueueLineEvent } = require('../services/queue.service');

const prisma = new PrismaClient();

// POST /api/webhooks/line/:channelId
router.post('/line/:channelId', async (req, res) => {
  // Respond immediately (LINE requires fast response)
  res.sendStatus(200);

  try {
    const channel = await prisma.lineChannel.findUnique({
      where: { id: req.params.channelId },
    });
    if (!channel) return;

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
