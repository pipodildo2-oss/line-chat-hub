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

  enqueueLineEvent = (channelId, event) => {
    if (!processFnRef) throw new Error('Queue worker not started');
    return processFnRef(channelId, event);
  };

  startWorker = (processFn) => {
    processFnRef = processFn;
    console.log('Webhook queue: REDIS_URL not set — processing events immediately (no buffering). Add a Redis service in Railway to enable queuing under load.');
    return null;
  };
}

module.exports = { enqueueLineEvent, startWorker };
