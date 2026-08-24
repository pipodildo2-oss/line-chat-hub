// Buffers incoming LINE webhook events through a Redis-backed queue (BullMQ)
// so bursts of messages don't hit the database all at once.
//
// If REDIS_URL isn't set yet, this falls back to processing events immediately
// (same behavior as before the queue existed) — the app keeps working while
// Redis gets configured, and automatically switches to the queue the moment
// REDIS_URL is added in Railway, no code changes needed.

const REDIS_URL = process.env.REDIS_URL;

let enqueueLineEvent;
let startWorker;

if (REDIS_URL) {
  const { Queue, Worker } = require('bullmq');
  const IORedis = require('ioredis');

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const lineEventQueue = new Queue('line-events', { connection });

  enqueueLineEvent = (channelId, event) =>
    lineEventQueue.add('process-event', { channelId, event }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });

  startWorker = (processFn) => {
    const worker = new Worker(
      'line-events',
      async (job) => processFn(job.data.channelId, job.data.event),
      { connection, concurrency: 10 }
    );
    worker.on('failed', (job, err) => console.error('Queue job failed:', job?.id, err.message));
    console.log('Webhook queue: using Redis (BullMQ), concurrency 10');
    return worker;
  };
} else {
  // No Redis configured yet — process events immediately (no buffering).
  let processFnRef = null;

  // The Redis/BullMQ branch above retries a failed job 3x with backoff —
  // this fallback had none at all, so a single transient failure (a DB
  // blip, LINE's API timing out on the profile fetch, etc.) meant the
  // customer's message was silently gone for good, with nothing to fall
  // back on (see webhooks.js's doc comment on why LINE's own webhook
  // redelivery can't be relied on as the only safety net either). Mirrors
  // the same attempts/backoff shape so behavior doesn't depend on whether
  // Redis happens to be configured.
  async function processWithRetry(channelId, event, attempt = 1) {
    try {
      return await processFnRef(channelId, event);
    } catch (err) {
      if (attempt >= 3) {
        console.error(`Webhook event processing failed after 3 attempts (channel ${channelId}):`, err.message);
        throw err;
      }
      const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s
      console.warn(`Webhook event processing failed (attempt ${attempt}/3), retrying in ${delayMs}ms:`, err.message);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return processWithRetry(channelId, event, attempt + 1);
    }
  }

  enqueueLineEvent = (channelId, event) => {
    if (!processFnRef) throw new Error('Queue worker not started');
    return processWithRetry(channelId, event);
  };

  startWorker = (processFn) => {
    processFnRef = processFn;
    console.log('Webhook queue: REDIS_URL not set — processing events immediately with in-process retry (no cross-restart buffering). Add a Redis service in Railway to enable true queuing under load.');
    return null;
  };
}

module.exports = { enqueueLineEvent, startWorker };
