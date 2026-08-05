const router = require('express').Router();
const line = require('@line/bot-sdk');
const { PrismaClient } = require('@prisma/client');
const { handleLineWebhook } = require('../services/line.service');

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
    await handleLineWebhook(channel, parsed.events || []);
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

module.exports = router;
